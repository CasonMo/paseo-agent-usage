import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { localHourKey } from "./util";

export const STATE_VERSION = 13;
export const DEFAULT_ARCHIVE_RETENTION_DAYS = 0;

/** Compact per-model token tuple `[input, output, cacheRead, cacheWrite]`. */
export type TokenTuple = [number, number, number, number];

/** Usage aggregate for one hour bucket. Bucket keys start with an hour key `YYYY-MM-DDTHH`. */
export interface UsageBucket {
  r: number;
  i: number;
  o: number;
  cr: number;
  cw: number;
  rz: number;
  cost: number;
  credits: number;
  /** Tokens `[i, o, cr, cw]` from calls with `cost > 0`, so unbilled calls in the same bucket still estimate. */
  bt?: TokenTuple;
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
  /** Originating local log path for surgical `state.recent` cleanup on shrink/reappear. */
  f?: string;
}

export interface CodexForkState {
  forked: boolean;
  point: number | null;
  baselineDone: boolean;
  firstTs: number | null;
}

/** Compact per-model token tuple `[input, output, cacheRead, cacheWrite]` stored on sessions. */
export type SessionModelTokens = TokenTuple;

/** Per-session aggregate, keyed `harness \u0001 sessionId` in `ScanState.sessions`.
 *  `s`/`e` are the first/last counted call timestamps; fields mirror UsageBucket.
 *  `title` is a short human label (first user message or summary), first win. */
export interface SessionEntry {
  s: number;
  e: number;
  r: number;
  i: number;
  o: number;
  cr: number;
  cw: number;
  rz: number;
  cost: number;
  credits: number;
  p: string;
  title?: string;
  /** Optional per-model token breakdown for dynamic report-time cost estimation. */
  models?: Record<string, SessionModelTokens>;
  /** Per-model tokens `[i, o, cr, cw]` from calls with `cost > 0`, so unbilled turns still estimate. */
  bt?: Record<string, SessionModelTokens>;
}

/** Per-file snapshot retained in `ArchiveState.files` so temporarily missing files revoke cleanly on reappear. */
export interface ArchivedFileState {
  buckets?: Record<string, UsageBucket>;
  sessions?: Record<string, SessionEntry>;
  ledgerFrom0?: boolean;
}

/** Archived usage from source files that have been deleted/purged from disk. */
export interface ArchiveState {
  buckets: Record<string, UsageBucket>;
  sessions: Record<string, SessionEntry>;
  files?: Record<string, ArchivedFileState>;
}

/** Per-conversation projection for Antigravity CLI so deleted DBs remain archived. */
export interface AgyConversationArchive {
  buckets: Record<string, UsageBucket>;
  session?: SessionEntry;
  /** Dedup keys of calls counted in this conversation so archived DBs keep `replayed` seeded. */
  keys?: string[];
  /** True only once the source `.db` file has vanished from disk. */
  archived?: true;
}

/** Keeps the sessions index bounded (≈1MB): counted requests drop dead entries,
 *  and once the cap is hit the oldest sessions are evicted first. */
const SESSION_KEEP_LIMIT = 8000;

export function pruneSessions(sessions: Record<string, SessionEntry>): void {
  for (const key of Object.keys(sessions)) {
    const entry = sessions[key];
    if (!entry || entry.r <= 0) delete sessions[key];
  }
  const keys = Object.keys(sessions);
  if (keys.length <= SESSION_KEEP_LIMIT) return;
  keys.sort((a, b) => (sessions[b]?.e ?? 0) - (sessions[a]?.e ?? 0));
  for (const key of keys.slice(SESSION_KEEP_LIMIT)) delete sessions[key];
}

