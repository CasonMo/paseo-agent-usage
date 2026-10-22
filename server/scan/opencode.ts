import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { addBucket, applySession, recordCall, type ScanState } from "./state";
import { clipTitle, localHourKey, num } from "./util";

export const OPENCODE = "opencode";

/**
 * Recent message ids used as a second line of defence against double counting.
 * The scan watermark already prevents completed rows from being read twice;
 * the ledger covers a watermark held below an in-flight row and the overlap
 * between the legacy `message` table and the v2 `session_message` projection.
 *
 * 10k ids is several hours of heavy use. If the cap is reached the oldest ids
 * are dropped first; the watermark still prevents the vast majority of repeat
 * reads, so losing an old id cannot resurrect an old row.
 */
const SEEN_LIMIT = 10_000;

/**
 * A row without its terminal marker is normally an in-flight assistant turn.
 * If it has not been touched for an hour, the process that wrote it is gone
 * (or the row predates the marker), so its recorded usage is final.
 */
const INCOMPLETE_GRACE_MS = 60 * 60 * 1000;

const BATCH_SIZE = 4000;
const MAX_BATCHES = 500;

/**
 * Minimal structural types for the optional node:sqlite builtin. The module
 * ships with Node >= 22.5 and is loaded at runtime through createRequire,
 * never through a static or type-level import: install-time build checks on
 * machines running older Node versions fail to resolve node:sqlite type
 * dependencies, because the builtin does not exist there yet.
 */
interface SqliteStatement {
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase;
}

let sqliteModule: SqliteModule | null | undefined;

/** Loads node:sqlite, or null on runtimes older than Node 22.5. */
export async function loadSqlite(): Promise<SqliteModule | null> {
  if (sqliteModule !== undefined) return sqliteModule;
  try {
    const requireFn = createRequire(join(process.cwd(), "agent-usage-sqlite.cjs"));
    sqliteModule = requireFn("node:sqlite") as SqliteModule;
  } catch {
    sqliteModule = null;
  }
  return sqliteModule;
}

export function opencodeDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const dataHome = env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
  return join(dataHome, "opencode", "opencode.db");
}

