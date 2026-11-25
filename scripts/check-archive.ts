import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanAgy } from "../server/scan/agy";
import { loadSqlite } from "../server/scan/opencode";
import { scanAll } from "../server/scan/scanner";
import {
  addBucket,
  applySession,
  DEFAULT_ARCHIVE_RETENTION_DAYS,
  emptyState,
  loadState,
  pruneArchivedHistory,
  saveState,
  type ScanState,
} from "../server/scan/state";

function claudeRow(options: {
  id: string;
  sessionId: string;
  timestamp: string;
  model: string;
  cwd: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}): string {
  return JSON.stringify({
    type: "assistant",
    sessionId: options.sessionId,
    timestamp: options.timestamp,
    cwd: options.cwd,
    message: {
      id: options.id,
      model: options.model,
      usage: {
        input_tokens: options.input,
        output_tokens: options.output,
        cache_read_input_tokens: options.cacheRead,
        cache_creation_input_tokens: options.cacheWrite,
      },
    },
  });
}

function claudeUserRow(sessionId: string, text: string): string {
  return JSON.stringify({
    type: "user",
    sessionId,
    message: { role: "user", content: text },
  });
}

function sumHarness(state: ScanState, harness: string): { r: number; i: number; o: number; cr: number; cw: number } {
  const out = { r: 0, i: 0, o: 0, cr: 0, cw: 0 };
  for (const [key, bucket] of Object.entries(state.buckets)) {
    if (key.split("\u0001", 2)[1] !== harness) continue;
    out.r += bucket.r;
    out.i += bucket.i;
    out.o += bucket.o;
    out.cr += bucket.cr;
    out.cw += bucket.cw;
  }
  return out;
}

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

function agyGeneration(model: string, input: number, output: number, cacheRead: number, cacheWrite: number): Uint8Array {
  const usage = [
    ...field(2, input),
    ...field(3, output),
    ...field(4, cacheWrite),
    ...field(5, cacheRead),
  ];
  const result = [...field(4, usage), ...field(19, [...Buffer.from(model)])];
  return new Uint8Array([...field(1, result), ...field(2, [...varint(1)])]);
}

const noopCallbacks = {
  shouldStop: () => false,
  onProgress: () => {},
  onCheckpoint: () => {},
};

