import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentReport, buildReport } from "../server/report";
import { addBucket, applySession, emptyState, recordCall, saveState } from "../server/scan/state";
import { createUsageService } from "../server/service";
import { estimateTokenCost, resolveModelRate, type CustomModelPrice } from "../shared/pricing";

const hourKey = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}T${hour}`;
};

async function main(): Promise<void> {
  // 1. Unit assertions for rate resolution & normalization
  assert.deepEqual(resolveModelRate("claude-sonnet-4-6"), { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
  assert.deepEqual(resolveModelRate("anthropic/claude-haiku-4-5-20251001"), { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 });
  assert.deepEqual(resolveModelRate("gpt-5.3-codex"), { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 1.75 });
  assert.deepEqual(resolveModelRate("gemini-4-hydrogen-high"), { input: 1.5, output: 7.5, cacheRead: 0.075, cacheWrite: 1.5 });
  assert.deepEqual(resolveModelRate("gemini-3.8-flash-control"), { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.75 });
  assert.deepEqual(resolveModelRate("glm-4.7-free"), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.equal(resolveModelRate("unknown-custom-model"), null, "unknown models must remain unpriced, not silently $0");

  // 2. Report-level estimation, reported-cost precedence, cache savings, and explicit unpriced attribution
  const now = new Date();
  const current = new Date(now.getTime() - 60 * 60 * 1000);
  const currentHour = hourKey(current);
  const ts = current.getTime();

  const state = emptyState();
  // Claude: unbilled in logs -> estimated ($3*1 + $15*0.2 + $0.3*10 + $3.75*0.5 = 3 + 3 + 3 + 1.875 = $10.875)
  // Cache savings: 10M * ($3 - $0.3) / 1M = $27.00
  addBucket(state.buckets, currentHour, "claude", "claude-sonnet-4-6", "/workspace/acme", {
    r: 2,
    i: 1_000_000,
    o: 200_000,
    cr: 10_000_000,
    cw: 500_000,
    cost: 0,
  });
  applySession(state.sessions, "claude", "sess-claude-1", {
    t: ts,
    r: 2,
    p: "/workspace/acme",
    model: "claude-sonnet-4-6",
    i: 1_000_000,
    o: 200_000,
    cr: 10_000_000,
    cw: 500_000,
    cost: 0,
  });
  recordCall(state, "claude", {
    t: ts,
    m: "claude-sonnet-4-6",
    p: "/workspace/acme",
    s: "sess-claude-1",
    i: 1_000_000,
    o: 200_000,
    cr: 10_000_000,
    cw: 500_000,
    rz: 0,
    cost: 0,
    credits: 0,
  });

  // Zero-token synthetic row must NOT appear in unpricedModels
  addBucket(state.buckets, currentHour, "claude", "<synthetic>", "/workspace/acme", {
    r: 1,
    i: 0,
    o: 0,
    cr: 0,
    cw: 0,
    cost: 0,
  });

  // Codex: unbilled -> estimated ($1.75*1 + $14*0.5 + $0.175*4 = 1.75 + 7 + 0.7 = $9.45)
  // Cache savings: 4M * ($1.75 - $0.175) / 1M = $6.30
  addBucket(state.buckets, currentHour, "codex", "gpt-5.3-codex", "/workspace/acme", {
    r: 1,
    i: 1_000_000,
    o: 500_000,
    cr: 4_000_000,
    cw: 0,
    cost: 0,
  });

  // OpenCode: raw reported cost = $12.34 -> MUST stay authoritative (never overwritten by rate table)
  addBucket(state.buckets, currentHour, "opencode", "claude-sonnet-4-6", "/workspace/acme", {
    r: 1,
    i: 100_000,
    o: 50_000,
    cr: 0,
    cw: 0,
    cost: 12.34,
  });

  // Unknown custom model -> explicitly unpriced (600,000 tokens)
  addBucket(state.buckets, currentHour, "agy", "custom-internal-model-x", "/workspace/acme", {
    r: 1,
    i: 500_000,
    o: 100_000,
    cr: 0,
    cw: 0,
    cost: 0,
  });

  const enabled = new Set(["claude", "codex", "opencode", "agy"]);
  const report = buildReport(state, "7d", { scanning: false, done: 0, total: 0 }, [], undefined, enabled, null, "day");

  assert.equal(report.totals.reportedCostUsd, 12.34, "raw reported cost must remain authoritative");
  assert.equal(report.totals.estimatedCostUsd, 20.33, "estimated cost should sum Claude ($10.875) + Codex ($9.45)");
  assert.equal(report.totals.costUsd, 32.67, "effective cost = reported + estimated");
  assert.equal(report.totals.cacheSavingsUsd, 33.3, "cache savings = Claude ($27) + Codex ($6.30)");
  assert.equal(report.totals.unpricedTokens, 600_000, "unknown model tokens must be explicitly tracked");
  assert.deepEqual(report.totals.unpricedModels, ["custom-internal-model-x"], "<synthetic> 0-token rows must not be listed as unpriced");
  assert.equal(report.sessionStats.totalCostUsd, 10.88, "session cost should reflect per-model estimate");
  assert.equal(report.monthToDate.costUsd, 32.67);

  const claudeAgent = buildAgentReport(state, "claude", "7d", undefined, enabled, null, "day");
  assert.equal(claudeAgent.totals.reportedCostUsd, 0);
  assert.equal(claudeAgent.totals.estimatedCostUsd, 10.88);
  assert.equal(claudeAgent.totals.costUsd, 10.88);
  assert.equal(claudeAgent.totals.cacheSavingsUsd, 27);
  assert.equal(claudeAgent.requests[0]?.costUsd, 10.875);
  assert.equal(claudeAgent.requests[0]?.costSource, "estimated");

  // 3. Custom overrides: explicit rates + mapTo alias + reported cost still authoritative
  const customPrices: CustomModelPrice[] = [
    { model: "custom-internal-model-x", input: 4, output: 20, cacheRead: 0.4, cacheWrite: 4 },
    { model: "claude-sonnet-4-6", input: 10, output: 30, cacheRead: 1, cacheWrite: 12 },
  ];
  const overridden = buildReport(state, "7d", { scanning: false, done: 0, total: 0 }, [], undefined, enabled, null, "day", customPrices);
  assert.equal(overridden.totals.unpricedTokens, 0, "custom override should price previously unpriced model");
  assert.deepEqual(overridden.totals.unpricedModels, []);
  assert.equal(overridden.totals.reportedCostUsd, 12.34, "custom override must not replace raw reported cost");
  // Claude overridden: 1*10 + 0.2*30 + 10*1 + 0.5*12 = 10 + 6 + 10 + 6 = $32
  // Codex built-in: $9.45
  // Agy custom: 0.5*4 + 0.1*20 = 2 + 2 = $4
  // Estimated total = 32 + 9.45 + 4 = $45.45; effective = 45.45 + 12.34 = $57.79
  assert.equal(overridden.totals.estimatedCostUsd, 45.45);
  assert.equal(overridden.totals.costUsd, 57.79);

  // Alias mapTo check (plus cycle safety)
  const aliased = estimateTokenCost(
    "custom-alias",
    { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0, reportedCost: 0 },
    [{ model: "custom-alias", mapTo: "gemini-4-carbon" }],
  );
  assert.equal(aliased.costUsd, 24);
  const cyclic = resolveModelRate("loop-a", [
    { model: "loop-a", mapTo: "loop-b" },
    { model: "loop-b", mapTo: "loop-a" },
  ]);
  assert.equal(cyclic, null, "cyclic aliases must terminate safely as unpriced");

  // 4. End-to-end UsageService read-after-write check: updating customModelPrices updates report immediately without rescan
  const root = await mkdtemp(join(tmpdir(), "agent-usage-pricing-svc-"));
  const previousPaseoHome = process.env.PASEO_HOME;
  process.env.PASEO_HOME = root;
  try {
    const dataDir = join(root, "plugin-data", "agent-usage-plugin");
    state.meta.lastScanAt = Date.now();
    await saveState(dataDir, state);

    const service = createUsageService();
    try {
      const before = await service.report("7d");
      assert.equal(before.totals.unpricedTokens, 600_000);
      const prefs = await service.prefsGet();
      const saved = await service.prefsSet({
        ...prefs,
        customModelPrices: [{ model: "custom-internal-model-x", mapTo: "gemini-4-carbon" }],
      });
      assert.equal(saved.saved, true);
      const after = await service.report("7d");
      assert.equal(after.totals.unpricedTokens, 0, "custom price saved in prefs must update report immediately");
      assert.equal(after.totals.estimatedCostUsd, 24.33, "20.325 + 4.00 = 24.325 -> 24.33");
    } finally {
      service.stop();
    }
  } finally {
    if (previousPaseoHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = previousPaseoHome;
    await rm(root, { recursive: true, force: true });
  }

  console.log("pricing checks passed");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