export interface SessionDelta {
  /** Counted call timestamp; establishes the session start/end. Revokes omit it. */
  t?: number;
  /** Request count delta: +1 per counted call, negative revokes mirror bucket deltas. */
  r: number;
  i?: number;
  o?: number;
  cr?: number;
  cw?: number;
  rz?: number;
  cost?: number;
  credits?: number;
  p?: string;
  /** Model ID for this call; tracked compactly for report-time cost estimation. */
  model?: string;
  /** Human label; only the first non-empty value wins so later calls keep it. */
  title?: string;
}

function applyModelTuple(
  map: Record<string, SessionModelTokens> | undefined,
  model: string | undefined,
  i: number,
  o: number,
  cr: number,
  cw: number,
): Record<string, SessionModelTokens> | undefined {
  if (!model || (i === 0 && o === 0 && cr === 0 && cw === 0)) return map;
  const nextMap = map ?? {};
  const prev = nextMap[model] ?? [0, 0, 0, 0];
  const next: SessionModelTokens = [prev[0] + i, prev[1] + o, prev[2] + cr, prev[3] + cw];
  if (next[0] <= 0 && next[1] <= 0 && next[2] <= 0 && next[3] <= 0) {
    delete nextMap[model];
    return Object.keys(nextMap).length > 0 ? nextMap : undefined;
  }
  nextMap[model] = next;
  return nextMap;
}

function seedLegacySessionBilled(entry: SessionEntry): void {
  if (entry.cost <= 0 || entry.bt !== undefined || !entry.models) return;
  const bt: Record<string, SessionModelTokens> = {};
  for (const [model, tuple] of Object.entries(entry.models)) {
    bt[model] = [tuple[0], tuple[1], tuple[2], tuple[3]];
  }
  if (Object.keys(bt).length > 0) entry.bt = bt;
}

/** Applies one normalized call to a session's aggregate. Unknown sessions only
 *  materialize for positive deltas, so revoke passes cannot resurrect entries. */
export function applySession(sessions: Record<string, SessionEntry>, harness: string, sid: string, delta: SessionDelta): void {
  if (!sid) return;
  const key = `${harness}\u0001${sid}`;
  let entry = sessions[key];
  const isNew = !entry;
  if (!entry) {
    if (delta.r <= 0) return;
    entry = { s: delta.t ?? 0, e: delta.t ?? 0, r: 0, i: 0, o: 0, cr: 0, cw: 0, rz: 0, cost: 0, credits: 0, p: delta.p ?? "" };
    sessions[key] = entry;
  } else if (delta.r > 0 && entry.cost > 0 && entry.bt === undefined) {
    seedLegacySessionBilled(entry);
  }
  const di = delta.i ?? 0;
  const do_ = delta.o ?? 0;
  const dcr = delta.cr ?? 0;
  const dcw = delta.cw ?? 0;
  const dcost = delta.cost ?? 0;
  entry.r += delta.r;
  entry.i += di;
  entry.o += do_;
  entry.cr += dcr;
  entry.cw += dcw;
  entry.rz += delta.rz ?? 0;
  entry.cost += dcost;
  entry.credits += delta.credits ?? 0;
  entry.models = applyModelTuple(entry.models, delta.model, di, do_, dcr, dcw);
  if (!isNew && entry.bt !== undefined) {
    if (dcost > 0) entry.bt = applyModelTuple(entry.bt, delta.model, di, do_, dcr, dcw);
  } else if (dcost > 0) {
    entry.bt = applyModelTuple(entry.bt, delta.model, di, do_, dcr, dcw);
  }
  if (entry.cost <= 0 && entry.bt) delete entry.bt;
  if (delta.p) entry.p = delta.p;
  if (delta.title && !entry.title) entry.title = delta.title;
  if (typeof delta.t === "number" && Number.isFinite(delta.t)) {
    if (entry.s === 0 || delta.t < entry.s) entry.s = delta.t;
    if (delta.t > entry.e) entry.e = delta.t;
  }
}

