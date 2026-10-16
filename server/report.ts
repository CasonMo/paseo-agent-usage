import type { UsageAgentReport, UsageRangeKey, UsageReport } from "../shared/usage";
import type { CallRecord, DayBucket, ScanState } from "./scan/state";
import { localDateKey } from "./scan/util";

const HARNESS_ORDER = ["claude", "codex", "opencode", "pi"];
const HARNESS_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "Pi",
};
const MAX_MODELS = 60;
const MAX_PROJECTS = 60;
const MAX_AGENT_MODELS = 30;
const MAX_AGENT_PROJECTS = 30;
const MAX_AGENT_REQUESTS = 120;

export interface HostView {
  name: string;
  target: string;
  status: "ok" | "pulling" | "error" | "never";
  lastPullAt: number | null;
  lastError: string | null;
}

interface Aggregate {
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  cost: number;
  credits: number;
}

export interface ScanInfo {
  scanning: boolean;
  done: number;
  total: number;
}

const zero = (): Aggregate => ({ requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0, credits: 0 });
const tokenTotal = (aggregate: Aggregate): number => aggregate.input + aggregate.output + aggregate.cacheRead + aggregate.cacheWrite;

function addAggregate(target: Aggregate, bucket: DayBucket): void {
  target.requests += bucket.r;
  target.input += bucket.i;
  target.output += bucket.o;
  target.cacheRead += bucket.cr;
  target.cacheWrite += bucket.cw;
  target.reasoning += bucket.rz;
  target.cost += bucket.cost;
  target.credits += bucket.credits;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round0 = (value: number): number => Math.round(value);

interface Source {
  id: string;
  buckets: Record<string, DayBucket>;
}

function collectSources(state: ScanState): Source[] {
  const sources: Source[] = [{ id: "local", buckets: state.buckets }];
  for (const [name, host] of Object.entries(state.hosts)) {
    sources.push({ id: name, buckets: host.buckets ?? {} });
  }
  return sources;
}

interface RangePlan {
  periodKeys: string[];
  periodKeyOf(dateKey: string): string;
  label(key: string): string;
}

function dateKeyOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function parseDateKey(key: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return match ? { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) } : null;
}

function shortDay(key: string): string {
  const parsed = parseDateKey(key);
  return parsed ? `${parsed.m}/${parsed.d}` : key;
}

function weekKeyOf(dateKey: string): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  const date = new Date(parsed.y, parsed.m - 1, parsed.d);
  const offset = (date.getDay() + 6) % 7;
  return dateKeyOf(addDays(date, -offset));
}

function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

function buildRangePlan(range: UsageRangeKey, now: Date, custom?: { from?: string; to?: string } | null): RangePlan {
  if (range === "custom") {
    const fromParsed = custom?.from ? parseDateKey(custom.from) : null;
    const toParsed = custom?.to ? parseDateKey(custom.to) : null;
    if (!fromParsed || !toParsed) return buildRangePlan("30d", now);
    const start = new Date(fromParsed.y, fromParsed.m - 1, fromParsed.d);
    const end = new Date(toParsed.y, toParsed.m - 1, toParsed.d);
    const first = start <= end ? start : end;
    const last = start <= end ? end : start;
    const keys: string[] = [];
    for (let cursor = first, guard = 0; cursor <= last && guard < 400; cursor = addDays(cursor, 1), guard += 1) {
      keys.push(dateKeyOf(cursor));
    }
    return { periodKeys: keys, periodKeyOf: (key) => key, label: shortDay };
  }
  if (range === "today" || range === "7d" || range === "30d") {
    const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
    const keys: string[] = [];
    for (let i = days - 1; i >= 0; i -= 1) keys.push(dateKeyOf(addDays(now, -i)));
    return { periodKeys: keys, periodKeyOf: (key) => key, label: shortDay };
  }
  if (range === "12w") {
    const keys: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const key = weekKeyOf(dateKeyOf(addDays(now, -i * 7)));
      if (!keys.includes(key)) keys.push(key);
    }
    keys.reverse();
    return { periodKeys: keys, periodKeyOf: weekKeyOf, label: shortDay };
  }
  const keys: string[] = [];
  const base = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = 11; i >= 0; i -= 1) {
    const date = new Date(base.getFullYear(), base.getMonth() - i, 1);
    keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }
  return {
    periodKeys: keys,
    periodKeyOf: monthKeyOf,
    label: (key) => {
      const [year, month] = key.split("-");
      return `${year}/${Number(month)}`;
    },
  };
}

