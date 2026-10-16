import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UsageAgentReport, UsageAgentSetItem, UsageAgentToggle, UsageHostForm, UsageHostListItem, UsageRangeKey, UsageReport } from "../shared/usage";
import { buildAgentReport, buildReport, type HostView } from "./report";
import { applyHostForms, readHostsFile, writeHostsFile } from "./remote/hosts-file";
import { pullHost, testHost, type HostConfig } from "./remote/ssh";
import { scanAll } from "./scan/scanner";
import { emptyState, loadState, pluginDataDir, saveState, type CallRecord, type DayBucket, type RemoteHostState, type ScanState } from "./scan/state";
import { num } from "./scan/util";

export interface UsageService {
  report(range: UsageRangeKey, origin?: string, custom?: { from?: string; to?: string }): Promise<UsageReport>;
  agentReport(agent: string, range: UsageRangeKey, origin?: string, custom?: { from?: string; to?: string }): Promise<UsageAgentReport>;
  agentsGet(): Promise<{ agents: UsageAgentToggle[] }>;
  agentsSet(agents: UsageAgentSetItem[]): Promise<{ saved: boolean; error: string | null }>;
  refresh(): Promise<{ started: boolean }>;
  hostsList(): Promise<{ hosts: UsageHostListItem[] }>;
  hostsSet(forms: UsageHostForm[]): Promise<{ saved: boolean; error: string | null }>;
  hostTest(form: UsageHostForm): Promise<{ ok: boolean; detail: string }>;
  markDirty(): void;
  stop(): void;
}

interface Projection {
  generatedAt?: unknown;
  node?: unknown;
  buckets?: unknown;
  recent?: unknown;
}

const HOST_MIN_INTERVAL_MS = 10 * 60 * 1000;
const HOSTS_FILE = "hosts.json";
const AGENTS_FILE = "agents.json";
const AGENT_ORDER = ["claude", "codex", "opencode", "pi"];
const AGENT_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "Pi",
};

/** Agents included in statistics and scanning. */
function defaultAgentsConfig(): Record<string, boolean> {
  return { claude: true, codex: true, opencode: true, pi: true };
}

function sanitizeBuckets(raw: unknown): Record<string, DayBucket> {
  const buckets: Record<string, DayBucket> = {};
  if (!raw || typeof raw !== "object") return buckets;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    buckets[key] = {
      r: num(record.r),
      i: num(record.i),
      o: num(record.o),
      cr: num(record.cr),
      cw: num(record.cw),
      rz: num(record.rz),
      cost: num(record.cost),
      credits: num(record.credits),
    };
  }
  return buckets;
}

function sanitizeRecent(raw: unknown): Record<string, CallRecord[]> {
  const recent: Record<string, CallRecord[]> = {};
  if (!raw || typeof raw !== "object") return recent;
  for (const [harness, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const records: CallRecord[] = [];
    for (const item of list.slice(-400)) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      records.push({
        t: num(record.t),
        m: typeof record.m === "string" ? record.m : "",
        p: typeof record.p === "string" ? record.p : "",
        s: typeof record.s === "string" ? record.s : "",
        i: num(record.i),
        o: num(record.o),
        cr: num(record.cr),
        cw: num(record.cw),
        rz: num(record.rz),
        cost: num(record.cost),
        credits: num(record.credits),
        id: typeof record.id === "string" ? record.id : undefined,
      });
    }
    recent[harness] = records;
  }
  return recent;
}

function parseProjection(text: string): Projection | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Projection) : null;
  } catch {
    return null;
  }
}

