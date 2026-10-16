import { homedir } from "node:os";
import { join } from "node:path";
import { addBucket, recordCall, type CodexForkState, type FileState, type ScanState } from "./state";
import { forEachNewLine, localDateKey, num } from "./util";

export const CODEX = "codex";

export function codexRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  return [join(home, "sessions"), join(home, "archived_sessions")];
}

/**
 * Forked rollouts must not be counted from their cumulative totals:
 * - Newer files carry the parent's cumulative snapshot in their first post-fork
 *   token event; that snapshot is a baseline, not usage.
 * - Older files (no ordinal fields) replay the parent's token history as a burst
 *   of events emitted within the first seconds after the fork; those events are
 *   synthetic and are skipped (only events after the burst window count).
 */
const BURST_WINDOW_MS = 2000;

export async function scanCodexFile(state: ScanState, path: string): Promise<void> {
  const previousState = state.files[path];
  let project = previousState?.project ?? "";
  let model = previousState?.model ?? "";
  let session = previousState?.session ?? "";
  let totals: number[] | null = previousState?.totals ?? null;
  let fork: CodexForkState = previousState?.codexFork ?? { forked: false, point: null, baselineDone: false, firstTs: null };
  const result = await forEachNewLine(path, previousState?.offset ?? 0, (line) => {
    if (line.includes('"session_meta"')) {
      try {
        const entry = JSON.parse(line) as {
          payload?: { cwd?: unknown; id?: unknown; session_id?: unknown; forked_from_id?: unknown; forked_from_ordinal_exclusive?: unknown };
        };
        const payload = entry?.payload ?? {};
        if (!project && typeof payload.cwd === "string") project = payload.cwd;
        const metaSession = payload.id ?? payload.session_id;
        if (!session && typeof metaSession === "string") session = metaSession;
        if (typeof payload.forked_from_id === "string" && payload.forked_from_id) {
          fork = {
            forked: true,
            point: typeof payload.forked_from_ordinal_exclusive === "number" ? payload.forked_from_ordinal_exclusive : null,
            baselineDone: false,
            firstTs: null,
          };
        }
      } catch {
        /* ignore */
      }
      return;
    }
    if (line.includes('"turn_context"')) {
      try {
        const entry = JSON.parse(line) as { payload?: { model?: unknown } };
        const value = entry?.payload?.model;
        if (typeof value === "string" && value) model = value;
      } catch {
        /* ignore */
      }
      return;
    }
    if (!line.includes('"token_count"')) return;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    const info = entry?.payload?.info;
    if (!info) return;
    const total = info.total_token_usage;
    if (!total || typeof total !== "object") return;
    const current = [
      num(total.input_tokens),
      num(total.cached_input_tokens),
      num(total.cache_write_input_tokens),
      num(total.output_tokens),
      num(total.reasoning_output_tokens),
      num(total.total_tokens),
    ];
    const ts = Date.parse(entry.timestamp);
    const ordinal = num(entry.ordinal);

    if (fork.forked && !fork.baselineDone) {
      if (fork.point !== null) {
        if (!(ordinal > 0 && ordinal > fork.point)) {
          // Replayed or pre-fork event: keep it only as the running baseline.
          totals = current;
          return;
        }
        fork.baselineDone = true;
        totals = current;
        return;
      }
      // Old format without a fork point: skip the replay burst right after the fork.
      if (fork.firstTs === null && Number.isFinite(ts)) fork.firstTs = ts;
      if (!Number.isFinite(ts) || fork.firstTs === null || ts - fork.firstTs <= BURST_WINDOW_MS) {
        totals = current;
        return;
      }
      fork.baselineDone = true;
      // Fall through: this first event after the replay window counts as a real delta.
    }
    if (fork.forked && fork.baselineDone && fork.point !== null && ordinal > 0 && ordinal <= fork.point) {
      totals = current;
      return;
    }

    const before = totals;
    totals = current;
    const delta = before ? current.map((value, index) => Math.max(0, value - (before[index] ?? 0))) : current.slice();
    const dInput = delta[0] ?? 0;
    const dCached = delta[1] ?? 0;
    const dCacheWrite = delta[2] ?? 0;
    const dOutput = delta[3] ?? 0;
    const dReasoning = delta[4] ?? 0;
    const dTotal = delta[5] ?? 0;
    if (dTotal <= 0) return;
    if (!Number.isFinite(ts)) return;
    const input = Math.max(0, dInput - dCached);
    addBucket(state.buckets, localDateKey(ts), CODEX, model || "codex", project, {
      r: 1,
      i: input,
      o: dOutput,
      cr: dCached,
      cw: dCacheWrite,
      rz: dReasoning,
    });
    recordCall(state, CODEX, {
      t: ts,
      m: model || "codex",
      p: project,
      s: session,
      i: input,
      o: dOutput,
      cr: dCached,
      cw: dCacheWrite,
      rz: dReasoning,
      cost: 0,
      credits: 0,
    });
  });
  if (!result) return;
  const fileState: FileState = { offset: result.offset, size: result.size, mtimeMs: result.mtimeMs, project, model, session };
  if (totals) fileState.totals = totals;
  if (fork.forked) fileState.codexFork = fork;
  state.files[path] = fileState;
}
