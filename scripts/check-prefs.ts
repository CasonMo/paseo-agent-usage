import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUsageService } from "../server/service";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "agent-usage-prefs-"));
  const dataDir = join(root, "plugin-data", "agent-usage-plugin");
  process.env.PASEO_HOME = root;

  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(dataDir, "prefs.json"),
      JSON.stringify({ language: "zh", refreshMinutes: 30, localAlias: "dev" }),
      { mode: 0o600 },
    );

    const first = createUsageService();
    try {
      const [initial, concurrent] = await Promise.all([first.prefsGet(), first.prefsGet()]);
      assert.equal(initial.language, "zh", "old prefs should load before the first response");
      assert.equal(initial.coCreateDismissed, false, "missing dismissal should default to visible");
      assert.deepEqual(concurrent, initial, "concurrent startup reads should share one result");

      const [dismissed, stale] = await Promise.all([
        first.prefsSet({ ...initial, coCreateDismissed: true }),
        first.prefsSet({
          language: initial.language,
          refreshMinutes: initial.refreshMinutes,
          coCreateDismissed: false,
        }),
      ]);
      assert.equal(dismissed.saved, true);
      assert.equal(stale.saved, true);
      assert.equal((await first.prefsGet()).coCreateDismissed, true, "dismissal must be monotonic");

      const withPricingAndRetention = await first.prefsSet({
        ...(await first.prefsGet()),
        archiveRetentionDays: 180,
        customModelPrices: [{ model: "custom-model-a", input: 2.5, output: 10, cacheRead: 0.25, cacheWrite: 2.5 }],
      });
      assert.equal(withPricingAndRetention.saved, true);
    } finally {
      first.stop();
    }

    const persisted = JSON.parse(await readFile(join(dataDir, "prefs.json"), "utf8")) as {
      coCreateDismissed?: unknown;
      archiveRetentionDays?: unknown;
      customModelPrices?: unknown;
    };
    assert.equal(persisted.coCreateDismissed, true, "dismissal should be written to prefs.json");
    assert.equal(persisted.archiveRetentionDays, 180, "archive retention should persist");
    assert.ok(Array.isArray(persisted.customModelPrices) && persisted.customModelPrices.length === 1);

    const second = createUsageService();
    try {
      const reloaded = await second.prefsGet();
      assert.equal(reloaded.coCreateDismissed, true, "dismissal should survive a service restart");
      assert.equal(reloaded.archiveRetentionDays, 180, "archive retention should survive a service restart");
      assert.equal(reloaded.customModelPrices?.[0]?.model, "custom-model-a");
    } finally {
      second.stop();
    }

    console.log("prefs checks passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void main();
