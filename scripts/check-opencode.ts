import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanOpencode } from "../server/scan/opencode";
import { emptyState, type ScanState } from "../server/scan/state";

/** Minimal deterministic timestamps; every fixture is far enough in the past
 *  that a missing terminal marker is treated as a finished legacy row. */
const BASE = Date.now() - 48 * 60 * 60 * 1000;

type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): { run(...params: unknown[]): unknown };
  close(): void;
};

function openSqlite(): { DatabaseSync: new (path: string) => Sqlite } | null {
  try {
    const requireFn = createRequire(import.meta.url);
    return requireFn("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };
  } catch {
    return null;
  }
}

const sqlite = openSqlite();
if (!sqlite) {
  console.log("opencode checks skipped: node:sqlite unavailable (needs Node >= 22.5)");
  process.exit(0);
}
const DatabaseSync = sqlite.DatabaseSync;

function v1Database(path: string): Sqlite {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);
  return db;
}

function v2Database(path: string): Sqlite {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL);
    CREATE TABLE session_v2 (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT,
      model TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
    CREATE TABLE session_message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      seq INTEGER NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);
  return db;
}

function insertV1(
  db: Sqlite,
  row: { id: string; session: string; role: string; created: number; updated: number; data: Record<string, unknown> },
): void {
  db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)").run(
    row.id,
    row.session,
    row.created,
    row.updated,
    JSON.stringify({ role: row.role, time: { created: row.created, completed: row.updated }, ...row.data }),
  );
}

