import { homedir } from "node:os";
import { join } from "node:path";
import { addBucket, recordCall, type FileState, type ScanState } from "./state";
import { forEachNewLine, localDateKey, num } from "./util";

export const PI = "pi";

export function piRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = homedir();
  const roots: string[] = [];
  const sessionDir = env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (sessionDir) roots.push(sessionDir);
  const agentDir = env.PI_CODING_AGENT_DIR?.trim() || join(home, ".pi", "agent");
  roots.push(join(agentDir, "sessions"));
  return [...new Set(roots)];
}

export async function scanPiFile(state: ScanState, path: string): Promise<void> {
  const previousState = state.files[path];
  let project = previousState?.project ?? "";
  const base = path.split("/").pop() ?? "";
  const underscore = base.lastIndexOf("_");
  const session = (underscore >= 0 ? base.slice(underscore + 1) : base).replace(/\.jsonl$/, "");
  const result = await forEachNewLine(path, previousState?.offset ?? 0, (line) => {
    if (!project && line.includes('"type":"session"')) {
      try {
        const entry = JSON.parse(line) as { cwd?: unknown };
        if (typeof entry?.cwd === "string") project = entry.cwd;
      } catch {
        /* ignore */
      }
      return;
    }
    if (!line.includes('"usage"') || !line.includes('"assistant"')) return;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    if (entry?.type !== "message") return;
    const message = entry.message;
    if (!message || typeof message !== "object" || message.role !== "assistant") return;
    const usage = message.usage;
    if (!usage || typeof usage !== "object") return;
    const ts = Date.parse(entry.timestamp);
    if (!Number.isFinite(ts)) return;
    const cost = typeof usage.cost?.total === "number" && usage.cost.total > 0 ? usage.cost.total : 0;
    const model = typeof message.model === "string" && message.model ? message.model : "unknown";
    addBucket(state.buckets, localDateKey(ts), PI, model, project, {
      r: 1,
      i: num(usage.input),
      o: num(usage.output),
      cr: num(usage.cacheRead),
      cw: num(usage.cacheWrite),
      rz: num(usage.reasoning),
      cost,
    });
    recordCall(state, PI, {
      t: ts,
      m: model,
      p: project,
      s: session,
      i: num(usage.input),
      o: num(usage.output),
      cr: num(usage.cacheRead),
      cw: num(usage.cacheWrite),
      rz: num(usage.reasoning),
      cost,
      credits: 0,
    });
  });
  if (!result) return;
  state.files[path] = { offset: result.offset, size: result.size, mtimeMs: result.mtimeMs, project };
}
