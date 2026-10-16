import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const STATE_VERSION = 8;

export interface DayBucket {
  r: number;
  i: number;
  o: number;
  cr: number;
  cw: number;
  rz: number;
  cost: number;
  credits: number;
}

/** The last usage recorded for one Claude message id, so streaming snapshots replace instead of add. */
export interface RecentContribution {
  id: string;
  d: string;
  m: string;
  p: string;
  i: number;
  o: number;
  cr: number;
  cw: number;
  rz: number;
}

/** One normalized model call, kept for the per-agent request log (bounded ring buffer). */
export interface CallRecord {
  t: number;
  m: string;
  p: string;
  s: string;
  i: number;
  o: number;
  cr: number;
  cw: number;
  rz: number;
  cost: number;
  credits: number;
  id?: string;
}

export interface CodexForkState {
  forked: boolean;
  point: number | null;
  baselineDone: boolean;
  firstTs: number | null;
}

export interface FileState {
  offset: number;
  size: number;
  mtimeMs: number;
  project?: string;
  model?: string;
  session?: string;
  /** Codex fork bookkeeping: a forked rollout's baseline/replay part is not usage. */
  codexFork?: CodexForkState;
  /** Last seen Codex cumulative totals: [input, cached, cacheWrite, output, reasoning, total]. */
  totals?: number[];
  recent?: RecentContribution[];
}

export interface RemoteHostState {
  target: string;
  buckets: Record<string, DayBucket>;
  recent: Record<string, CallRecord[]>;
  lastPullAt: number | null;
  lastAttemptAt: number | null;
  lastError: string | null;
  node: string | null;
  generatedAt: number | null;
}

export interface ScanState {
  version: typeof STATE_VERSION;
  buckets: Record<string, DayBucket>;
  files: Record<string, FileState>;
  recent: Record<string, CallRecord[]>;
  opencode: { watermark: number };
  /**
   * Pi cross-file dedup ledger: "entryId@timestamp" keys of every counted
   * message. Pi fork / sub-run files copy messages from their parent, so the
   * same key can appear in several files; only the first occurrence counts.
   */
  pi: { seen: string[] };
  /** Projections pulled from remote machines over SSH, keyed by host name. */
  hosts: Record<string, RemoteHostState>;
  meta: { lastScanAt: number | null; scanError: string | null };
}

const MAX_RECENT_PER_AGENT = 400;

export function emptyState(): ScanState {
  return {
    version: STATE_VERSION,
    buckets: {},
    files: {},
    recent: {},
    opencode: { watermark: 0 },
    pi: { seen: [] },
    hosts: {},
    meta: { lastScanAt: null, scanError: null },
  };
}

export function resolvePaseoHome(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const raw = env.PASEO_HOME?.trim();
  const fallback = join(home, ".paseo");
  if (!raw) return fallback;
  if (raw === "~") return home;
  if (raw.startsWith("~/")) return resolve(home, raw.slice(2));
  if (isAbsolute(raw)) return resolve(raw);
  return fallback;
}

export function pluginDataDir(): string {
  return join(resolvePaseoHome(), "plugin-data", "agent-usage-plugin");
}

export function bucketKey(date: string, harness: string, model: string, project: string): string {
  return [date, harness, model, project].join("\u0001");
}

export function addBucket(
  buckets: Record<string, DayBucket>,
  date: string,
  harness: string,
  model: string,
  project: string,
  delta: Partial<DayBucket> & { r: number },
): void {
  const key = bucketKey(date, harness, model, project);
  let bucket = buckets[key];
  if (!bucket) {
    bucket = { r: 0, i: 0, o: 0, cr: 0, cw: 0, rz: 0, cost: 0, credits: 0 };
    buckets[key] = bucket;
  }
  bucket.r += delta.r;
  bucket.i += delta.i ?? 0;
  bucket.o += delta.o ?? 0;
  bucket.cr += delta.cr ?? 0;
  bucket.cw += delta.cw ?? 0;
  bucket.rz += delta.rz ?? 0;
  bucket.cost += delta.cost ?? 0;
  bucket.credits += delta.credits ?? 0;
  if (
    bucket.r <= 0 &&
    bucket.i <= 0 &&
    bucket.o <= 0 &&
    bucket.cr <= 0 &&
    bucket.cw <= 0 &&
    bucket.rz <= 0 &&
    bucket.cost <= 0 &&
    bucket.credits <= 0
  ) {
    delete buckets[key];
  }
}

/**
 * Appends a call to the per-agent ring buffer. When `replaceId` matches a recent
 * record (Claude streaming snapshots), the existing entry is replaced in place.
 */
export function recordCall(state: ScanState, harness: string, record: CallRecord, replaceId?: string): void {
  let list = state.recent[harness];
  if (!list) {
    list = [];
    state.recent[harness] = list;
  }
  if (replaceId) {
    const floor = Math.max(0, list.length - 32);
    for (let index = list.length - 1; index >= floor; index -= 1) {
      if (list[index]?.id === replaceId) {
        list[index] = record;
        return;
      }
    }
  }
  list.push(record);
  if (list.length > MAX_RECENT_PER_AGENT) list.splice(0, list.length - MAX_RECENT_PER_AGENT);
}

export async function loadState(dir: string): Promise<ScanState> {
  try {
    const text = await readFile(join(dir, "state.json"), "utf8");
    const parsed = JSON.parse(text) as Partial<ScanState>;
    if (!parsed || typeof parsed !== "object" || parsed.version !== STATE_VERSION) return emptyState();
    const state = emptyState();
    state.buckets = (parsed.buckets as ScanState["buckets"]) ?? {};
    state.files = (parsed.files as ScanState["files"]) ?? {};
    state.recent = (parsed.recent as ScanState["recent"]) ?? {};
    state.opencode = { watermark: typeof parsed.opencode?.watermark === "number" ? parsed.opencode.watermark : 0 };
    state.pi = { seen: Array.isArray(parsed.pi?.seen) ? (parsed.pi.seen as string[]).filter((k) => typeof k === "string") : [] };
    state.hosts = (parsed.hosts as ScanState["hosts"]) ?? {};
    state.meta = {
      lastScanAt: typeof parsed.meta?.lastScanAt === "number" ? parsed.meta.lastScanAt : null,
      scanError: typeof parsed.meta?.scanError === "string" ? parsed.meta.scanError : null,
    };
    return state;
  } catch {
    return emptyState();
  }
}

export async function saveState(dir: string, state: ScanState): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => {});
  const file = join(dir, "state.json");
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
  await rename(temporary, file);
  await chmod(dir, 0o700).catch(() => {});
}
