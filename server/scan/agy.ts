import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers";
import { fileURLToPath } from "node:url";
import { loadSqlite } from "./opencode";
import {
  addBucket,
  applySession,
  DEFAULT_ARCHIVE_RETENTION_DAYS,
  MAX_RECENT_PER_AGENT,
  mergeBuckets,
  mergeSessionEntry,
  pruneArchivedHistory,
  type AgyConversationArchive,
  type CallRecord,
  type ScanState,
  type SessionEntry,
  type UsageBucket,
} from "./state";
import { localHourKey } from "./util";

export const AGY = "agy";

const DATABASE_NAME = /^([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\.db$/i;
const PLANNER_RESPONSE = 15;

type Sqlite = NonNullable<Awaited<ReturnType<typeof loadSqlite>>>;
type Database = InstanceType<Sqlite["DatabaseSync"]>;
type WireValue = Uint8Array | number;
type WireFields = Map<number, WireValue>;

function readVarint(bytes: Uint8Array, offset: number): [value: number, next: number] | null {
  let value = 0;
  for (let shift = 0; shift < 70 && offset < bytes.length; shift += 7) {
    const byte = bytes[offset++]!;
    value += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) return [value, offset];
  }
  return null;
}

/** agy stores protobuf blobs in SQLite. Keep only the wire fields the adapter uses. */
function readFields(value: unknown, wanted: readonly number[]): WireFields {
  const fields: WireFields = new Map();
  if (!(value instanceof Uint8Array)) return fields;
  let offset = 0;
  while (offset < value.length) {
    const tag = readVarint(value, offset);
    if (!tag || tag[0] < 8 || tag[0] > 0xffffffff) return new Map();
    const [key, start] = tag;
    const field = key >>> 3;
    const type = key & 7;
    if (type === 0 || type === 2) {
      const item = readVarint(value, start);
      if (!item) return new Map();
      const [number, next] = item;
      offset = type === 0 ? next : next + number;
      if (offset > value.length) return new Map();
      if (wanted.includes(field)) {
        fields.set(field, type === 0 ? number : value.subarray(next, offset));
      }
    } else if (type === 1 || type === 5) {
      offset = start + (type === 1 ? 8 : 4);
      if (offset > value.length) return new Map();
    } else {
      return new Map();
    }
  }
  return fields;
}

function count(fields: WireFields, field: number): number {
  const value = fields.get(field);
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

interface StepTime {
  seconds: number;
  nanos: number;
}

function readCreatedAt(metadata: unknown): StepTime | null {
  // The planner step records created_at as a google.protobuf.Timestamp.
  const timestamp = readFields(readFields(metadata, [1]).get(1), [1, 2]);
  const seconds = count(timestamp, 1);
  const nanos = count(timestamp, 2);
  return seconds > 0 && seconds <= 253_402_300_799 && nanos < 1_000_000_000 ? { seconds, nanos } : null;
}

function readGeneration(blob: unknown) {
  // A stored generation points to its planner response first, then any tool steps it created.
  const generation = readFields(blob, [1, 2]);
  const steps = generation.get(2);
  const firstStep = steps instanceof Uint8Array ? readVarint(steps, 0)?.[0] : steps;
  if (firstStep === undefined || !Number.isSafeInteger(firstStep)) return null;
  const result = readFields(generation.get(1), [4, 19]);
  const usage = readFields(result.get(4), [2, 3, 4, 5, 9]);
  // agy reports uncached input separately. Output already includes the thinking subset.
  const tokens = {
    i: count(usage, 2),
    o: count(usage, 3),
    cw: count(usage, 4),
    cr: count(usage, 5),
    rz: count(usage, 9),
  };
  if (tokens.i + tokens.o + tokens.cw + tokens.cr === 0) return null;
  const name = result.get(19);
  const decoded = name instanceof Uint8Array && name.length <= 128 ? Buffer.from(name).toString("utf8") : "";
  const model = /^[a-z0-9][a-z0-9_.:/-]*$/i.test(decoded) ? decoded : "unknown";
  return { firstStep, model, tokens };
}

function readProjects(sqlite: Sqlite, root: string): Map<string, string> {
  const projects = new Map<string, string>();
  let db: Database | undefined;
  try {
    db = new sqlite.DatabaseSync(join(root, "conversation_summaries.db"), { readOnly: true });
    const rows = db.prepare("SELECT conversation_id, workspace_uris FROM conversation_summaries").all();
    for (const row of rows as { conversation_id: string; workspace_uris: string }[]) {
      let uris: unknown;
      try {
        uris = JSON.parse(row.workspace_uris);
      } catch {
        continue;
      }
      if (!Array.isArray(uris)) continue;
      for (const uri of uris) {
        if (typeof uri !== "string" || !uri.startsWith("file:")) continue;
        try {
          const project = fileURLToPath(uri);
          if (project === "/" || /^[a-z]:[\\/]$/i.test(project) || project.includes("\u0001")) continue;
          projects.set(row.conversation_id, project);
          break;
        } catch {
          // Ignore workspace URIs that cannot be mapped to a local path.
        }
      }
    }
  } catch {
    // Workspace labels are optional even when the summary index is unavailable.
  } finally {
    db?.close();
  }
  return projects;
}

function readConversation(
  sqlite: Sqlite,
  file: string,
  sid: string,
  project: string,
  replayed: Set<string>,
): CallRecord[] {
  const db = new sqlite.DatabaseSync(file, { readOnly: true });
  try {
    db.exec("BEGIN");
    const steps = db.prepare("SELECT idx, metadata FROM steps WHERE step_type = ?").all(PLANNER_RESPONSE);
    const times = new Map<number, StepTime | null>();
    for (const row of steps as { idx: number; metadata: unknown }[]) times.set(row.idx, readCreatedAt(row.metadata));

    const calls: CallRecord[] = [];
    const generations = db.prepare("SELECT data FROM gen_metadata ORDER BY idx").all();
    for (const row of generations as { data: unknown }[]) {
      const generation = readGeneration(row.data);
      if (!generation) continue;
      const created = times.get(generation.firstStep);
      if (!created) continue;
      const { model, tokens } = generation;
      // Forks can copy model steps verbatim. Use the full creation timestamp and usage for deduplication.
      const key = JSON.stringify([created.seconds, created.nanos, model, tokens.i, tokens.o, tokens.cr, tokens.cw, tokens.rz]);
      if (replayed.has(key)) continue;
      replayed.add(key);
      const t = created.seconds * 1000 + Math.floor(created.nanos / 1_000_000);
      calls.push({ t, m: model, p: project, s: sid, ...tokens, cost: 0, credits: 0 });
    }
    return calls;
  } finally {
    db.close();
  }
}

function isUnsupportedDatabase(error: unknown): boolean {
  if (!(error instanceof Error) || !("errcode" in error)) return false;
  // SQLITE_CORRUPT, SQLITE_NOTADB, or SQLITE_ERROR for a different schema.
  const code = typeof error.errcode === "number" ? error.errcode & 0xff : 0;
  return code === 11 || code === 26 || (code === 1 && /no such (?:table|column):/i.test(error.message));
}

export async function scanAgy(
  state: ScanState,
  shouldStop: () => boolean,
  root = join(homedir(), ".gemini", "antigravity-cli"),
  options?: { archiveRetentionDays?: number; now?: number },
): Promise<void> {
  const directory = join(root, "conversations");
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (!entries) {
    state.recent[AGY] ??= [];
    return;
  }
  const sqlite = await loadSqlite();
  if (!sqlite) {
    console.warn("[agent-usage] agy skipped: node:sqlite unavailable (needs Node >= 22.5)");
    state.recent[AGY] ??= [];
    return;
  }

  const projects = readProjects(sqlite, root);
  const freshBySid = new Map<string, AgyConversationArchive>();
  const seenOnDisk = new Set<string>();
  const replayed = new Set<string>();
  let recent: CallRecord[] = [];
  let read = 0;
  let skipped = 0;
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const sid = DATABASE_NAME.exec(entry.name)?.[1];
    if (!sid || !entry.isFile()) continue;
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (shouldStop()) return;
    const project = projects.get(sid) ?? "";
    const file = join(directory, entry.name);
    let calls: CallRecord[];
    try {
      calls = readConversation(sqlite, file, sid, project, replayed);
    } catch (error) {
      const present = await stat(file).then(() => true, (failure: NodeJS.ErrnoException) => failure.code !== "ENOENT");
      if (!present) continue;
      if (!isUnsupportedDatabase(error)) throw error;
      skipped += 1;
      continue;
    }
    read += 1;
    seenOnDisk.add(sid);
    if (calls.length) {
      const convBuckets: Record<string, UsageBucket> = {};
      const convSessions: Record<string, SessionEntry> = {};
      for (const call of calls) {
        const delta = { ...call, r: 1, model: call.m };
        addBucket(convBuckets, localHourKey(call.t), AGY, call.m, project, delta);
        applySession(convSessions, AGY, sid, delta);
      }
      const session = convSessions[`${AGY}\u0001${sid}`];
      freshBySid.set(sid, session ? { buckets: convBuckets, session } : { buckets: convBuckets });
      recent = recent.concat(calls).sort((a, b) => a.t - b.t).slice(-MAX_RECENT_PER_AGENT);
    }
  }

  if (skipped) {
    console.warn(`[agent-usage] agy skipped ${skipped} corrupt or incompatible conversation database(s)`);
    if (!read) return;
  }

  // Merge on-disk conversations with previously archived (vanished) conversations.
  // Present DBs replace their own prior projection so SQLite rewrites never double-count,
  // while deleted DBs survive in `state.agy` up to `archiveRetentionDays`.
  const nextAgy: Record<string, AgyConversationArchive> = {};
  for (const [sid, archived] of Object.entries(state.agy ?? {})) {
    if (!seenOnDisk.has(sid)) nextAgy[sid] = { ...archived, archived: true };
  }
  for (const [sid, fresh] of freshBySid) {
    nextAgy[sid] = fresh;
  }

  for (const key of Object.keys(state.buckets)) {
    if (key.split("\u0001", 2)[1] === AGY) delete state.buckets[key];
  }
  for (const key of Object.keys(state.sessions)) {
    if (key.startsWith(AGY + "\u0001")) delete state.sessions[key];
  }
  for (const [sid, conv] of Object.entries(nextAgy)) {
    mergeBuckets(state.buckets, conv.buckets, 1);
    if (conv.session) mergeSessionEntry(state.sessions, `${AGY}\u0001${sid}`, conv.session, 1);
  }
  if (Object.keys(nextAgy).length > 0) state.agy = nextAgy;
  else delete state.agy;

  const retentionDays = options?.archiveRetentionDays ?? DEFAULT_ARCHIVE_RETENTION_DAYS;
  pruneArchivedHistory(state, retentionDays, options?.now ?? Date.now());

  if (recent.length > 0 || state.recent[AGY] === undefined) {
    state.recent[AGY] = recent;
  }
}
