import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { addBucket, recordCall, type ScanState } from "./state";
import { localHourKey, num } from "./util";

export const OPENCODE = "opencode";

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

export async function scanOpencode(state: ScanState): Promise<void> {
  const path = opencodeDbPath();
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
    let watermark = state.opencode.watermark;
    const statement = db.prepare(
      "SELECT id, session_id, time_created, time_updated, data FROM message WHERE time_updated > ? ORDER BY time_updated ASC LIMIT 4000",
    );
    for (let batch = 0; batch < 500; batch += 1) {
      const rows = statement.all(watermark) as unknown as MessageRow[];
      if (rows.length === 0) break;
      for (const row of rows) {
        const updated = num(row.time_updated);
        if (updated > watermark) watermark = updated;
        let data: any;
        try {
          data = JSON.parse(row.data);
        } catch {
          continue;
        }
        if (data?.role !== "assistant") continue;
        const tokens = data.tokens ?? {};
        const cache = tokens.cache ?? {};
        const input = num(tokens.input);
        const output = num(tokens.output);
        const reasoning = num(tokens.reasoning);
        const cacheRead = num(cache.read);
        const cacheWrite = num(cache.write);
        const cost = typeof data.cost === "number" && data.cost > 0 ? data.cost : 0;
        if (input + output + reasoning + cacheRead + cacheWrite <= 0 && cost <= 0) continue;
        const ts = num(data.time?.created) || num(row.time_created);
        const model = typeof data.modelID === "string" && data.modelID ? data.modelID : "unknown";
        const project = typeof data.path?.cwd === "string" ? data.path.cwd : "";
        // Billing semantics: reasoning tokens are part of the generated output,
        // so fold them into `o` (matches CC Switch and real spend). `rz` keeps
        // the reasoning share for display only.
        const outputWithReasoning = output + reasoning;
        addBucket(state.buckets, localHourKey(ts), OPENCODE, model, project, {
          r: 1,
          i: input,
          o: outputWithReasoning,
          cr: cacheRead,
          cw: cacheWrite,
          rz: reasoning,
          cost,
        });
        recordCall(state, OPENCODE, {
          t: ts,
          m: model,
          p: project,
          s: typeof row.session_id === "string" ? row.session_id : "",
          i: input,
          o: outputWithReasoning,
          cr: cacheRead,
          cw: cacheWrite,
          rz: reasoning,
          cost,
          credits: 0,
        });
      }
      if (rows.length < 4000) break;
    }
    state.opencode.watermark = watermark;
  } finally {
    db?.close();
  }
}