export interface FileState {
  offset: number;
  size: number;
  mtimeMs: number;
  project?: string;
  model?: string;
  session?: string;
  /** First user message captured for the session label (claude/codex/pi). */
  sessionTitle?: string;
  /** Codex fork bookkeeping: a forked rollout's baseline/replay part is not usage. */
  codexFork?: CodexForkState;
  /** Last seen Codex cumulative totals: [input, cached, cacheWrite, output, reasoning, total]. */
  totals?: number[];
  recent?: RecentContribution[];
  /** Per-file bucket contribution for surgical shrink recovery and purge-proof archiving. */
  buckets?: Record<string, UsageBucket>;
  /** Per-file session contribution for surgical shrink recovery and purge-proof archiving. */
  sessions?: Record<string, SessionEntry>;
  /** True only when this file's bucket/session ledger has been recorded completely from offset 0. */
  ledgerFrom0?: boolean;
}

export interface RemoteHostState {
  target: string;
  buckets: Record<string, UsageBucket>;
  recent: Record<string, CallRecord[]>;
  sessions: Record<string, SessionEntry>;
  lastPullAt: number | null;
  lastAttemptAt: number | null;
  lastError: string | null;
  node: string | null;
  generatedAt: number | null;
}

/** OpenCode scan cursor. `watermark`/`lastId` track the v2 `session_message`
 *  table (or the v1 `message` table when no v2 projection exists).
 *  `legacyWatermark`/`legacyLastId` track the frozen v1 table in a database
 *  that has both generations. `seen` is a bounded ledger of counted message
 *  ids, used while a cursor is held for an in-flight row and for the v1/v2
 *  overlap during a migration. */
export interface OpenCodeState {
  watermark: number;
  lastId: string;
  legacyWatermark?: number;
  legacyLastId?: string;
  seen?: string[];
}

export interface ScanState {
  version: typeof STATE_VERSION;
  buckets: Record<string, UsageBucket>;
  /** Per-session aggregates for locally scanned logs, keyed `harness \u0001 sessionId`. */
  sessions: Record<string, SessionEntry>;
  files: Record<string, FileState>;
  recent: Record<string, CallRecord[]>;
  opencode: OpenCodeState;
  /**
   * Pi cross-file dedup ledger: "entryId@timestamp" keys of every counted
   * message. Pi fork / sub-run files copy messages from their parent, so the
   * same key can appear in several files; only the first occurrence counts.
   */
  pi: { seen: string[] };
  /** Projections pulled from remote machines over SSH, keyed by host name. */
  hosts: Record<string, RemoteHostState>;
  /** Durable archive of vanished log files (survives source deletion and active-file shrinks). */
  archive?: ArchiveState;
  /** Per-conversation Antigravity projections so deleted DBs stay archived. */
  agy?: Record<string, AgyConversationArchive>;
  meta: { lastScanAt: number | null; scanError: string | null };
}

export const MAX_RECENT_PER_AGENT = 400;