export function buildReport(state: ScanState, range: UsageRangeKey, scan: ScanInfo, hosts: HostView[], origin?: string, enabledHarnesses?: ReadonlySet<string>, custom?: { from?: string; to?: string } | null): UsageReport {
  const now = new Date();
  const plan = buildRangePlan(range, now, custom);
  const allowed = new Set(plan.periodKeys);
  const originFilter = origin ?? null;
  const series = new Map<string, { tokens: number; credits: number; byAgent: Record<string, number> }>();
  const agents = new Map<string, Aggregate>();
  const models = new Map<string, Aggregate & { agent: string; model: string }>();
  const projects = new Map<string, Aggregate & { project: string }>();
  const origins = new Map<string, Aggregate>();
  const totals = zero();
  let firstDay: string | null = null;

  for (const source of collectSources(state)) {
    for (const [key, bucket] of Object.entries(source.buckets)) {
      const [date = "", harness = "", model = "", project = ""] = key.split("\u0001");
      if (enabledHarnesses && !enabledHarnesses.has(harness)) continue;
      if (!firstDay || date < firstDay) firstDay = date;
      const periodKey = plan.periodKeyOf(date);
      if (!allowed.has(periodKey)) continue;
      let originAggregate = origins.get(source.id);
      if (!originAggregate) {
        originAggregate = zero();
        origins.set(source.id, originAggregate);
      }
      addAggregate(originAggregate, bucket);
      if (originFilter !== null && source.id !== originFilter) continue;
      addAggregate(totals, bucket);
      let agent = agents.get(harness);
      if (!agent) {
        agent = zero();
        agents.set(harness, agent);
      }
      addAggregate(agent, bucket);
      const modelKey = `${harness}\u0001${model}`;
      let modelAggregate = models.get(modelKey);
      if (!modelAggregate) {
        modelAggregate = Object.assign(zero(), { agent: harness, model });
        models.set(modelKey, modelAggregate);
      }
      addAggregate(modelAggregate, bucket);
      let projectAggregate = projects.get(project);
      if (!projectAggregate) {
        projectAggregate = Object.assign(zero(), { project });
        projects.set(project, projectAggregate);
      }
      addAggregate(projectAggregate, bucket);
      let point = series.get(periodKey);
      if (!point) {
        point = { tokens: 0, credits: 0, byAgent: {} };
        series.set(periodKey, point);
      }
      const tokens = bucket.i + bucket.o + bucket.cr + bucket.cw;
      point.tokens += tokens;
      point.credits += bucket.credits;
      point.byAgent[harness] = (point.byAgent[harness] ?? 0) + tokens;
    }
  }

  const originNumbers = (id: string): { requests: number; totalTokens: number; credits: number } => {
    const aggregate = origins.get(id);
    return {
      requests: round0(aggregate?.requests ?? 0),
      totalTokens: round0(aggregate ? tokenTotal(aggregate) : 0),
      credits: round2(aggregate?.credits ?? 0),
    };
  };

  const agentIds = [...HARNESS_ORDER, ...[...agents.keys()].filter((id) => !HARNESS_ORDER.includes(id))];
  const agentRows = agentIds
    .map((id) => {
      const aggregate = agents.get(id);
      if (!aggregate) return null;
      return {
        id,
        label: HARNESS_LABELS[id] ?? id,
        requests: round0(aggregate.requests),
        input: round0(aggregate.input),
        output: round0(aggregate.output),
        cacheRead: round0(aggregate.cacheRead),
        cacheWrite: round0(aggregate.cacheWrite),
        reasoning: round0(aggregate.reasoning),
        totalTokens: round0(tokenTotal(aggregate)),
        reportedCostUsd: round2(aggregate.cost),
        credits: round2(aggregate.credits),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const modelRows = [...models.values()]
    .sort((a, b) => tokenTotal(b) + b.credits - (tokenTotal(a) + a.credits))
    .slice(0, MAX_MODELS)
    .map((aggregate) => ({
      agent: aggregate.agent,
      model: aggregate.model || "unknown",
      requests: round0(aggregate.requests),
      totalTokens: round0(tokenTotal(aggregate)),
      credits: round2(aggregate.credits),
      reportedCostUsd: round2(aggregate.cost),
    }));

  const projectRows = [...projects.values()]
    .sort((a, b) => tokenTotal(b) + b.credits - (tokenTotal(a) + a.credits))
    .slice(0, MAX_PROJECTS)
    .map((aggregate) => ({
      project: aggregate.project,
      requests: round0(aggregate.requests),
      totalTokens: round0(tokenTotal(aggregate)),
      credits: round2(aggregate.credits),
    }));

  return {
    generatedAt: Date.now(),
    scanning: scan.scanning,
    scanDone: round0(scan.done),
    scanTotal: round0(scan.total),
    scanError: state.meta.scanError,
    firstDay,
    totals: {
      requests: round0(totals.requests),
      input: round0(totals.input),
      output: round0(totals.output),
      cacheRead: round0(totals.cacheRead),
      cacheWrite: round0(totals.cacheWrite),
      reasoning: round0(totals.reasoning),
      reportedCostUsd: round2(totals.cost),
      credits: round2(totals.credits),
    },
    agents: agentRows,
    series: plan.periodKeys.map((key) => {
      const point = series.get(key);
      const byAgent: Record<string, number> = {};
      for (const [agentId, value] of Object.entries(point?.byAgent ?? {})) byAgent[agentId] = round0(value);
      return {
        key,
        label: plan.label(key),
        totalTokens: round0(point?.tokens ?? 0),
        credits: round2(point?.credits ?? 0),
        byAgent,
      };
    }),
    models: modelRows,
    projects: projectRows,
    origins: [
      { id: "local", label: "本机", status: "ok" as const, lastPullAt: null, lastError: null, ...originNumbers("local") },
      ...hosts.map((view) => ({
        id: view.name,
        label: view.name,
        status: view.status,
        lastPullAt: view.lastPullAt,
        lastError: view.lastError,
        ...originNumbers(view.name),
      })),
    ],
  };
}

export function buildAgentReport(state: ScanState, agent: string, range: UsageRangeKey, origin?: string, enabledHarnesses?: ReadonlySet<string>, custom?: { from?: string; to?: string } | null): UsageAgentReport {
  const now = new Date();
  const plan = buildRangePlan(range, now, custom);
  const allowed = new Set(plan.periodKeys);
  const originFilter = origin ?? null;
  const totals = zero();
  const series = new Map<string, { tokens: number; credits: number }>();
  const models = new Map<string, Aggregate & { model: string }>();
  const projects = new Map<string, Aggregate & { project: string }>();

  const agentEnabled = !enabledHarnesses || enabledHarnesses.has(agent);
  for (const source of agentEnabled ? collectSources(state) : []) {
    if (originFilter !== null && source.id !== originFilter) continue;
    for (const [key, bucket] of Object.entries(source.buckets)) {
      const [date = "", harness = "", model = "", project = ""] = key.split("\u0001");
      if (harness !== agent) continue;
      const periodKey = plan.periodKeyOf(date);
      if (!allowed.has(periodKey)) continue;
      addAggregate(totals, bucket);
      let modelAggregate = models.get(model);
      if (!modelAggregate) {
        modelAggregate = Object.assign(zero(), { model });
        models.set(model, modelAggregate);
      }
      addAggregate(modelAggregate, bucket);
      let projectAggregate = projects.get(project);
      if (!projectAggregate) {
        projectAggregate = Object.assign(zero(), { project });
        projects.set(project, projectAggregate);
      }
      addAggregate(projectAggregate, bucket);
      let point = series.get(periodKey);
      if (!point) {
        point = { tokens: 0, credits: 0 };
        series.set(periodKey, point);
      }
      point.tokens += bucket.i + bucket.o + bucket.cr + bucket.cw;
      point.credits += bucket.credits;
    }
  }

  const requests: UsageAgentReport["requests"] = [];
  const collectRecords = (records: Record<string, CallRecord[]> | undefined, origin: string) => {
    for (const record of records?.[agent] ?? []) {
      if (!allowed.has(plan.periodKeyOf(localDateKey(record.t)))) continue;
      requests.push({
        ts: record.t,
        model: record.m || "unknown",
        project: record.p,
        session: record.s,
        input: round0(record.i),
        output: round0(record.o),
        cacheRead: round0(record.cr),
        cacheWrite: round0(record.cw),
        reasoning: round0(record.rz),
        credits: round2(record.credits),
        costUsd: round2(record.cost),
        origin,
      });
    }
  };
  if (agentEnabled && (originFilter === null || originFilter === "local")) collectRecords(state.recent, "local");
  for (const [name, host] of Object.entries(state.hosts)) {
    if (agentEnabled && (originFilter === null || originFilter === name)) collectRecords(host.recent, name);
  }
  requests.sort((a, b) => b.ts - a.ts);

  return {
    agent,
    label: HARNESS_LABELS[agent] ?? agent,
    totals: {
      requests: round0(totals.requests),
      input: round0(totals.input),
      output: round0(totals.output),
      cacheRead: round0(totals.cacheRead),
      cacheWrite: round0(totals.cacheWrite),
      reasoning: round0(totals.reasoning),
      reportedCostUsd: round2(totals.cost),
      credits: round2(totals.credits),
    },
    series: plan.periodKeys.map((key) => {
      const point = series.get(key);
      const tokens = round0(point?.tokens ?? 0);
      return {
        key,
        label: plan.label(key),
        totalTokens: tokens,
        credits: round2(point?.credits ?? 0),
        byAgent: tokens > 0 ? { [agent]: tokens } : {},
      };
    }),
    models: [...models.values()]
      .sort((a, b) => tokenTotal(b) + b.credits - (tokenTotal(a) + a.credits))
      .slice(0, MAX_AGENT_MODELS)
      .map((aggregate) => ({
        agent,
        model: aggregate.model || "unknown",
        requests: round0(aggregate.requests),
        totalTokens: round0(tokenTotal(aggregate)),
        credits: round2(aggregate.credits),
        reportedCostUsd: round2(aggregate.cost),
      })),
    projects: [...projects.values()]
      .sort((a, b) => tokenTotal(b) + b.credits - (tokenTotal(a) + a.credits))
      .slice(0, MAX_AGENT_PROJECTS)
      .map((aggregate) => ({
        project: aggregate.project,
        requests: round0(aggregate.requests),
        totalTokens: round0(tokenTotal(aggregate)),
        credits: round2(aggregate.credits),
      })),
    requests: requests.slice(0, MAX_AGENT_REQUESTS),
  };
}