function insertV2(
  db: Sqlite,
  row: { id: string; session: string; type: string; seq: number; created: number; updated: number; data: Record<string, unknown> },
): void {
  db.prepare(
    "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(row.id, row.session, row.type, row.seq, row.created, row.updated, JSON.stringify(row.data));
}

function totals(state: ScanState): { r: number; i: number; o: number; cr: number; cw: number; rz: number; cost: number } {
  const result = { r: 0, i: 0, o: 0, cr: 0, cw: 0, rz: 0, cost: 0 };
  for (const [key, value] of Object.entries(state.buckets)) {
    if (key.split("\u0001")[1] !== "opencode") continue;
    result.r += value.r;
    result.i += value.i;
    result.o += value.o;
    result.cr += value.cr;
    result.cw += value.cw;
    result.rz += value.rz;
    result.cost += value.cost;
  }
  return result;
}

function modelTotal(state: ScanState, model: string): number {
  return Object.entries(state.buckets)
    .filter(([key]) => {
      const parts = key.split("\u0001");
      return parts[1] === "opencode" && parts[2] === model;
    })
    .reduce((sum, [, value]) => sum + value.r + value.i + value.o + value.cr + value.cw, 0);
}

function clone(state: ScanState): ScanState {
  return JSON.parse(JSON.stringify(state)) as ScanState;
}

function near(actual: number, expected: number, message: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "agent-usage-opencode-"));
  try {
    // 1. Legacy-only database: assistant rows are counted, non-assistant rows
    //    are ignored, and a stale row without time.completed is still history.
    {
      const path = join(root, "v1.db");
      const db = v1Database(path);
      db.prepare("INSERT INTO session (id, title) VALUES (?, ?)").run("s1", "Legacy session");
      insertV1(db, {
        id: "m1",
        session: "s1",
        role: "assistant",
        created: BASE,
        updated: BASE + 1_000,
        data: {
          modelID: "claude-test",
          path: { cwd: "/work/legacy" },
          tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 50, write: 7 } },
          cost: 0.01,
        },
      });
      insertV1(db, {
        id: "m2",
        session: "s1",
        role: "user",
        created: BASE + 2_000,
        updated: BASE + 2_000,
        data: { text: "hello" },
      });
      insertV1(db, {
        id: "m3",
        session: "s1",
        role: "assistant",
        created: BASE + 3_000,
        updated: BASE + 3_000,
        data: {
          modelID: "claude-test",
          path: { cwd: "/work/legacy" },
          tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 0, write: 0 } },
          cost: 0,
        },
      });
      db.close();

      const state = emptyState();
      await scanOpencode(state, path);
      const sum = totals(state);
      assert.equal(sum.r, 2, "v1: two assistant calls");
      assert.equal(sum.i, 110);
      assert.equal(sum.o, 28, "v1: reasoning folded into output");
      assert.equal(sum.rz, 6);
      assert.equal(sum.cr, 50);
      assert.equal(sum.cw, 7);
      near(sum.cost, 0.01, "v1: recorded cost");
      assert.equal(state.sessions["opencode\u0001s1"]?.title, "Legacy session");
      assert.equal(state.sessions["opencode\u0001s1"]?.p, "/work/legacy");

      const before = JSON.stringify({ buckets: state.buckets, sessions: state.sessions });
      await scanOpencode(state, path);
      assert.equal(JSON.stringify({ buckets: state.buckets, sessions: state.sessions }), before, "v1: rescan is a no-op");
    }

    // 2. V2-only database: compaction usage is counted, a pending compaction
    //    is skipped, model/directory come from the session row, and reasoning
    //    is added to output exactly once.
    {
      const path = join(root, "v2.db");
      const db = v2Database(path);
      db.prepare("INSERT INTO project (id, worktree) VALUES (?, ?)").run("p1", "/work/project");
      db.prepare(
        "INSERT INTO session_v2 (id, project_id, directory, title, model, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("s2", "p1", "/work/project/sub", "V2 session", '{"id":"fallback-model","providerID":"prov"}', BASE, BASE + 5_000);
      insertV2(db, {
        id: "m4",
        session: "s2",
        type: "assistant",
        seq: 1,
        created: BASE,
        updated: BASE + 1_000,
        data: {
          time: { created: BASE, completed: BASE + 1_000 },
          model: { id: "m2", providerID: "prov" },
          tokens: { input: 200, output: 30, reasoning: 10, cache: { read: 80, write: 4 } },
          cost: 0.02,
        },
      });
      insertV2(db, {
        id: "m5",
        session: "s2",
        type: "compaction",
        seq: 2,
        created: BASE + 2_000,
        updated: BASE + 2_500,
        data: {
          status: "completed",
          time: { created: BASE + 2_000 },
          model: { id: "m2", providerID: "prov" },
          tokens: { input: 300, output: 40, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.03,
        },
      });
      insertV2(db, {
        id: "m6",
        session: "s2",
        type: "compaction",
        seq: 3,
        created: Date.now() - 60_000,
        updated: Date.now() - 60_000,
        data: {
          status: "pending",
          time: { created: Date.now() - 60_000 },
          model: { id: "m2", providerID: "prov" },
          tokens: { input: 999, output: 999, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 9,
        },
      });
      insertV2(db, {
        id: "m7",
        session: "s2",
        type: "compaction",
        seq: 4,
        created: BASE + 4_000,
        updated: BASE + 4_500,
        data: {
          status: "failed",
          time: { created: BASE + 4_000 },
          model: { id: "m2", providerID: "prov" },
          tokens: { input: 50, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.001,
        },
      });
      db.close();

      const state = emptyState();
      await scanOpencode(state, path);
      const sum = totals(state);
      assert.equal(sum.r, 3, "v2: assistant + completed compaction + failed compaction");
      assert.equal(sum.i, 550);
      assert.equal(sum.o, 85, "v2: output + reasoning for all calls");
      assert.equal(sum.rz, 10);
      assert.equal(sum.cr, 80);
      assert.equal(sum.cw, 4);
      near(sum.cost, 0.051, "v2: recorded cost");
      assert.equal(modelTotal(state, "m2") > 0, true);
      assert.equal(modelTotal(state, "fallback-model"), 0, "v2: per-message model wins");
      assert.equal(state.sessions["opencode\u0001s2"]?.p, "/work/project/sub");
      assert.equal(state.sessions["opencode\u0001s2"]?.title, "V2 session");
    }

    // 3. Mixed database: legacy rows are counted once even when the v2
    //    projection holds a copy with the same message id.
    {
      const path = join(root, "mixed.db");
      const db = v1Database(path);
      db.exec(`
        CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL);
        CREATE TABLE session_v2 (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL, directory TEXT NOT NULL,
          title TEXT, model TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
        );
        CREATE TABLE session_message (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL,
          time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
        );
      `);
      db.prepare("INSERT INTO project (id, worktree) VALUES (?, ?)").run("p1", "/work/project");
      db.prepare(
        "INSERT INTO session_v2 (id, project_id, directory, title, model, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("s-shared", "p1", "/work/project", "Shared session", '{"id":"m2"}', BASE, BASE + 5_000);
      db.prepare("INSERT INTO session (id, title) VALUES (?, ?)").run("s-legacy", "Legacy only");
      db.prepare("INSERT INTO session (id, title) VALUES (?, ?)").run("s-shared", "Shared session");

      const usage = {
        modelID: "m1",
        path: { cwd: "/work/legacy" },
        tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0.01,
      };
      insertV1(db, { id: "m-legacy", session: "s-legacy", role: "assistant", created: BASE, updated: BASE + 1_000, data: usage });
      insertV1(db, { id: "m-shared", session: "s-shared", role: "assistant", created: BASE, updated: BASE + 1_000, data: usage });
      insertV2(db, {
        id: "m-shared",
        session: "s-shared",
        type: "assistant",
        seq: 1,
        created: BASE,
        updated: BASE + 1_000,
        data: {
          time: { created: BASE, completed: BASE + 1_000 },
          model: { id: "m1" },
          tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.01,
        },
      });
      insertV2(db, {
        id: "m-new",
        session: "s-shared",
        type: "assistant",
        seq: 2,
        created: BASE + 2_000,
        updated: BASE + 2_000,
        data: {
          time: { created: BASE + 2_000, completed: BASE + 2_500 },
          model: { id: "m1" },
          tokens: { input: 50, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.005,
        },
      });
      db.close();

      const state = emptyState();
      await scanOpencode(state, path);
      const sum = totals(state);
      assert.equal(sum.r, 3, "mixed: legacy only + shared copy + new v2 row");
      assert.equal(sum.i, 250);
      assert.equal(sum.o, 25);
      assert.equal(state.sessions["opencode\u0001s-legacy"]?.title, "Legacy only");
      assert.equal(state.sessions["opencode\u0001s-shared"]?.title, "Shared session");

      // Upgrade path: prior state already counted the legacy rows. The v2 copy
      // must not be counted again, while a newer v2 turn must be.
      const upgraded = emptyState();
      upgraded.opencode.watermark = BASE + 2_500;
      upgraded.opencode.lastId = "";
      upgraded.buckets = clone(state).buckets;
      upgraded.sessions = clone(state).sessions;
      upgraded.opencode.seen = [];
      const before = totals(upgraded);
      await scanOpencode(upgraded, path);
      assert.equal(totals(upgraded).r, before.r, "upgrade: old rows are not recounted");
    }

    // 4. Incremental scan and restart: state survives a JSON round trip and a
    //    new completed row is counted exactly once.
    {
      const path = join(root, "incremental.db");
      const db = v2Database(path);
      db.prepare("INSERT INTO project (id, worktree) VALUES (?, ?)").run("p1", "/work/project");
      db.prepare(
        "INSERT INTO session_v2 (id, project_id, directory, title, model, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("s3", "p1", "/work/project", "Incremental", '{"id":"m3"}', BASE, BASE + 5_000);
      insertV2(db, {
        id: "a1",
        session: "s3",
        type: "assistant",
        seq: 1,
        created: BASE,
        updated: BASE + 1_000,
        data: {
          time: { created: BASE, completed: BASE + 1_000 },
          model: { id: "m3" },
          tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0,
        },
      });
      const state = emptyState();
      await scanOpencode(state, path);
      assert.equal(totals(state).r, 1);

      const restarted = clone(state);
      await scanOpencode(restarted, path);
      assert.equal(totals(restarted).r, 1, "restart: no duplicate");
      assert.equal(restarted.opencode.seen?.length, 1);

      insertV2(db, {
        id: "a2",
        session: "s3",
        type: "assistant",
        seq: 2,
        created: BASE + 2_000,
        updated: BASE + 2_000,
        data: {
          time: { created: BASE + 2_000, completed: BASE + 2_500 },
          model: { id: "m3" },
          tokens: { input: 20, output: 2, reasoning: 1, cache: { read: 3, write: 0 } },
          cost: 0.001,
        },
      });
      db.close();
      await scanOpencode(restarted, path);
      assert.equal(totals(restarted).r, 2, "incremental: only the new row is added");
      assert.equal(restarted.opencode.seen?.length, 2);
    }

    // 5. In-flight messages are deferred, then counted once after completion.
    //    The watermark stays below the streaming row so the next scan retries.
    {
      const path = join(root, "inflight.db");
      const db = v2Database(path);
      db.prepare("INSERT INTO project (id, worktree) VALUES (?, ?)").run("p1", "/work/project");
      db.prepare(
        "INSERT INTO session_v2 (id, project_id, directory, title, model, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("s4", "p1", "/work/project", "In flight", '{"id":"m4"}', BASE, Date.now());
      const created = Date.now() - 5_000;
      const partial = {
        time: { created, streamed: created + 1_000 },
        model: { id: "m4" },
        tokens: { input: 40, output: 4, reasoning: 2, cache: { read: 0, write: 0 } },
        cost: 0.002,
      };
      insertV2(db, { id: "live", session: "s4", type: "assistant", seq: 1, created, updated: created + 1_000, data: partial });

      const state = emptyState();
      await scanOpencode(state, path);
      assert.equal(totals(state).r, 0, "in-flight: not counted yet");
      assert.equal(state.opencode.watermark < created + 1_000, true, "in-flight: watermark is held");

      const completed = {
        ...partial,
        time: { created, streamed: created + 1_000, completed: created + 2_000 },
      };
      db.prepare("UPDATE session_message SET data = ?, time_updated = ? WHERE id = ?").run(
        JSON.stringify(completed),
        created + 2_000,
        "live",
      );
      db.close();
      await scanOpencode(state, path);
      assert.equal(totals(state).r, 1, "in-flight: counted after completion");
      assert.equal(totals(state).o, 6);
      assert.equal(totals(state).cost, 0.002);
      await scanOpencode(state, path);
      assert.equal(totals(state).r, 1, "in-flight: no duplicate after completion");
    }

    // 6. Existing buckets and sessions (Claude/Codex/Pi and old OpenCode
    //    history) are never rewritten by an OpenCode scan.
    {
      const path = join(root, "existing.db");
      const db = v2Database(path);
      db.close();
      const state = emptyState();
      const key = "2026-01-01T00\u0001claude\u0001claude-test\u0001/work/other";
      state.buckets[key] = { r: 3, i: 30, o: 6, cr: 0, cw: 0, rz: 0, cost: 0.1, credits: 0 };
      state.sessions["claude\u0001old"] = {
        s: 1,
        e: 2,
        r: 3,
        i: 30,
        o: 6,
        cr: 0,
        cw: 0,
        rz: 0,
        cost: 0.1,
        credits: 0,
        p: "/work/other",
      };
      const before = JSON.stringify({ buckets: state.buckets, sessions: state.sessions });
      await scanOpencode(state, path);
      assert.equal(
        JSON.stringify({ buckets: state.buckets, sessions: state.sessions }),
        before,
        "empty OpenCode store leaves other stats untouched",
      );
    }

    console.log("opencode checks passed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
