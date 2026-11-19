import { homedir } from "node:os";
import { join } from "node:path";
import { addBucket, applySession, recordCall, type FileState, type RecentContribution, type ScanState } from "./state";
import { clipTitle, firstMessageText, forEachNewLine, localHourKey, MACHINE_LABEL, num } from "./util";

export const CODEBUDDY = "codebuddy";

/**
 * Roots that hold Codebuddy Code session logs. Codebuddy writes one JSONL per
 * session under `<config>/projects/<encoded-cwd>/<sessionId>.jsonl`, mirroring
 * Claude Code's layout. The `subagents/` subdirectories are scanned too; their
 * message ids are distinct from the parent's, so no extra cross-file dedup is
 * needed.
 */
export function codebuddyRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = homedir();
  const base = env.CODEBUDDY_CONFIG_DIR?.trim() || join(home, ".codebuddy");
  return [...new Set([join(base, "projects"), join(home, ".config", "codebuddy", "projects")])];
}

/** Sum a `cached_tokens` value that Codebuddy reports as an array of detail objects. */
function cachedInput(usage: Record<string, unknown>): number {
  const details = usage.inputTokensDetails;
  if (Array.isArray(details)) {
    let total = 0;
    for (const item of details) {
      if (item && typeof item === "object") total += num((item as Record<string, unknown>).cached_tokens);
    }
    return total;
  }
  return 0;
}

/** Sum the reasoning tokens Codebuddy reports on the output side. */
function reasoningTokens(usage: Record<string, unknown>): number {
  const details = usage.outputTokensDetails;
  if (Array.isArray(details)) {
    let total = 0;
    for (const item of details) {
      if (item && typeof item === "object") total += num((item as Record<string, unknown>).reasoning_tokens);
    }
    return total;
  }
  return 0;
}

export async function scanCodebuddyFile(state: ScanState, path: string): Promise<void> {
  const previousState = state.files[path];
  const recent = new Map<string, RecentContribution>();
  let sessionTitle = previousState?.sessionTitle ?? "";
  if (previousState?.recent) {
    for (const contribution of previousState.recent) recent.set(contribution.id, contribution);
  }
  const result = await forEachNewLine(path, previousState?.offset ?? 0, (line) => {
    // Session label: first real user text. Codebuddy stores role at the top
    // level and content as a list of {type:"input_text", text} blocks.
    if (!sessionTitle && (line.includes('"role":"user"') || line.includes('"role": "user"'))) {
      try {
        const entry = JSON.parse(line);
        const raw = entry?.role === "user" ? firstMessageText(entry.content) : "";
        const text = raw && !MACHINE_LABEL.test(raw.trim()) ? clipTitle(raw) : "";
        if (text) sessionTitle = text;
      } catch {
        /* fall through: not a parseable user entry */
      }
    }
    if (!line.includes('"usage"') || !line.includes('"providerData"')) return;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    const provider = entry?.providerData;
    if (!provider || typeof provider !== "object") return;
    const usage = provider.usage;
    if (!usage || typeof usage !== "object") return;
    const ts = typeof entry.timestamp === "number" ? entry.timestamp : Date.parse(entry.timestamp);
    if (!Number.isFinite(ts)) return;

    const id = typeof provider.messageId === "string" && provider.messageId ? provider.messageId : "";
    const sid = typeof entry.sessionId === "string" ? entry.sessionId : "";
    const project = typeof entry.cwd === "string" ? entry.cwd : "";
    const model = typeof provider.model === "string" && provider.model ? provider.model : typeof provider.requestModelId === "string" && provider.requestModelId ? provider.requestModelId : "unknown";

    // Codebuddy's inputTokens includes the cache-read portion, so subtract it
    // to keep "input" as fresh tokens (same basis as the Claude/Codex scanners).
    const cacheRead = cachedInput(usage as Record<string, unknown>);
    const input = Math.max(0, num(usage.inputTokens) - cacheRead);
    const output = num(usage.outputTokens);
    const reasoning = reasoningTokens(usage as Record<string, unknown>);
    const contribution: RecentContribution = {
      id,
      d: localHourKey(ts),
      m: model,
      p: project,
      i: input,
      o: output,
      cr: cacheRead,
      cw: 0,
      rz: reasoning,
    };
    // Each Codebuddy row is a finished request with a unique message id. Guard
    // against a harness that streams growing snapshots of the same id: keep the
    // last one per id and revoke the earlier contribution before adding it back.
    if (id && recent.has(id)) {
      const before = recent.get(id) as RecentContribution;
      addBucket(state.buckets, before.d, CODEBUDDY, before.m, before.p, {
        r: -1,
        i: -before.i,
        o: -before.o,
        cr: -before.cr,
        cw: -before.cw,
        rz: -before.rz,
      });
      applySession(state.sessions, CODEBUDDY, sid, {
        r: -1,
        i: -before.i,
        o: -before.o,
        cr: -before.cr,
        cw: -before.cw,
        rz: -before.rz,
      });
    }
    if (id) {
      recent.set(id, contribution);
      if (recent.size > 96) {
        const oldest = recent.keys().next().value;
        if (typeof oldest === "string" && oldest !== id) recent.delete(oldest);
      }
    }
    addBucket(state.buckets, contribution.d, CODEBUDDY, contribution.m, contribution.p, {
      r: 1,
      i: contribution.i,
      o: contribution.o,
      cr: contribution.cr,
      cw: contribution.cw,
      rz: contribution.rz,
    });
    applySession(state.sessions, CODEBUDDY, sid, {
      t: ts,
      r: 1,
      p: contribution.p,
      i: contribution.i,
      o: contribution.o,
      cr: contribution.cr,
      cw: contribution.cw,
      rz: contribution.rz,
      title: sessionTitle || undefined,
    });
    recordCall(
      state,
      CODEBUDDY,
      {
        t: ts,
        m: contribution.m,
        p: contribution.p,
        s: sid,
        i: contribution.i,
        o: contribution.o,
        cr: contribution.cr,
        cw: contribution.cw,
        rz: contribution.rz,
        cost: 0,
        credits: 0,
        id: id || undefined,
      },
      id || undefined,
    );
  });
  if (!result) return;
  const fileState: FileState = { offset: result.offset, size: result.size, mtimeMs: result.mtimeMs };
  if (sessionTitle) fileState.sessionTitle = sessionTitle;
  if (recent.size > 0) fileState.recent = [...recent.values()].slice(-96);
  state.files[path] = fileState;
}
