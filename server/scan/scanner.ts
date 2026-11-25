import { stat } from "node:fs/promises";
import { claudeRoots, scanClaudeFile } from "./claude";
import { codebuddyRoots, scanCodebuddyFile } from "./codebuddy";
import { codexRoots, scanCodexFile } from "./codex";
import { scanOpencode } from "./opencode";
import { piRoots, scanPiFile } from "./pi";
import {
  archiveFileContribution,
  DEFAULT_ARCHIVE_RETENTION_DAYS,
  mergeBuckets,
  mergeSessionEntry,
  pruneArchivedHistory,
  revokeArchivedFile,
  revokeFileContribution,
  type ScanState,
} from "./state";
import { listJsonlFiles } from "./util";
import { AGY, scanAgy } from "./agy";

export interface ScanCallbacks {
  shouldStop(): boolean;
  onProgress(done: number, total: number): void;
  onCheckpoint(): void;
}

export interface ScanOptions {
  /** Days to keep archived history for vanished log files (0 = unlimited, default 0). */
  archiveRetentionDays?: number;
  /** Override wall clock for deterministic retention tests. */
  now?: number;
}

export async function scanAll(
  state: ScanState,
  callbacks: ScanCallbacks,
  enabledHarnesses?: ReadonlySet<string>,
  options?: ScanOptions,
): Promise<void> {
  const on = (id: string) => !enabledHarnesses || enabledHarnesses.has(id);
  const retentionDays = options?.archiveRetentionDays ?? DEFAULT_ARCHIVE_RETENTION_DAYS;
  const now = options?.now ?? Date.now();
  const [claudeFiles, piFiles, codexFiles, codebuddyFiles] = await Promise.all([
    collectRoots(claudeRoots()),
    collectRoots(piRoots()),
    collectRoots(codexRoots()),
    collectRoots(codebuddyRoots()),
  ]);
  await reconcileTrackedFiles(state, new Set(piFiles), [
    ...(on("claude") ? claudeFiles : []),
    ...(on("codex") ? codexFiles : []),
    ...(on("codebuddy") ? codebuddyFiles : []),
  ]);

  const total =
    (on("claude") ? claudeFiles.length : 0) +
    (on("pi") ? piFiles.length : 0) +
    (on("codex") ? codexFiles.length : 0) +
    (on("codebuddy") ? codebuddyFiles.length : 0) +
    (on("opencode") ? 1 : 0) +
    (on(AGY) ? 1 : 0);
  let done = 0;
  let checkpointAt = Date.now();
  callbacks.onProgress(done, total);
  const tick = () => {
    done += 1;
    callbacks.onProgress(done, total);
    const nowTick = Date.now();
    if (nowTick - checkpointAt > 5000) {
      checkpointAt = nowTick;
      callbacks.onCheckpoint();
    }
  };
  const run = async (files: string[], scanOne: (state: ScanState, path: string) => Promise<void>): Promise<boolean> => {
    for (const file of files) {
      if (callbacks.shouldStop()) return false;
      try {
        await scanOne(state, file);
      } catch (error) {
        console.error("[agent-usage] scan failed for", file, error);
      }
      tick();
    }
    return true;
  };
  if (on("claude") && !(await run(claudeFiles, scanClaudeFile))) return;
  if (on("pi") && !(await run(piFiles, scanPiFile))) return;
  if (on("codebuddy") && !(await run(codebuddyFiles, scanCodebuddyFile))) return;
  if (on("opencode")) {
    if (callbacks.shouldStop()) return;
    try {
      await scanOpencode(state);
    } catch (error) {
      console.error("[agent-usage] opencode scan failed", error);
    }
    tick();
  }
  if (on("codex") && !(await run(codexFiles, scanCodexFile))) return;
  if (on(AGY)) {
    if (callbacks.shouldStop()) return;
    try {
      await scanAgy(state, callbacks.shouldStop, undefined, { archiveRetentionDays: retentionDays, now });
    } catch {
      console.warn("[agent-usage] agy scan could not read the local conversation databases");
    }
    tick();
  }
  pruneArchivedHistory(state, retentionDays, now);
  callbacks.onCheckpoint();
}

async function collectRoots(roots: string[]): Promise<string[]> {
  const seen = new Set<string>();
  for (const root of roots) {
    for (const file of await listJsonlFiles(root)) seen.add(file);
  }
  return [...seen].sort();
}

/**
 * Reconciles tracked file offsets against disk without wiping archived history:
 * - Vanished files (`ENOENT`) move their recorded contribution into `state.archive`
 *   and free their dead `state.files[path]` pointer while keeping counted usage.
 * - Shrunk files with a recorded contribution (and no cross-file Pi ledger) are
 *   revoked surgically so only that file is rescanned from offset 0.
 * - Legacy shrunk files without a recorded contribution fall back to resetting
 *   active counters while preserving `state.archive` and `state.agy`.
 */
async function reconcileTrackedFiles(
  state: ScanState,
  piFiles: ReadonlySet<string>,
  reappearingCandidates: readonly string[] = [],
): Promise<void> {
  let needsLegacyReset = false;
  for (const [path, file] of Object.entries(state.files)) {
    if (!file) {
      delete state.files[path];
      continue;
    }
    try {
      const info = await stat(path);
      if (file.offset > 0 && info.isFile() && info.size < file.offset) {
        const hasCompleteLedger = Boolean(file.ledgerFrom0);
        if (hasCompleteLedger && !piFiles.has(path)) {
          console.warn("[agent-usage] log file shrank; rescanning file surgically without dropping archive");
          revokeFileContribution(state, file, path);
          delete state.files[path];
        } else {
          needsLegacyReset = true;
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT") {
        // Deleted/purged file: keep its already-counted history in the durable archive
        // and prune the stale file pointer (freeing any retained per-file recent cache).
        archiveFileContribution(state, file, path);
        delete state.files[path];
      }
    }
  }
  if (state.archive?.files) {
    for (const path of reappearingCandidates) {
      if (state.files[path] || !state.archive.files[path]) continue;
      if (revokeArchivedFile(state, path) === "legacy_reset") {
        needsLegacyReset = true;
      }
    }
  }
  if (needsLegacyReset) {
    console.warn("[agent-usage] legacy log file shrank; resetting active counters while preserving archive");
    resetCountersPreservingArchive(state);
  }
}

function resetCountersPreservingArchive(state: ScanState): void {
  state.buckets = {};
  state.sessions = {};
  state.files = {};
  state.recent = {};
  state.opencode = { watermark: 0, lastId: "" };
  state.pi = { seen: [] };

  // Re-hydrate durable archives for vanished JSONL files and Antigravity DBs.
  if (state.archive) {
    mergeBuckets(state.buckets, state.archive.buckets, 1);
    for (const [key, entry] of Object.entries(state.archive.sessions)) {
      mergeSessionEntry(state.sessions, key, entry, 1);
    }
  }
  if (state.agy) {
    for (const [sid, conv] of Object.entries(state.agy)) {
      mergeBuckets(state.buckets, conv.buckets, 1);
      if (conv.session) mergeSessionEntry(state.sessions, `${AGY}\u0001${sid}`, conv.session, 1);
    }
  }
}