export function emptyState(): ScanState {
  return {
    version: STATE_VERSION,
    buckets: {},
    sessions: {},
    files: {},
    recent: {},
    opencode: { watermark: 0, lastId: "" },
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

/** Bucket keys are `hourKey \u0001 harness \u0001 model \u0001 project`, where hourKey is `YYYY-MM-DDTHH`. */
export function bucketKey(hourKey: string, harness: string, model: string, project: string): string {
  return [hourKey, harness, model, project].join("\u0001");
}

function addTokenTuple(target: TokenTuple | undefined, delta: readonly [number, number, number, number]): TokenTuple | undefined {
  const next: TokenTuple = [
    (target?.[0] ?? 0) + delta[0],
    (target?.[1] ?? 0) + delta[1],
    (target?.[2] ?? 0) + delta[2],
    (target?.[3] ?? 0) + delta[3],
  ];
  if (next[0] <= 0 && next[1] <= 0 && next[2] <= 0 && next[3] <= 0) return undefined;
  return next;
}

export function addBucketByKey(
  buckets: Record<string, UsageBucket>,
  key: string,
  delta: Partial<UsageBucket> & { r: number },
): void {
  let bucket = buckets[key];
  const isNew = !bucket;
  if (!bucket) {
    bucket = { r: 0, i: 0, o: 0, cr: 0, cw: 0, rz: 0, cost: 0, credits: 0 };
    buckets[key] = bucket;
  } else if (bucket.bt === undefined && bucket.cost > 0 && ((delta.cost ?? 0) > 0 || delta.bt !== undefined || delta.r > 0)) {
    // Legacy bucket had reported cost without `bt`: seed its prior tokens as billed before mixing.
    bucket.bt = [bucket.i, bucket.o, bucket.cr, bucket.cw];
  }
  const di = delta.i ?? 0;
  const do_ = delta.o ?? 0;
  const dcr = delta.cr ?? 0;
  const dcw = delta.cw ?? 0;
  const dcost = delta.cost ?? 0;
  bucket.r += delta.r;
  bucket.i += di;
  bucket.o += do_;
  bucket.cr += dcr;
  bucket.cw += dcw;
  bucket.rz += delta.rz ?? 0;
  bucket.cost += dcost;
  bucket.credits += delta.credits ?? 0;
  if (delta.bt !== undefined) {
    const nextBt = addTokenTuple(bucket.bt, delta.bt);
    if (nextBt) bucket.bt = nextBt;
    else delete bucket.bt;
  } else if (dcost > 0) {
    const nextBt = addTokenTuple(bucket.bt, [di, do_, dcr, dcw]);
    if (nextBt) bucket.bt = nextBt;
    else delete bucket.bt;
  } else if (isNew && bucket.bt) {
    delete bucket.bt;
  }
  if (bucket.cost <= 0 && bucket.bt) delete bucket.bt;
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

export function addBucket(
  buckets: Record<string, UsageBucket>,
  hourKey: string,
  harness: string,
  model: string,
  project: string,
  delta: Partial<UsageBucket> & { r: number },
): void {
  addBucketByKey(buckets, bucketKey(hourKey, harness, model, project), delta);
}

/** Applies a bucket delta to both the global state and the owning file's contribution ledger. */
export function recordFileBucket(
  state: ScanState,
  fileBuckets: Record<string, UsageBucket>,
  hourKey: string,
  harness: string,
  model: string,
  project: string,
  delta: Partial<UsageBucket> & { r: number },
): void {
  addBucket(state.buckets, hourKey, harness, model, project, delta);
  addBucket(fileBuckets, hourKey, harness, model, project, delta);
}

/** Applies a session delta to both the global state and the owning file's contribution ledger. */
export function recordFileSession(
  state: ScanState,
  fileSessions: Record<string, SessionEntry>,
  harness: string,
  sid: string,
  delta: SessionDelta,
): void {
  applySession(state.sessions, harness, sid, delta);
  applySession(fileSessions, harness, sid, delta);
}

export function mergeSessionEntry(
  sessions: Record<string, SessionEntry>,
  key: string,
  entry: SessionEntry,
  sign: 1 | -1 = 1,
): void {
  let target = sessions[key];
  if (!target) {
    if (sign < 0 || entry.r <= 0) return;
    target = { s: entry.s, e: entry.e, r: 0, i: 0, o: 0, cr: 0, cw: 0, rz: 0, cost: 0, credits: 0, p: entry.p };
    sessions[key] = target;
  } else if (sign > 0 && target.cost > 0 && target.bt === undefined && entry.bt !== undefined) {
    seedLegacySessionBilled(target);
  }
  target.r += sign * entry.r;
  target.i += sign * entry.i;
  target.o += sign * entry.o;
  target.cr += sign * entry.cr;
  target.cw += sign * entry.cw;
  target.rz += sign * entry.rz;
  target.cost += sign * entry.cost;
  target.credits += sign * entry.credits;
  if (entry.models) {
    for (const [model, tuple] of Object.entries(entry.models)) {
      target.models = applyModelTuple(target.models, model, sign * tuple[0], sign * tuple[1], sign * tuple[2], sign * tuple[3]);
    }
  }
  if (entry.bt) {
    for (const [model, tuple] of Object.entries(entry.bt)) {
      target.bt = applyModelTuple(target.bt, model, sign * tuple[0], sign * tuple[1], sign * tuple[2], sign * tuple[3]);
    }
  } else if (sign > 0 && entry.cost > 0 && entry.models && target.bt !== undefined) {
    for (const [model, tuple] of Object.entries(entry.models)) {
      target.bt = applyModelTuple(target.bt, model, tuple[0], tuple[1], tuple[2], tuple[3]);
    }
  }
  if (target.cost <= 0 && target.bt) delete target.bt;
  if (sign > 0) {
    if (entry.p && !target.p) target.p = entry.p;
    if (entry.title && !target.title) target.title = entry.title;
    if (entry.s > 0 && (target.s === 0 || entry.s < target.s)) target.s = entry.s;
    if (entry.e > target.e) target.e = entry.e;
  }
  if (target.r <= 0 && target.i <= 0 && target.o <= 0 && target.cr <= 0 && target.cw <= 0) {
    delete sessions[key];
  }
}

export function mergeBuckets(
  target: Record<string, UsageBucket>,
  source: Record<string, UsageBucket> | undefined,
  sign: 1 | -1 = 1,
): void {
  if (!source) return;
  for (const [key, bucket] of Object.entries(source)) {
    const existing = target[key];
    const bt: TokenTuple | undefined = bucket.bt
      ? [sign * bucket.bt[0], sign * bucket.bt[1], sign * bucket.bt[2], sign * bucket.bt[3]]
      : sign > 0 && bucket.cost > 0 && existing?.bt !== undefined
        ? [bucket.i, bucket.o, bucket.cr, bucket.cw]
        : undefined;
    addBucketByKey(target, key, {
      r: sign * bucket.r,
      i: sign * bucket.i,
      o: sign * bucket.o,
      cr: sign * bucket.cr,
      cw: sign * bucket.cw,
      rz: sign * bucket.rz,
      cost: sign * bucket.cost,
      credits: sign * bucket.credits,
      ...(bt !== undefined ? { bt } : {}),
    });
  }
}

function dropRecentForFile(state: ScanState, filePath: string | undefined): void {
  if (!filePath) return;
  for (const [harness, list] of Object.entries(state.recent)) {
    if (!Array.isArray(list) || list.length === 0) continue;
    const filtered = list.filter((record) => record.f !== filePath);
    if (filtered.length !== list.length) state.recent[harness] = filtered;
  }
}

/** Moves a deleted file's recorded contribution into `state.archive` so future active-file shrinks cannot erase it. */
export function archiveFileContribution(state: ScanState, fileState: FileState, filePath?: string): void {
  const hasBuckets = Boolean(fileState.buckets && Object.keys(fileState.buckets).length > 0);
  const hasSessions = Boolean(fileState.sessions && Object.keys(fileState.sessions).length > 0);
  if (!hasBuckets && !hasSessions) return;
  state.archive ??= { buckets: {}, sessions: {} };
  mergeBuckets(state.archive.buckets, fileState.buckets, 1);
  if (fileState.sessions) {
    for (const [key, entry] of Object.entries(fileState.sessions)) {
      mergeSessionEntry(state.archive.sessions, key, entry, 1);
    }
  }
  if (filePath) {
    state.archive.files ??= {};
    const snapshot: ArchivedFileState = {};
    if (hasBuckets) snapshot.buckets = sanitizeBuckets(fileState.buckets);
    if (hasSessions) snapshot.sessions = sanitizeSessions(fileState.sessions);
    if (fileState.ledgerFrom0) snapshot.ledgerFrom0 = true;
    state.archive.files[filePath] = snapshot;
  }
}

/** Surgically revokes a single shrunk file's contribution from `state` without disturbing any other file or archive. */
export function revokeFileContribution(state: ScanState, fileState: FileState, filePath?: string): void {
  mergeBuckets(state.buckets, fileState.buckets, -1);
  if (fileState.sessions) {
    for (const [key, entry] of Object.entries(fileState.sessions)) {
      mergeSessionEntry(state.sessions, key, entry, -1);
    }
  }
  dropRecentForFile(state, filePath);
}

/**
 * Revokes a previously archived file's contribution when the path reappears on disk
 * (e.g. remounted drive or sync-tool rename-and-replace).
 */
export function revokeArchivedFile(state: ScanState, filePath: string): "none" | "revoked" | "legacy_reset" {
  const archived = state.archive?.files?.[filePath];
  if (!archived || !state.archive) return "none";
  delete state.archive.files![filePath];
  if (state.archive.files && Object.keys(state.archive.files).length === 0) delete state.archive.files;

  mergeBuckets(state.archive.buckets, archived.buckets, -1);
  if (archived.sessions) {
    for (const [key, entry] of Object.entries(archived.sessions)) {
      mergeSessionEntry(state.archive.sessions, key, entry, -1);
    }
  }
  if (Object.keys(state.archive.buckets).length === 0 && Object.keys(state.archive.sessions).length === 0) {
    delete state.archive;
  }

  if (!archived.ledgerFrom0) return "legacy_reset";

  mergeBuckets(state.buckets, archived.buckets, -1);
  if (archived.sessions) {
    for (const [key, entry] of Object.entries(archived.sessions)) {
      mergeSessionEntry(state.sessions, key, entry, -1);
    }
  }
  dropRecentForFile(state, filePath);
  return "revoked";
}

/**
 * Prunes archived (vanished-source) history older than `retentionDays`.
 * `retentionDays <= 0` means unlimited retention (no pruning).
 * Live files currently on disk are never pruned here.
 */
export function pruneArchivedHistory(
  state: ScanState,
  retentionDays: number = DEFAULT_ARCHIVE_RETENTION_DAYS,
  now = Date.now(),
): void {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return;
  const cutoffMs = now - retentionDays * 86_400_000;
  const cutoffHour = localHourKey(cutoffMs);

  if (state.archive) {
    for (const [key, bucket] of Object.entries(state.archive.buckets)) {
      const hour = key.split("\u0001", 1)[0] ?? "";
      if (hour && hour < cutoffHour) {
        addBucketByKey(state.buckets, key, {
          r: -bucket.r,
          i: -bucket.i,
          o: -bucket.o,
          cr: -bucket.cr,
          cw: -bucket.cw,
          rz: -bucket.rz,
          cost: -bucket.cost,
          credits: -bucket.credits,
          ...(bucket.bt ? { bt: [-bucket.bt[0], -bucket.bt[1], -bucket.bt[2], -bucket.bt[3]] } : {}),
        });
        delete state.archive.buckets[key];
        if (state.archive.files) {
          for (const fileEntry of Object.values(state.archive.files)) {
            if (fileEntry.buckets) delete fileEntry.buckets[key];
          }
        }
      }
    }
    for (const [key, entry] of Object.entries(state.archive.sessions)) {
      if (entry.e > 0 && entry.e < cutoffMs) {
        mergeSessionEntry(state.sessions, key, entry, -1);
        delete state.archive.sessions[key];
        if (state.archive.files) {
          for (const fileEntry of Object.values(state.archive.files)) {
            if (fileEntry.sessions) delete fileEntry.sessions[key];
          }
        }
      }
    }
    if (state.archive.files) {
      for (const [filePath, fileEntry] of Object.entries(state.archive.files)) {
        if (fileEntry.buckets && Object.keys(fileEntry.buckets).length === 0) delete fileEntry.buckets;
        if (fileEntry.sessions && Object.keys(fileEntry.sessions).length === 0) delete fileEntry.sessions;
        if (!fileEntry.buckets && !fileEntry.sessions) delete state.archive.files[filePath];
      }
      if (Object.keys(state.archive.files).length === 0) delete state.archive.files;
    }
    if (Object.keys(state.archive.buckets).length === 0 && Object.keys(state.archive.sessions).length === 0) {
      delete state.archive;
    }
  }

  if (state.agy) {
    for (const [sid, conv] of Object.entries(state.agy)) {
      if (!conv.archived) continue;
      let latestHour = "";
      for (const key of Object.keys(conv.buckets)) {
        const hour = key.split("\u0001", 1)[0] ?? "";
        if (hour > latestHour) latestHour = hour;
      }
      const sessionExpired = conv.session ? conv.session.e > 0 && conv.session.e < cutoffMs : true;
      const bucketsExpired = !latestHour || latestHour < cutoffHour;
      if (sessionExpired && bucketsExpired) {
        mergeBuckets(state.buckets, conv.buckets, -1);
        if (conv.session) mergeSessionEntry(state.sessions, `agy\u0001${sid}`, conv.session, -1);
        delete state.agy[sid];
      }
    }
    if (Object.keys(state.agy).length === 0) delete state.agy;
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

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sanitizeTokenTuple(raw: unknown): TokenTuple | undefined {
  if (!Array.isArray(raw) || raw.length < 4) return undefined;
  const entry: TokenTuple = [finite(raw[0]), finite(raw[1]), finite(raw[2]), finite(raw[3])];
  return entry[0] > 0 || entry[1] > 0 || entry[2] > 0 || entry[3] > 0 ? entry : undefined;
}

export function sanitizeBuckets(raw: unknown): Record<string, UsageBucket> {
  const buckets: Record<string, UsageBucket> = {};
  if (!raw || typeof raw !== "object") return buckets;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const bucket: UsageBucket = {
      r: finite(record.r),
      i: finite(record.i),
      o: finite(record.o),
      cr: finite(record.cr),
      cw: finite(record.cw),
      rz: finite(record.rz),
      cost: finite(record.cost),
      credits: finite(record.credits),
    };
    const bt = sanitizeTokenTuple(record.bt);
    if (bt && bucket.cost > 0) bucket.bt = bt;
    buckets[key] = bucket;
  }
  return buckets;
}

function sanitizeSessionModels(raw: unknown): Record<string, SessionModelTokens> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const models: Record<string, SessionModelTokens> = {};
  for (const [model, tuple] of Object.entries(raw as Record<string, unknown>)) {
    if (!model) continue;
    const entry = sanitizeTokenTuple(tuple);
    if (entry) models[model] = entry;
  }
  return Object.keys(models).length > 0 ? models : undefined;
}

export function sanitizeSessions(raw: unknown): Record<string, SessionEntry> {
  const sessions: Record<string, SessionEntry> = {};
  if (!raw || typeof raw !== "object") return sessions;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const models = sanitizeSessionModels(record.models);
    const bt = sanitizeSessionModels(record.bt);
    const entry: SessionEntry = {
      s: finite(record.s),
      e: finite(record.e),
      r: finite(record.r),
      i: finite(record.i),
      o: finite(record.o),
      cr: finite(record.cr),
      cw: finite(record.cw),
      rz: finite(record.rz),
      cost: finite(record.cost),
      credits: finite(record.credits),
      p: typeof record.p === "string" ? record.p : "",
    };
    if (typeof record.title === "string") entry.title = record.title;
    if (models) entry.models = models;
    if (bt && entry.cost > 0) entry.bt = bt;
    sessions[key] = entry;
  }
  return sessions;
}

function sanitizeArchiveFiles(raw: unknown): Record<string, ArchivedFileState> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const files: Record<string, ArchivedFileState> = {};
  for (const [filePath, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!filePath || !value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const buckets = record.buckets ? sanitizeBuckets(record.buckets) : undefined;
    const sessions = record.sessions ? sanitizeSessions(record.sessions) : undefined;
    const hasBuckets = Boolean(buckets && Object.keys(buckets).length > 0);
    const hasSessions = Boolean(sessions && Object.keys(sessions).length > 0);
    if (!hasBuckets && !hasSessions) continue;
    const entry: ArchivedFileState = {};
    if (hasBuckets) entry.buckets = buckets;
    if (hasSessions) entry.sessions = sessions;
    if (record.ledgerFrom0 === true) entry.ledgerFrom0 = true;
    files[filePath] = entry;
  }
  return Object.keys(files).length > 0 ? files : undefined;
}

function sanitizeAgyArchive(raw: unknown): Record<string, AgyConversationArchive> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, AgyConversationArchive> = {};
  for (const [sid, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!sid || !value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const buckets = sanitizeBuckets(record.buckets);
    const sessionMap = record.session ? sanitizeSessions({ s: record.session }) : {};
    const session = sessionMap.s;
    const keys = Array.isArray(record.keys) ? record.keys.filter((item): item is string => typeof item === "string") : undefined;
    if (Object.keys(buckets).length > 0 || session) {
      const entry: AgyConversationArchive = session ? { buckets, session } : { buckets };
      if (keys && keys.length > 0) entry.keys = keys;
      if (record.archived === true) entry.archived = true;
      out[sid] = entry;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function loadState(dir: string): Promise<ScanState> {
  try {
    const text = await readFile(join(dir, "state.json"), "utf8");
    const parsed = JSON.parse(text) as Partial<ScanState>;
    if (!parsed || typeof parsed !== "object" || parsed.version !== STATE_VERSION) return emptyState();
    const state = emptyState();
    state.buckets = sanitizeBuckets(parsed.buckets);
    state.sessions = sanitizeSessions(parsed.sessions);
    state.files = (parsed.files as ScanState["files"]) ?? {};
    state.recent = (parsed.recent as ScanState["recent"]) ?? {};
    state.opencode = {
      watermark: finite(parsed.opencode?.watermark),
      lastId: typeof parsed.opencode?.lastId === "string" ? parsed.opencode.lastId : "",
      legacyWatermark:
        typeof parsed.opencode?.legacyWatermark === "number" ? parsed.opencode.legacyWatermark : undefined,
      legacyLastId:
        typeof parsed.opencode?.legacyLastId === "string" ? parsed.opencode.legacyLastId : undefined,
      seen: Array.isArray(parsed.opencode?.seen)
        ? parsed.opencode.seen.filter((id): id is string => typeof id === "string")
        : undefined,
    };
    state.pi = { seen: Array.isArray(parsed.pi?.seen) ? (parsed.pi.seen as string[]).filter((k) => typeof k === "string") : [] };
    state.hosts = (parsed.hosts as ScanState["hosts"]) ?? {};
    if (parsed.archive && typeof parsed.archive === "object") {
      const archiveBuckets = sanitizeBuckets(parsed.archive.buckets);
      const archiveSessions = sanitizeSessions(parsed.archive.sessions);
      const archiveFiles = sanitizeArchiveFiles(parsed.archive.files);
      if (Object.keys(archiveBuckets).length > 0 || Object.keys(archiveSessions).length > 0) {
        state.archive = { buckets: archiveBuckets, sessions: archiveSessions, ...(archiveFiles ? { files: archiveFiles } : {}) };
      }
    }
    const agy = sanitizeAgyArchive(parsed.agy);
    if (agy) state.agy = agy;
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
  pruneSessions(state.sessions);
  for (const host of Object.values(state.hosts ?? {})) if (host?.sessions) pruneSessions(host.sessions);
  await mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => {});
  const file = join(dir, "state.json");
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
  await rename(temporary, file);
  await chmod(dir, 0o700).catch(() => {});
}