async function checkPurgedClaudeSurvivesFileShrink(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "agent-usage-archive-claude-"));
  const previousClaudeDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = root;
  try {
    const projectDir = join(root, "projects", "acme-project");
    await mkdir(projectDir, { recursive: true });
    const now = Date.now();
    const recentIso = new Date(now - 2 * 86_400_000).toISOString();
    const olderWithin92dIso = new Date(now - 35 * 86_400_000).toISOString();

    const purgedPath = join(projectDir, "sess-purged.jsonl");
    const activePath = join(projectDir, "sess-active.jsonl");

    await writeFile(
      purgedPath,
      [
        claudeUserRow("sess-purged", "Purged historical session"),
        claudeRow({
          id: "msg-purged-1",
          sessionId: "sess-purged",
          timestamp: olderWithin92dIso,
          model: "claude-sonnet-4-6",
          cwd: "/workspace/acme-project",
          input: 1000,
          output: 200,
          cacheRead: 5000,
          cacheWrite: 300,
        }),
      ].join("\n") + "\n",
    );

    await writeFile(
      activePath,
      [
        claudeUserRow("sess-active", "Active session"),
        claudeRow({
          id: "msg-active-1",
          sessionId: "sess-active",
          timestamp: recentIso,
          model: "claude-sonnet-4-6",
          cwd: "/workspace/acme-project",
          input: 400,
          output: 80,
          cacheRead: 1000,
          cacheWrite: 0,
        }),
        claudeRow({
          id: "msg-active-2",
          sessionId: "sess-active",
          timestamp: recentIso,
          model: "claude-sonnet-4-6",
          cwd: "/workspace/acme-project",
          input: 200,
          output: 40,
          cacheRead: 500,
          cacheWrite: 0,
        }),
      ].join("\n") + "\n",
    );

    const state = emptyState();
    await scanAll(state, noopCallbacks, new Set(["claude"]));
    assert.deepEqual(sumHarness(state, "claude"), { r: 3, i: 1600, o: 320, cr: 6500, cw: 300 });
    assert.equal(state.sessions["claude\u0001sess-purged"]?.r, 1);
    assert.equal(state.sessions["claude\u0001sess-active"]?.r, 2);

    // Simulate Claude Code 30-day auto-purge deleting the historical JSONL file.
    await rm(purgedPath);
    await scanAll(state, noopCallbacks, new Set(["claude"]));
    assert.deepEqual(sumHarness(state, "claude"), { r: 3, i: 1600, o: 320, cr: 6500, cw: 300 });
    assert.equal(state.sessions["claude\u0001sess-purged"]?.r, 1, "purged session must survive rescan");
    assert.equal(state.files[purgedPath], undefined, "dead tracked file pointer should be pruned after archiving");

    // Now shrink the remaining active log file (simulating compaction/truncation).
    // Purged history from sess-purged MUST still survive!
    await writeFile(
      activePath,
      [
        claudeUserRow("sess-active", "Active session"),
        claudeRow({
          id: "msg-active-1",
          sessionId: "sess-active",
          timestamp: recentIso,
          model: "claude-sonnet-4-6",
          cwd: "/workspace/acme-project",
          input: 300,
          output: 50,
          cacheRead: 900,
          cacheWrite: 0,
        }),
      ].join("\n") + "\n",
    );

    await scanAll(state, noopCallbacks, new Set(["claude"]));
    assert.deepEqual(
      sumHarness(state, "claude"),
      { r: 2, i: 1300, o: 250, cr: 5900, cw: 300 },
      "purged historical tokens must survive when another tracked file shrinks",
    );
    assert.equal(state.sessions["claude\u0001sess-purged"]?.r, 1, "purged session must survive single-file shrink");
    assert.equal(state.sessions["claude\u0001sess-active"]?.r, 1, "shrunk active file must be recounted cleanly");

    // Persistence round-trip check
    const dataDir = join(root, "state-dir");
    await saveState(dataDir, state);
    const reloaded = await loadState(dataDir);
    assert.deepEqual(sumHarness(reloaded, "claude"), { r: 2, i: 1300, o: 250, cr: 5900, cw: 300 });
    assert.equal(reloaded.sessions["claude\u0001sess-purged"]?.r, 1);
  } finally {
    if (previousClaudeDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeDir;
    await rm(root, { recursive: true, force: true });
  }
}