export function createUsageService(): UsageService {
  const dir = pluginDataDir();
  let state: ScanState = emptyState();
  let scanning = false;
  let dirty = false;
  let stopped = false;
  let done = 0;
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hostsTimer: ReturnType<typeof setInterval> | null = null;
  let hostConfigs: HostConfig[] = [];
  let hostConfigsAt = 0;
  let agentsConfig: Record<string, boolean> = defaultAgentsConfig();
  let agentsConfigAt = 0;
  const pullingHosts = new Set<string>();

  const loaded = loadState(dir)
    .then((loadedState) => {
      state = loadedState;
    })
    .catch((error) => {
      console.error("[agent-usage] state load failed", error);
    });

  async function refreshAgentsConfig(force: boolean): Promise<Record<string, boolean>> {
    if (!force && Date.now() - agentsConfigAt < 60_000) return agentsConfig;
    agentsConfigAt = Date.now();
    try {
      const parsed = JSON.parse(await readFile(join(dir, AGENTS_FILE), "utf8")) as Record<string, unknown>;
      const next = defaultAgentsConfig();
      for (const id of AGENT_ORDER) {
        if (typeof parsed?.[id] === "boolean") next[id] = parsed[id] as boolean;
      }
      agentsConfig = next;
    } catch {
      agentsConfig = defaultAgentsConfig();
    }
    return agentsConfig;
  }

  function enabledHarnesses(): ReadonlySet<string> {
    return new Set(AGENT_ORDER.filter((id) => agentsConfig[id] !== false));
  }

  async function writeAgentsConfig(config: Record<string, boolean>): Promise<void> {
    await mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => {});
    const file = join(dir, AGENTS_FILE);
    const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
    await writeFile(temporary, JSON.stringify(config, null, 2), { mode: 0o600 });
    await rename(temporary, file);
  }

  async function refreshHostConfigs(force: boolean): Promise<HostConfig[]> {
    if (!force && Date.now() - hostConfigsAt < 60_000) return hostConfigs;
    hostConfigsAt = Date.now();
    hostConfigs = await readHostsFile(dir);
    return hostConfigs;
  }

  function hostViews(): HostView[] {
    return hostConfigs
      .filter((host) => host.enabled)
      .map((host) => {
        const entry = state.hosts[host.name];
        const status: HostView["status"] = pullingHosts.has(host.name) ? "pulling" : !entry ? "never" : entry.lastError ? "error" : "ok";
        return { name: host.name, target: host.target, status, lastPullAt: entry?.lastPullAt ?? null, lastError: entry?.lastError ?? null };
      });
  }

  async function pullHosts(force: boolean): Promise<void> {
    await loaded;
    if (stopped) return;
    const configs = (await refreshHostConfigs(true)).filter((host) => host.enabled);
    if (configs.length === 0) return;
    const now = Date.now();
    const due = configs.filter((host) => {
      if (pullingHosts.has(host.name)) return false;
      const entry = state.hosts[host.name];
      const lastAttempt = entry?.lastAttemptAt ?? entry?.lastPullAt;
      return force || !lastAttempt || now - lastAttempt > HOST_MIN_INTERVAL_MS;
    });
    if (due.length === 0) return;
    for (const host of due) pullingHosts.add(host.name);
    try {
      for (const host of due) {
        if (stopped) return;
        console.log(`[agent-usage] pulling host ${host.name} (${host.target})`);
        const result = await pullHost(host, dir);
        const existing = state.hosts[host.name];
        const base: RemoteHostState = existing ?? {
          target: host.target,
          buckets: {},
          recent: {},
          lastPullAt: null,
          lastAttemptAt: null,
          lastError: null,
          node: null,
          generatedAt: null,
        };
        if (result.ok) {
          const projection = parseProjection(result.stdout);
          if (!projection) {
            state.hosts[host.name] = { ...base, target: host.target, lastError: "远端返回内容无法解析" };
            console.warn(`[agent-usage] host ${host.name} returned an unparsable projection`);
          } else {
            const next: RemoteHostState = {
              target: host.target,
              buckets: sanitizeBuckets(projection.buckets),
              recent: sanitizeRecent(projection.recent),
              lastPullAt: Date.now(),
              lastAttemptAt: Date.now(),
              lastError: null,
              node: typeof projection.node === "string" ? projection.node : null,
              generatedAt: typeof projection.generatedAt === "number" ? projection.generatedAt : null,
            };
            state.hosts[host.name] = next;
            console.log(`[agent-usage] host ${host.name} pulled: ${Object.keys(next.buckets).length} buckets, ${Object.keys(next.recent).length} agents`);
          }
        } else {
          state.hosts[host.name] = { ...base, target: host.target, lastAttemptAt: Date.now(), lastError: result.error ?? "拉取失败" };
          console.warn(`[agent-usage] host ${host.name} pull failed: ${result.error ?? "unknown"}`);
        }
        await saveState(dir, state).catch((error) => console.error("[agent-usage] state save failed", error));
      }
    } finally {
      for (const host of due) pullingHosts.delete(host.name);
    }
  }

  async function startScan(force: boolean): Promise<boolean> {
    await loaded;
    if (stopped || scanning) return false;
    const age = state.meta.lastScanAt ? Date.now() - state.meta.lastScanAt : Number.POSITIVE_INFINITY;
    if (!force && !dirty && state.meta.lastScanAt && age < 5 * 60_000) return false;
    await refreshAgentsConfig(true);
    scanning = true;
    dirty = false;
    done = 0;
    total = 0;
    console.log(`[agent-usage] scan started${force ? " (manual)" : ""} [${[...enabledHarnesses()].join(",")}]`);
    void (async () => {
      const startedAt = Date.now();
      try {
        await scanAll(state, {
          shouldStop: () => stopped,
          onProgress: (doneCount, totalCount) => {
            done = doneCount;
            total = totalCount;
          },
          onCheckpoint: () => {
            void saveState(dir, state).catch(() => {});
          },
        }, enabledHarnesses());
        state.meta.lastScanAt = Date.now();
        state.meta.scanError = null;
        console.log(`[agent-usage] scan finished in ${Math.round((Date.now() - startedAt) / 1000)}s (${Object.keys(state.buckets).length} buckets)`);
      } catch (error) {
        state.meta.scanError = error instanceof Error ? error.message : String(error);
        console.error("[agent-usage] scan failed", error);
      } finally {
        scanning = false;
        await saveState(dir, state).catch((error) => console.error("[agent-usage] state save failed", error));
        if (!stopped) void pullHosts(false);
      }
    })();
    return true;
  }

  function schedule(delayMs: number): void {
    if (timer || stopped) return;
    timer = setTimeout(() => {
      timer = null;
      void startScan(false);
    }, delayMs);
    timer.unref?.();
  }

  async function report(range: UsageRangeKey, origin?: string, custom?: { from?: string; to?: string }): Promise<UsageReport> {
    await loaded;
    await refreshHostConfigs(false);
    await refreshAgentsConfig(false);
    if (!state.meta.lastScanAt && !scanning) schedule(0);
    else if (dirty && !scanning) schedule(2_000);
    return buildReport(state, range, { scanning, done, total }, hostViews(), origin, enabledHarnesses(), custom);
  }

  async function agentReport(agent: string, range: UsageRangeKey, origin?: string, custom?: { from?: string; to?: string }): Promise<UsageAgentReport> {
    await loaded;
    await refreshAgentsConfig(false);
    if (dirty && !scanning) schedule(2_000);
    return buildAgentReport(state, agent, range, origin, enabledHarnesses(), custom);
  }

  async function hostsList(): Promise<{ hosts: UsageHostListItem[] }> {
    await loaded;
    const hosts = await readHostsFile(dir);
    hostConfigs = hosts;
    hostConfigsAt = Date.now();
    return {
      hosts: hosts.map((host) => ({
        name: host.name,
        target: host.target,
        enabled: host.enabled,
        port: host.port ?? null,
        identityFile: host.identityFile ?? "",
        passwordCommand: host.passwordCommand ?? "",
        nodePath: host.nodePath ?? "",
        cacheDir: host.cacheDir ?? "",
        timeoutMs: host.timeoutMs ?? null,
        hasPassword: Boolean(host.password),
      })),
    };
  }

  async function hostsSet(forms: UsageHostForm[]): Promise<{ saved: boolean; error: string | null }> {
    await loaded;
    const existing = await readHostsFile(dir);
    const { hosts, error } = applyHostForms(existing, forms);
    if (error) return { saved: false, error };
    await writeHostsFile(dir, hosts);
    hostConfigs = hosts;
    hostConfigsAt = Date.now();
    const names = new Set(hosts.map((host) => host.name));
    for (const name of Object.keys(state.hosts)) {
      if (!names.has(name)) delete state.hosts[name];
    }
    for (const host of hosts) {
      const before = existing.find((item) => item.name === host.name);
      const changed = !before || before.target !== host.target || before.enabled !== host.enabled;
      if (changed) {
        const entry = state.hosts[host.name];
        if (entry) entry.lastAttemptAt = null;
        else
          state.hosts[host.name] = {
            target: host.target,
            buckets: {},
            recent: {},
            lastPullAt: null,
            lastAttemptAt: null,
            lastError: null,
            node: null,
            generatedAt: null,
          };
      }
    }
    await saveState(dir, state).catch(() => {});
    void pullHosts(false);
    return { saved: true, error: null };
  }

  async function hostTest(form: UsageHostForm): Promise<{ ok: boolean; detail: string }> {
    await loaded;
    const existing = await readHostsFile(dir);
    const previous = existing.find((host) => host.name === form.name.trim());
    const { hosts, error } = applyHostForms(previous ? [previous] : [], [form]);
    if (error) return { ok: false, detail: error };
    const host = hosts[0];
    if (!host) return { ok: false, detail: "配置不完整" };
    return await testHost(host, dir);
  }

  async function agentsGet(): Promise<{ agents: UsageAgentToggle[] }> {
    await loaded;
    const config = await refreshAgentsConfig(true);
    return {
      agents: AGENT_ORDER.map((id) => ({ id, label: AGENT_LABELS[id] ?? id, enabled: config[id] !== false })),
    };
  }

  async function agentsSet(agents: UsageAgentSetItem[]): Promise<{ saved: boolean; error: string | null }> {
    await loaded;
    const next = defaultAgentsConfig();
    for (const item of agents) {
      if (AGENT_ORDER.includes(item.id)) next[item.id] = item.enabled !== false;
    }
    try {
      await writeAgentsConfig(next);
    } catch (error) {
      return { saved: false, error: `保存失败：${error instanceof Error ? error.message : String(error)}` };
    }
    agentsConfig = next;
    agentsConfigAt = Date.now();
    dirty = true;
    if (!scanning) schedule(500);
    return { saved: true, error: null };
  }

  async function refresh(): Promise<{ started: boolean }> {
    const started = await startScan(true);
    void pullHosts(true);
    return { started };
  }

  function markDirty(): void {
    dirty = true;
    if (!scanning) schedule(4_000);
  }

  function stop(): void {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    if (hostsTimer) clearInterval(hostsTimer);
    hostsTimer = null;
  }

  void loaded.then(() => {
    schedule(1_000);
    void pullHosts(false);
  });

  hostsTimer = setInterval(() => {
    void pullHosts(false);
  }, 5 * 60_000);
  hostsTimer.unref?.();

  return { report, agentReport, agentsGet, agentsSet, refresh, hostsList, hostsSet, hostTest, markDirty, stop };
}
