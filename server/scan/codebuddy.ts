import { homedir } from "node:os";
import { join } from "node:path";
import { recordCall, recordFileBucket, recordFileSession, type FileState, type ScanState, type SessionEntry, type UsageBucket } from "./state";
import { clipTitle, firstMessageText, forEachNewLine, localHourKey, MACHINE_LABEL, num } from "./util";

export const CODEBUDDY = "codebuddy";

/**
 * Codebuddy's own machine-injected prompt (title/branch generation) is written
 * as a `role: "user"` message, so it must never become a session label.
 */
const CODEBUDDY_MACHINE = /^generate a title and a git branch name for a coding agent/i;

/**
 * Roots that hold Codebuddy Code session logs. Codebuddy writes one JSONL per
 * session under `<config>/projects/<encoded-cwd>/<sessionId>.jsonl`, mirroring
 * Claude Code's layout. The `subagents/` subdirectories are scanned too; their
 * message ids are distinct from the parent's, so no extra cross-file dedup is
 * needed (see OVERVIEW.md for the assumption).
 */
export function codebuddyRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = homedir();
  const base = env.CODEBUDDY_CONFIG_DIR?.trim() || join(home, ".codebuddy");
  return [...new Set([join(base, "projects"), join(home, ".config", "codebuddy", "projects")])];
}

/** Epoch milliseconds from a number (seconds tolerated) or an ISO/numeric string. */
function toMillis(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return NaN;
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      return numeric < 1e12 ? numeric * 1000 : numeric;
    }
    return Date.parse(trimmed);
  }
  return NaN;
}

/**
 * Sums a numeric field that Codebuddy reports either as an array of detail
 * objects (`[{ cached_tokens: n }]`, observed) or the OpenAI-style single
 * object (`{ cached_tokens: n }`). Anything else yields 0.
 */
function sumDetail(value: unknown, field: string): number {
  if (Array.isArray(value)) {
    let total = 0;
    for (const item of value) {
      if (item && typeof item === "object") total += num((item as Record<string, unknown>)[field]);
    }
    return total;
  }
  if (value && typeof value === "object") return num((value as Record<string, unknown>)[field]);
  return 0;
}

/** First real user text as the session label; skips machine-injected prompts. */
function sessionLabel(entry: Record<string, unknown>): string {
  const nested = entry.message as Record<string, unknown> | undefined;
  const role = entry.role ?? nested?.role;
  if (role !== "user") return "";
  const content = entry.content ?? nested?.content;
  const raw = firstMessageText(content);
  if (!raw) return "";
  const text = raw.trim();
  if (MACHINE_LABEL.test(text) || CODEBUDDY_MACHINE.test(text)) return "";
  return clipTitle(raw);
}

export async function scanCodebuddyFile(state: ScanState, path: string): Promise<void> {
  const previousState = state.files[path];
  const fileBuckets: Record<string, UsageBucket> = previousState?.buckets ? { ...previousState.buckets } : {};
  const fileSessions: Record<string, SessionEntry> = previousState?.sessions ? { ...previousState.sessions } : {};
  let sessionTitle = previousState?.sessionTitle ?? "";
  const result = await forEachNewLine(path, previousState?.offset ?? 0, (line) => {
    // Usage rows are always parsed. Non-usage rows are only parsed while the
    // session title is still unknown (the title needs just the first user turn),
    // so the rest of a title-known file skips JSON.parse.
    if (!line.includes('"usage"') && (sessionTitle || !line.includes('"role"'))) return;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    if (!sessionTitle) {
      const label = sessionLabel(entry);
      if (label) sessionTitle = label;
    }
    const provider = entry?.providerData;
    if (!provider || typeof provider !== "object") return;
    const usage = provider.usage;
    if (!usage || typeof usage !== "object") return;
    // Each usage row is a finished request with a unique message id (validated
    // across real logs), so it is added directly with no snapshot-dedup pass.
    // Reject non-positive timestamps so a pending/placeholder row cannot create
    // a phantom 1970 bucket.
    const ts = toMillis(entry.timestamp);
    if (!Number.isFinite(ts) || ts <= 0) return;

    const sid = typeof entry.sessionId === "string" ? entry.sessionId : "";
    const project = typeof entry.cwd === "string" ? entry.cwd : "";
    const model =
      typeof provider.model === "string" && provider.model
        ? provider.model
        : typeof provider.requestModelId === "string" && provider.requestModelId
          ? provider.requestModelId
          : "unknown";

    // Codebuddy's inputTokens includes the cache-read portion, so split it out
    // to keep "input" as fresh tokens (same basis as the Claude/Codex scanners).
    // Cap the cache read at the reported input so totals cannot be overstated.
    const inputTotal = num(usage.inputTokens);
    const cacheRead = Math.min(sumDetail(usage.inputTokensDetails, "cached_tokens"), inputTotal);
    const input = inputTotal - cacheRead;
    const output = num(usage.outputTokens);
    const reasoning = sumDetail(usage.outputTokensDetails, "reasoning_tokens");

    recordFileBucket(state, fileBuckets, localHourKey(ts), CODEBUDDY, model, project, {
      r: 1,
      i: input,
      o: output,
      cr: cacheRead,
      cw: 0,
      rz: reasoning,
    });
    recordFileSession(state, fileSessions, CODEBUDDY, sid, {
      t: ts,
      r: 1,
      p: project,
      model,
      i: input,
      o: output,
      cr: cacheRead,
      cw: 0,
      rz: reasoning,
      title: sessionTitle || undefined,
    });
    recordCall(state, CODEBUDDY, {
      t: ts,
      m: model,
      p: project,
      s: sid,
      i: input,
      o: output,
      cr: cacheRead,
      cw: 0,
      rz: reasoning,
      cost: 0,
      credits: 0,
    });
  });
  if (!result) return;
  const fileState: FileState = { offset: result.offset, size: result.size, mtimeMs: result.mtimeMs };
  if (sessionTitle) fileState.sessionTitle = sessionTitle;
  if (Object.keys(fileBuckets).length > 0) fileState.buckets = fileBuckets;
  if (Object.keys(fileSessions).length > 0) fileState.sessions = fileSessions;
  state.files[path] = fileState;
}