interface MessageRow {
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

interface V2MessageRow extends MessageRow {
  message_type?: string | null;
  session_title?: string | null;
  session_directory?: string | null;
  session_model?: string | null;
  project_worktree?: string | null;
}

interface ParsedCall {
  id: string;
  ts: number;
  session: string;
  model: string;
  project: string;
  title?: string;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  /** The row has a terminal marker, or is old enough that its usage is final. */
  complete: boolean;
}

/** True when the database has a table with this exact name. */
function hasTable(db: SqliteDatabase, name: string): boolean {
  try {
    return db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").all(name).length > 0;
  } catch {
    return false;
  }
}

/** Parses the JSON object stored in `message.data` / `session_message.data`. */
function parseData(value: unknown): Record<string, any> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Reads the model id from a v2 `{id, providerID}` object, a bare string, or
 *  the serialized model stored on the session row. The bare id is kept (the
 *  same value v1 stored in `modelID`), so migrated sessions keep one model
 *  row instead of splitting into `provider/id` variants. */
function modelId(data: Record<string, any>, fallback?: string | null): string {
  const direct = data.modelID;
  if (typeof direct === "string" && direct) return direct;
  const model = data.model;
  if (typeof model === "string" && model) return model;
  if (model && typeof model === "object") {
    if (typeof model.id === "string" && model.id) return model.id;
    if (typeof model.modelID === "string" && model.modelID) return model.modelID;
    // The provider is not a model name, but it is the only identifier left
    // when a provider row is malformed. Keeping it is more useful than
    // dropping the call into the generic "unknown" bucket.
    if (typeof model.providerID === "string" && model.providerID) return model.providerID;
  }
  if (typeof fallback === "string" && fallback) {
    try {
      const parsed = JSON.parse(fallback);
      if (parsed && typeof parsed === "object" && typeof parsed.id === "string" && parsed.id) return parsed.id;
    } catch {
      /* session.model is not JSON in very old schemas */
    }
  }
  return "unknown";
}

/** Project path for a message: the message path in v1, the session directory
 *  in v2, then the project worktree as a last resort. */
function projectPath(data: Record<string, any>, ...fallbacks: Array<string | null | undefined>): string {
  const path = data.path;
  if (path && typeof path === "object") {
    if (typeof path.cwd === "string" && path.cwd) return path.cwd;
    if (typeof path.root === "string" && path.root) return path.root;
  }
  for (const value of fallbacks) if (typeof value === "string" && value) return value;
  return "";
}

/**
 * Normalizes one assistant/compaction row. v2 rows are filtered by the query
 * (`type`), while v1 rows still carry the role inside `data`.
 */
function parseCall(row: MessageRow, data: Record<string, any>, v2: boolean, now: number): ParsedCall | null {
  if (!v2 && data.role !== "assistant") return null;
  const tokens = data.tokens;
  if (!tokens || typeof tokens !== "object") return null;
  const cache = tokens.cache && typeof tokens.cache === "object" ? tokens.cache : {};
  const input = num(tokens.input);
  const output = num(tokens.output);
  const reasoning = num(tokens.reasoning);
  const cacheRead = num(cache.read);
  const cacheWrite = num(cache.write);
  const cost = Math.max(0, num(data.cost));
  const hasUsage = input + output + reasoning + cacheRead + cacheWrite > 0 || cost > 0;

  // Compaction rows use `status`; assistant rows use `time.completed`. A
  // pending compaction has no final usage yet. Rows untouched for an hour are
  // treated as final so a crashed turn cannot block the watermark forever.
  const isCompaction = v2 && (row as V2MessageRow).message_type === "compaction";
  const completedAt = num(data.time?.completed);
  const status = typeof data.status === "string" ? data.status : "";
  const terminalStatus = status === "completed" || status === "failed";
  const stale = num(row.time_updated) > 0 && now - num(row.time_updated) > INCOMPLETE_GRACE_MS;
  const complete = (isCompaction ? terminalStatus : completedAt > 0) || (stale && hasUsage);

  return {
    id: typeof row.id === "string" ? row.id : "",
    ts: num(data.time?.created) || num(row.time_created),
    session: typeof row.session_id === "string" ? row.session_id : "",
    model: modelId(data),
    project: projectPath(data),
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    cost,
    complete,
  };
}

function countCall(state: ScanState, call: ParsedCall, seen: Set<string>, seenOrder: string[]): void {
  if (!call.complete) return;
  if (call.id && seen.has(call.id)) return;
  const total = call.input + call.output + call.reasoning + call.cacheRead + call.cacheWrite;
  if (total <= 0 && call.cost <= 0) return;

  // Billing semantics: reasoning tokens are part of the generated output, so
  // fold them into `o` (matches CC Switch and real spend). `rz` keeps the
  // reasoning share for display only. OpenCode stores reasoning separately
  // from `tokens.output`, so this adds it exactly once.
  const outputWithReasoning = call.output + call.reasoning;
  addBucket(state.buckets, localHourKey(call.ts), OPENCODE, call.model, call.project, {
    r: 1,
    i: call.input,
    o: outputWithReasoning,
    cr: call.cacheRead,
    cw: call.cacheWrite,
    rz: call.reasoning,
    cost: call.cost,
  });
  applySession(state.sessions, OPENCODE, call.session, {
    t: call.ts,
    r: 1,
    p: call.project,
    i: call.input,
    o: outputWithReasoning,
    cr: call.cacheRead,
    cw: call.cacheWrite,
    rz: call.reasoning,
    cost: call.cost,
    title: call.title,
  });
  recordCall(state, OPENCODE, {
    t: call.ts,
    m: call.model,
    p: call.project,
    s: call.session,
    i: call.input,
    o: outputWithReasoning,
    cr: call.cacheRead,
    cw: call.cacheWrite,
    rz: call.reasoning,
    cost: call.cost,
    credits: 0,
  });
  if (call.id) {
    seen.add(call.id);
    seenOrder.push(call.id);
  }
}

/**
 * Scans OpenCode's SQLite store. OpenCode 2.x writes sessions to `session_v2`
 * and messages to `session_message` (the row `type` is the role); 1.x used
 * `session` / `message` with the role inside `data`. During a migration both
 * sets can exist. Legacy rows are read first because the frozen v1 table is
 * the more complete copy, then v2 fills in turns the projection added; the
 * message-id ledger makes the overlap harmless.
 */
export async function scanOpencode(state: ScanState, path = opencodeDbPath()): Promise<void> {
  if (!existsSync(path)) return;
  const sqlite = await loadSqlite();
  if (!sqlite) {
    console.warn("[agent-usage] opencode skipped: node:sqlite unavailable (needs Node >= 22.5)");
    return;
  }
  let db: SqliteDatabase | null = null;
  try {
    try {
      db = new sqlite.DatabaseSync(path, { readOnly: true });
    } catch {
      db = new sqlite.DatabaseSync(path);
      db.exec("PRAGMA query_only = ON;");
    }

    const hasV2Messages = hasTable(db, "session_message");
    const hasV2Sessions = hasTable(db, "session_v2");
    const hasV1Messages = hasTable(db, "message");
    const hasV1Sessions = hasTable(db, "session");
    if (!hasV2Messages && !hasV1Messages) return;

    const seen = new Set(state.opencode.seen ?? []);
    const seenOrder = [...(state.opencode.seen ?? [])];
    const now = Date.now();
    let watermark = state.opencode.watermark;
    // On the first run after upgrading the plugin, the old watermark already
    // covers the v1 rows that were counted. Start the legacy cursor there so
    // migrated history is not counted twice, while rows added after the last
    // v1 scan are still picked up.
    let legacyWatermark = state.opencode.legacyWatermark ?? state.opencode.watermark;
    let holdWatermark: number | null = null;
    let holdLegacy: number | null = null;

    if (hasV1Messages) {
      const titles = new Map<string, string>();
      if (hasV1Sessions) {
        try {
          const titleStatement = db.prepare("SELECT id, title FROM session WHERE title IS NOT NULL AND title <> ''");
          for (const row of titleStatement.all() as unknown as Array<Record<string, unknown>>) {
            if (typeof row.id === "string" && typeof row.title === "string") titles.set(row.id, clipTitle(row.title));
          }
        } catch {
          /* older schema without the title column */
        }
      }
      let cursor = hasV2Messages ? legacyWatermark : watermark;
      const statement = db.prepare(
        `SELECT id, session_id, time_created, time_updated, data FROM message
         WHERE time_updated > ? ORDER BY time_updated ASC LIMIT ${BATCH_SIZE}`,
      );
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const rows = statement.all(cursor) as unknown as MessageRow[];
        if (rows.length === 0) break;
        let maxUpdated = cursor;
        for (const row of rows) {
          const updated = num(row.time_updated);
          if (updated > maxUpdated) maxUpdated = updated;
          const data = parseData(row.data);
          if (!data) continue;
          const call = parseCall(row, data, false, now);
          if (!call) continue;
          if (!call.complete) {
            if (
              updated > 0 &&
              (call.input + call.output + call.reasoning + call.cacheRead + call.cacheWrite > 0 || call.cost > 0)
            ) {
              if (holdLegacy === null || updated < holdLegacy) holdLegacy = updated;
            }
            continue;
          }
          call.title = titles.get(call.session);
          countCall(state, call, seen, seenOrder);
        }
        cursor = maxUpdated;
        if (rows.length < BATCH_SIZE) break;
      }
      if (hasV2Messages) legacyWatermark = Math.max(legacyWatermark, cursor);
      else {
        watermark = Math.max(watermark, cursor);
        legacyWatermark = watermark;
      }
    }

    if (hasV2Messages) {
      // A database upgraded from v1 already has its old messages counted up to
      // the old watermark; the v2 projection may contain the same messages
      // with their original timestamps. Starting there avoids re-counting the
      // migrated history while still backfilling anything newer.
      let cursor = watermark;
      const modelCache = new Map<string, string>();
      const statement = db.prepare(
        hasV2Sessions
          ? `SELECT m.id, m.session_id, m.time_created, m.time_updated, m.data, m.type AS message_type,
                    s.title AS session_title, s.directory AS session_directory,
                    s.model AS session_model, p.worktree AS project_worktree
             FROM session_message m
             LEFT JOIN session_v2 s ON s.id = m.session_id
             LEFT JOIN project p ON p.id = s.project_id
             WHERE m.time_updated > ? AND m.type IN ('assistant', 'compaction')
             ORDER BY m.time_updated ASC LIMIT ${BATCH_SIZE}`
          : `SELECT m.id, m.session_id, m.time_created, m.time_updated, m.data, m.type AS message_type
             FROM session_message m
             WHERE m.time_updated > ? AND m.type IN ('assistant', 'compaction')
             ORDER BY m.time_updated ASC LIMIT ${BATCH_SIZE}`,
      );
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const rows = statement.all(cursor) as unknown as V2MessageRow[];
        if (rows.length === 0) break;
        let maxUpdated = cursor;
        for (const row of rows) {
          const updated = num(row.time_updated);
          if (updated > maxUpdated) maxUpdated = updated;
          const data = parseData(row.data);
          if (!data) continue;
          const call = parseCall(row, data, true, now);
          if (!call) continue;
          if (!call.complete) {
            if (
              updated > 0 &&
              (call.input + call.output + call.reasoning + call.cacheRead + call.cacheWrite > 0 || call.cost > 0)
            ) {
              if (holdWatermark === null || updated < holdWatermark) holdWatermark = updated;
            }
            continue;
          }
          if (row.session_title) call.title = clipTitle(row.session_title);
          call.project = projectPath(data, row.session_directory, row.project_worktree);
          if (call.model === "unknown") {
            if (!modelCache.has(call.session)) modelCache.set(call.session, modelId({}, row.session_model));
            call.model = modelCache.get(call.session) || "unknown";
          }
          countCall(state, call, seen, seenOrder);
        }
        cursor = maxUpdated;
        if (rows.length < BATCH_SIZE) break;
      }
      watermark = Math.max(watermark, cursor);
    }

    // Keep the next scan at the first row that is still streaming. Completed
    // rows in between are skipped by the seen ledger, not counted again.
    if (holdWatermark !== null) watermark = Math.min(watermark, Math.max(0, holdWatermark - 1));
    if (holdLegacy !== null) {
      if (hasV2Messages) legacyWatermark = Math.min(legacyWatermark, Math.max(0, holdLegacy - 1));
      else watermark = Math.min(watermark, Math.max(0, holdLegacy - 1));
    }
    // Keep the legacy cursor in step while there is no legacy table, so a
    // later downgrade or partial migration cannot replay old v1 history.
    if (!hasV1Messages) legacyWatermark = watermark;
    state.opencode.watermark = watermark;
    state.opencode.legacyWatermark = legacyWatermark;
    state.opencode.seen = seenOrder.length > SEEN_LIMIT ? seenOrder.slice(-SEEN_LIMIT) : seenOrder;
  } finally {
    db?.close();
  }
}
