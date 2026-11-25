import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { scanAgy } from "../server/scan/agy";
import { loadSqlite } from "../server/scan/opencode";
import { addBucket, emptyState } from "../server/scan/state";

function varint(value: number): number[] {
  const bytes: number[] = [];
  while (value >= 0x80) {
    bytes.push((value % 0x80) | 0x80);
    value = Math.floor(value / 0x80);
  }
  bytes.push(value);
  return bytes;
}

function field(id: number, value: number | readonly number[]): number[] {
  return typeof value === "number"
    ? [...varint(id * 8), ...varint(value)]
    : [...varint(id * 8 + 2), ...varint(value.length), ...value];
}

function generation(input: number, output: number, cache: number, thinking: number): Uint8Array {
  const usage = [
    ...field(2, input),
    ...field(3, output),
    ...field(4, 12),
    ...field(5, cache),
    ...field(9, thinking),
  ];
  const result = [...field(4, usage), ...field(19, [...Buffer.from("gemini-fixture")])];
  return new Uint8Array([...field(1, result), ...field(2, [...varint(1), ...varint(2)])]);
}

async function check(): Promise<void> {
  const sqlite = await loadSqlite();
  if (!sqlite) {
    console.log("agy scan check skipped (Node 22.5+ required)");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "agent-usage-agy-"));
  try {
    const empty = emptyState();
    await scanAgy(empty, () => false, root);
    assert.deepEqual(empty.recent.agy, []);

    const dir = join(root, "conversations");
    await mkdir(dir);
    const original = "11111111-1111-1111-1111-111111111111";
    const fork = "22222222-2222-2222-2222-222222222222";
    const originalPath = join(dir, original + ".db");
    const forkPath = join(dir, fork + ".db");
    const project = join(root, "example-project");
    const summaries = new sqlite.DatabaseSync(join(root, "conversation_summaries.db"));
    try {
      summaries.exec("CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, workspace_uris TEXT)");
      summaries.prepare("INSERT INTO conversation_summaries VALUES (?, ?)").all(
        original,
        JSON.stringify(["file:///", pathToFileURL(project).href]),
      );
    } finally {
      summaries.close();
    }
    const metadata = new Uint8Array(field(1, [...field(1, 1_800_000_000), ...field(2, 123_456_789)]));
    for (const path of [originalPath, forkPath]) {
      const db = new sqlite.DatabaseSync(path);
      try {
        db.exec("CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, metadata BLOB); CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB)");
        db.prepare("INSERT INTO steps VALUES (1, 15, ?)").all(metadata);
        db.prepare("INSERT INTO steps VALUES (2, 132, ?)").all(metadata);
        db.prepare("INSERT INTO gen_metadata VALUES (0, ?)").all(generation(40, 8, 100, 5));
        db.prepare("INSERT INTO gen_metadata VALUES (1, ?)").all(new Uint8Array([0xff]));
      } finally {
        db.close();
      }
    }
    const state = emptyState();
    addBucket(state.buckets, "2027-01-15T00", "codex", "gpt-fixture", "", { r: 1 });
    await scanAgy(state, () => false, root);
    assert.deepEqual(
      state.recent.agy?.map(({ m, p, i, o, cr, cw, rz }) => ({ m, p, i, o, cr, cw, rz })),
      [{ m: "gemini-fixture", p: project, i: 40, o: 8, cr: 100, cw: 12, rz: 5 }],
    );
    assert.equal(Object.keys(state.sessions).length, 1);
    const first = JSON.stringify(state);
    await scanAgy(state, () => false, root);
    assert.equal(JSON.stringify(state), first);

    await rm(forkPath);
    const db = new sqlite.DatabaseSync(originalPath);
    try {
      db.prepare("UPDATE gen_metadata SET data = ? WHERE idx = 0").all(generation(64, 12, 125, 7));
    } finally {
      db.close();
    }
    await scanAgy(state, () => true, root);
    assert.equal(JSON.stringify(state), first);
    await scanAgy(state, () => false, root);
    assert.deepEqual(Object.values(state.buckets).map(({ r, i, o }) => ({ r, i, o })), [{ r: 1, i: 0, o: 0 }, { r: 1, i: 64, o: 12 }]);

    const snapshot = JSON.stringify(state);
    await writeFile(join(dir, "33333333-3333-3333-3333-333333333333.db"), "invalid SQLite fixture");
    await scanAgy(state, () => false, root);
    assert.equal(JSON.stringify(state), snapshot);

    const locked = new sqlite.DatabaseSync(originalPath);
    try {
      locked.exec("BEGIN EXCLUSIVE");
      await assert.rejects(scanAgy(state, () => false, root), /database is locked/i);
      assert.equal(JSON.stringify(state), snapshot);
    } finally {
      locked.close();
    }

    await rm(originalPath);
    await scanAgy(state, () => false, root);
    assert.equal(JSON.stringify(state), snapshot);

    // Corrupt/unsupported DB on disk must NOT be flagged archived: true when another readable DB exists,
    // and deleting a parent/fork DB must NOT double-count shared calls in the surviving DB.
    const dedupRoot = await mkdtemp(join(tmpdir(), "agent-usage-agy-dedup-"));
    try {
      const dedupDir = join(dedupRoot, "conversations");
      await mkdir(dedupDir);
      const parentId = "aaaaaaaa-0000-0000-0000-000000000001";
      const forkId = "bbbbbbbb-0000-0000-0000-000000000002";
      const corruptId = "cccccccc-0000-0000-0000-000000000003";
      const parentDbPath = join(dedupDir, `${parentId}.db`);
      const forkDbPath = join(dedupDir, `${forkId}.db`);
      const corruptDbPath = join(dedupDir, `${corruptId}.db`);
      const sharedMeta = new Uint8Array(field(1, [...field(1, 1_800_000_000), ...field(2, 100)]));
      const forkOwnMeta = new Uint8Array(field(1, [...field(1, 1_800_000_010), ...field(2, 200)]));

      for (const [dbPath, isFork] of [[parentDbPath, false], [forkDbPath, true]] as const) {
        const handle = new sqlite.DatabaseSync(dbPath);
        try {
          handle.exec("CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, metadata BLOB); CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB)");
          handle.prepare("INSERT INTO steps VALUES (1, 15, ?)").all(sharedMeta);
          handle.prepare("INSERT INTO gen_metadata VALUES (0, ?)").all(generation(40, 8, 100, 5));
          if (isFork) {
            handle.prepare("INSERT INTO steps VALUES (2, 15, ?)").all(forkOwnMeta);
            handle.prepare("INSERT INTO gen_metadata VALUES (1, ?)").all(
              new Uint8Array([...field(1, [...field(4, [...field(2, 20), ...field(3, 4), ...field(4, 0), ...field(5, 0), ...field(9, 0)]), ...field(19, [...Buffer.from("gemini-fixture")])]), ...field(2, [...varint(2)])]),
            );
          }
        } finally {
          handle.close();
        }
      }
      const dedupState = emptyState();
      await scanAgy(dedupState, () => false, dedupRoot);
      assert.equal(Object.values(dedupState.buckets).reduce((sum, b) => sum + b.r, 0), 2, "shared call + fork own call = 2");

      // Delete parent DB and add a corrupt DB on disk: shared call must still be counted ONCE (not twice!)
      await rm(parentDbPath);
      await writeFile(corruptDbPath, "not a sqlite database");
      await scanAgy(dedupState, () => false, dedupRoot);
      assert.equal(Object.values(dedupState.buckets).reduce((sum, b) => sum + b.r, 0), 2, "archived parent + live fork must not double-count shared call");
      assert.equal(dedupState.agy?.[parentId]?.archived, true);
      assert.equal(dedupState.agy?.[corruptId]?.archived, undefined, "corrupt DB still on disk must not be marked archived");
    } finally {
      await rm(dedupRoot, { recursive: true, force: true });
    }
    console.log("agy scan checks passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void check().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