async function checkPurgedAgySurvivesWhileOtherDbRemains(): Promise<void> {
  const sqlite = await loadSqlite();
  if (!sqlite) {
    console.log("agy archive check skipped (Node 22.5+ required)");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "agent-usage-archive-agy-"));
  try {
    const dir = join(root, "conversations");
    await mkdir(dir, { recursive: true });
    const convA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const convB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const pathA = join(dir, `${convA}.db`);
    const pathB = join(dir, `${convB}.db`);
    const nowSec = Math.floor(Date.now() / 1000);

    const writeDb = (file: string, seconds: number, input: number, output: number, cacheRead: number) => {
      const db = new sqlite.DatabaseSync(file);
      try {
        db.exec("CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, metadata BLOB); CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB)");
        const metadata = new Uint8Array(field(1, [...field(1, seconds), ...field(2, 0)]));
        db.prepare("INSERT INTO steps VALUES (1, 15, ?)").all(metadata);
        db.prepare("INSERT INTO gen_metadata VALUES (0, ?)").all(agyGeneration("gemini-3-flash", input, output, cacheRead, 0));
      } finally {
        db.close();
      }
    };

    writeDb(pathA, nowSec - 10 * 86_400, 500, 100, 2000);
    writeDb(pathB, nowSec - 1 * 86_400, 700, 150, 3000);

    const state = emptyState();
    await scanAgy(state, () => false, root);
    assert.deepEqual(sumHarness(state, "agy"), { r: 2, i: 1200, o: 250, cr: 5000, cw: 0 });
    assert.equal(state.sessions[`agy\u0001${convA}`]?.r, 1);
    assert.equal(state.sessions[`agy\u0001${convB}`]?.r, 1);

    // Delete convA.db while convB.db remains on disk.
    await rm(pathA);
    await scanAgy(state, () => false, root);

    assert.deepEqual(
      sumHarness(state, "agy"),
      { r: 2, i: 1200, o: 250, cr: 5000, cw: 0 },
      "deleted agy conversation DB must survive rescan when other DBs remain on disk",
    );
    assert.equal(state.sessions[`agy\u0001${convA}`]?.r, 1, "deleted agy session must survive rescan");
    assert.equal(state.sessions[`agy\u0001${convB}`]?.r, 1);

    // Regression: a 120-day-old LIVE on-disk agy DB must NEVER be pruned by retention,
    // while a 120-day-old DELETED agy DB MUST be pruned when retention is 92 days.
    const convOldLive = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const convOldDeleted = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const pathOldLive = join(dir, `${convOldLive}.db`);
    const pathOldDeleted = join(dir, `${convOldDeleted}.db`);
    writeDb(pathOldLive, nowSec - 120 * 86_400, 400, 80, 1000);
    writeDb(pathOldDeleted, nowSec - 120 * 86_400, 600, 90, 1500);
    await scanAgy(state, () => false, root, { archiveRetentionDays: 92 });
    await rm(pathOldDeleted);
    await scanAgy(state, () => false, root, { archiveRetentionDays: 92 });
    // Calling pruneArchivedHistory independently (as scanAll and prefsSet do) must also keep convOldLive intact!
    pruneArchivedHistory(state, 92);

    assert.equal(state.sessions[`agy\u0001${convOldLive}`]?.r, 1, "live 120d-old on-disk agy DB must survive 92d archive retention");
    assert.equal(state.sessions[`agy\u0001${convOldDeleted}`], undefined, "deleted 120d-old agy DB must be pruned under 92d retention");
    assert.equal(state.agy?.[convOldLive]?.archived, undefined, "live on-disk agy DB must not be flagged archived");
    assert.equal(state.agy?.[convA]?.archived, true, "deleted recent agy DB must be flagged archived");
    assert.deepEqual(sumHarness(state, "agy"), { r: 3, i: 1600, o: 330, cr: 6000, cw: 0 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function checkArchiveRetentionPolicy(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "agent-usage-archive-retention-"));
  const previousClaudeDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = root;
  try {
    const projectDir = join(root, "projects", "acme-retention");
    await mkdir(projectDir, { recursive: true });
    const now = Date.now();
    const day10Iso = new Date(now - 10 * 86_400_000).toISOString();
    const day120Iso = new Date(now - 120 * 86_400_000).toISOString();

    const recentPath = join(projectDir, "sess-10d.jsonl");
    const oldPath = join(projectDir, "sess-120d.jsonl");
    await writeFile(
      recentPath,
      claudeRow({
        id: "msg-10d",
        sessionId: "sess-10d",
        timestamp: day10Iso,
        model: "claude-sonnet-4-6",
        cwd: "/workspace/acme-retention",
        input: 500,
        output: 100,
        cacheRead: 0,
        cacheWrite: 0,
      }) + "\n",
    );
    await writeFile(
      oldPath,
      claudeRow({
        id: "msg-120d",
        sessionId: "sess-120d",
        timestamp: day120Iso,
        model: "claude-sonnet-4-6",
        cwd: "/workspace/acme-retention",
        input: 900,
        output: 150,
        cacheRead: 0,
        cacheWrite: 0,
      }) + "\n",
    );

    // Unlimited retention (0) preserves both 10d and 120d deleted files.
    const unlimitedState = emptyState();
    await scanAll(unlimitedState, noopCallbacks, new Set(["claude"]), { archiveRetentionDays: 0, now });
    await rm(recentPath);
    await rm(oldPath);
    await scanAll(unlimitedState, noopCallbacks, new Set(["claude"]), { archiveRetentionDays: 0, now });
    assert.deepEqual(sumHarness(unlimitedState, "claude"), { r: 2, i: 1400, o: 250, cr: 0, cw: 0 });
    assert.equal(unlimitedState.sessions["claude\u0001sess-10d"]?.r, 1);
    assert.equal(unlimitedState.sessions["claude\u0001sess-120d"]?.r, 1);

    // Tightening retention to 92 days prunes the 120d vanished archive while keeping the 10d archive.
    await scanAll(unlimitedState, noopCallbacks, new Set(["claude"]), { archiveRetentionDays: 92, now });
    assert.deepEqual(sumHarness(unlimitedState, "claude"), { r: 1, i: 500, o: 100, cr: 0, cw: 0 });
    assert.equal(unlimitedState.sessions["claude\u0001sess-10d"]?.r, 1);
    assert.equal(unlimitedState.sessions["claude\u0001sess-120d"], undefined);
  } finally {
    if (previousClaudeDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeDir;
    await rm(root, { recursive: true, force: true });
  }
}

async function checkLegacyShrinkRecentDedupAndTransientEnoent(): Promise<void> {
  assert.equal(DEFAULT_ARCHIVE_RETENTION_DAYS, 0, "default archive retention must be unlimited (0)");
  const root = await mkdtemp(join(tmpdir(), "agent-usage-archive-edge-"));
  const previousClaudeDir = process.env.CLAUDE_CONFIG_DIR;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CLAUDE_CONFIG_DIR = join(root, "claude");
  process.env.CODEX_HOME = join(root, "codex");
  try {
    const projectDir = join(root, "claude", "projects", "acme-edge");
    await mkdir(projectDir, { recursive: true });
    const now = Date.now();
    const tsIso = new Date(now - 3600_000).toISOString();
    const hourKey = `${tsIso.slice(0, 10)}T${String(new Date(tsIso).getHours()).padStart(2, "0")}`;

    // 1. Legacy v13 state partial ledger shrink: rows A,B pre-upgrade -> append C -> shrink back to A,B => 2 requests (not 4)
    const legacyPath = join(projectDir, "sess-legacy.jsonl");
    const rowA = claudeRow({ id: "msg-a", sessionId: "sess-legacy", timestamp: tsIso, model: "claude-sonnet-4-6", cwd: "/workspace/acme", input: 100, output: 10, cacheRead: 0, cacheWrite: 0 });
    const rowB = claudeRow({ id: "msg-b", sessionId: "sess-legacy", timestamp: tsIso, model: "claude-sonnet-4-6", cwd: "/workspace/acme", input: 200, output: 20, cacheRead: 0, cacheWrite: 0 });
    const rowC = claudeRow({ id: "msg-c", sessionId: "sess-legacy", timestamp: tsIso, model: "claude-sonnet-4-6", cwd: "/workspace/acme", input: 300, output: 30, cacheRead: 0, cacheWrite: 0 });
    const initialBody = `${rowA}\n${rowB}\n`;
    await writeFile(legacyPath, initialBody);

    const legacyState = emptyState();
    addBucket(legacyState.buckets, hourKey, "claude", "claude-sonnet-4-6", "/workspace/acme", { r: 2, i: 300, o: 30, cr: 0, cw: 0 });
    applySession(legacyState.sessions, "claude", "sess-legacy", { t: Date.parse(tsIso), r: 2, p: "/workspace/acme", model: "claude-sonnet-4-6", i: 300, o: 30, cr: 0, cw: 0 });
    legacyState.files[legacyPath] = { offset: Buffer.byteLength(initialBody), size: Buffer.byteLength(initialBody), mtimeMs: Date.now() };

    await writeFile(legacyPath, `${rowA}\n${rowB}\n${rowC}\n`);
    await scanAll(legacyState, noopCallbacks, new Set(["claude"]));
    assert.equal(sumHarness(legacyState, "claude").r, 3);

    await writeFile(legacyPath, initialBody);
    await scanAll(legacyState, noopCallbacks, new Set(["claude"]));
    assert.equal(sumHarness(legacyState, "claude").r, 2, "legacy partial-ledger shrink must fall back cleanly to 2 requests");
    assert.equal(legacyState.sessions["claude\u0001sess-legacy"]?.r, 2);

    // 2. Surgical shrink on Codex must NOT duplicate state.recent entries
    const codexDir = join(root, "codex", "sessions", "2026", "11", "25");
    await mkdir(codexDir, { recursive: true });
    const codexPath = join(codexDir, "rollout-1.jsonl");
    const codexLine = (idx: number, totalInput: number) =>
      JSON.stringify({
        timestamp: new Date(now - (10 - idx) * 60_000).toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: totalInput, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 10 * idx, reasoning_output_tokens: 0, total_tokens: totalInput + 10 * idx },
          },
        },
      });
    const codexMeta = JSON.stringify({ timestamp: tsIso, type: "session_meta", payload: { id: "codex-sess-1", cwd: "/workspace/acme" } });
    const codexCtx = JSON.stringify({ timestamp: tsIso, type: "turn_context", payload: { model: "gpt-5.3-codex" } });
    await writeFile(codexPath, [codexMeta, codexCtx, codexLine(1, 100), codexLine(2, 250)].join("\n") + "\n");

    const codexState = emptyState();
    await scanAll(codexState, noopCallbacks, new Set(["codex"]));
    assert.equal(codexState.recent.codex?.length, 2);

    await writeFile(codexPath, [codexMeta, codexCtx, codexLine(1, 100)].join("\n") + "\n");
    await scanAll(codexState, noopCallbacks, new Set(["codex"]));
    assert.equal(sumHarness(codexState, "codex").r, 1);
    assert.equal(codexState.recent.codex?.length, 1, "surgical shrink must drop stale state.recent samples for the shrunk file");

    // 3. Transient ENOENT (unmounted/renamed file reappearing) must revoke its archived copy instead of double-counting
    await rm(legacyPath);
    const movedPath = join(projectDir, "sess-transient.jsonl");
    const transientContent = `${claudeRow({ id: "msg-tr-1", sessionId: "sess-transient", timestamp: tsIso, model: "claude-sonnet-4-6", cwd: "/workspace/acme", input: 400, output: 40, cacheRead: 0, cacheWrite: 0 })}\n`;
    await writeFile(movedPath, transientContent);
    const transientState = emptyState();
    await scanAll(transientState, noopCallbacks, new Set(["claude"]));
    assert.equal(sumHarness(transientState, "claude").r, 1);

    await rm(movedPath);
    await scanAll(transientState, noopCallbacks, new Set(["claude"]));
    assert.equal(sumHarness(transientState, "claude").r, 1, "archived while missing");

    await writeFile(movedPath, transientContent);
    await scanAll(transientState, noopCallbacks, new Set(["claude"]));
    assert.equal(sumHarness(transientState, "claude").r, 1, "reappearing file must revoke archive and not double-count");
    assert.equal(transientState.sessions["claude\u0001sess-transient"]?.r, 1);
    assert.equal(transientState.recent.claude?.filter((item) => item.s === "sess-transient").length, 1);

    // 4. Remote collector bundle must honor --archive-retention-days
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const collectorCache = join(root, "collector-cache");
    const oldCollectorPath = join(projectDir, "sess-collector-old.jsonl");
    const old120Iso = new Date(now - 120 * 86_400_000).toISOString();
    await rm(movedPath);
    await writeFile(
      oldCollectorPath,
      `${claudeRow({ id: "msg-col-old", sessionId: "sess-col-old", timestamp: old120Iso, model: "claude-sonnet-4-6", cwd: "/workspace/acme", input: 300, output: 30, cacheRead: 0, cacheWrite: 0 })}\n`,
    );
    const collectorBundle = join(process.cwd(), "server", "remote", "collector.bundle.js");
    const runCollector = async (retentionArg?: number) => {
      const args = [collectorBundle, "--cache-dir", collectorCache];
      if (retentionArg !== undefined) args.push("--archive-retention-days", String(retentionArg));
      const { stdout } = await execFileAsync(process.execPath, args, {
        env: { ...process.env, HOME: root, CODEX_HOME: join(root, "empty-codex"), CODEBUDDY_CONFIG_DIR: join(root, "empty-cb"), PI_CODING_AGENT_DIR: join(root, "empty-pi"), XDG_DATA_HOME: join(root, "empty-xdg") },
      });
      return JSON.parse(stdout) as { buckets: Record<string, unknown>; sessions: Record<string, unknown> };
    };
    const firstCol = await runCollector(0);
    assert.ok(firstCol.sessions["claude\u0001sess-col-old"]);
    await rm(oldCollectorPath);
    const archivedCol = await runCollector(0);
    assert.ok(archivedCol.sessions["claude\u0001sess-col-old"], "collector default/0 retention keeps archived 120d session");
    const prunedCol = await runCollector(92);
    assert.equal(prunedCol.sessions["claude\u0001sess-col-old"], undefined, "collector --archive-retention-days 92 must prune expired 120d archive");
  } finally {
    if (previousClaudeDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeDir;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await rm(root, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await checkPurgedClaudeSurvivesFileShrink();
  await checkPurgedAgySurvivesWhileOtherDbRemains();
  await checkArchiveRetentionPolicy();
  await checkLegacyShrinkRecentDedupAndTransientEnoent();
  console.log("archive checks passed");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
