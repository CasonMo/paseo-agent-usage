import type { UsageAgentReport, UsageGranularity, UsageRangeKey, UsageReport, UsageSessionItem } from "../shared/usage";
import type { CallRecord, SessionEntry, UsageBucket, ScanState } from "./scan/state";
import { localHourKey } from "./scan/util";

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
const MAX_SESSIONS = 200;

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

function addAggregate(target: Aggregate, bucket: UsageBucket): void {
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
  buckets: Record<string, UsageBucket>;
}

function collectSources(state: ScanState): Source[] {
  const sources: Source[] = [{ id: "local", buckets: state.buckets }];
  for (const [name, host] of Object.entries(state.hosts)) {
    sources.push({ id: name, buckets: host.buckets ?? {} });
  }
  return sources;
}

interface SessionSource {
  id: string;
  sessions: Record<string, SessionEntry>;
}

function collectSessionSources(state: ScanState): SessionSource[] {
  const sources: SessionSource[] = [{ id: "local", sessions: state.sessions }];
  for (const [name, host] of Object.entries(state.hosts)) {
    if (!host?.sessions) continue;
    sources.push({ id: name, sessions: host.sessions });
  }
  return sources;
}

interface RangePlan {
  periodKeys: string[];
  startKey: string;
  endKey: string;
  periodKeyOf(bucketKey: string): string;
  label(key: string): string;
  full(key: string): string;
}

function dateKeyOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function hourKeyOf(date: Date): string {
  return `${dateKeyOf(date)}T${String(date.getHours()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function alignHour(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours());
}

function startOfWeek(date: Date): Date {
  return addDays(startOfDay(date), -((date.getDay() + 6) % 7));
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function parseDateKey(key: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return match ? { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) } : null;
}

function dateOfKey(key: string): Date | null {
  const parsed = parseDateKey(key.slice(0, 10));
  return parsed ? new Date(parsed.y, parsed.m - 1, parsed.d) : null;
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

const HOUR_KEY_LIMIT = 2400;
const DAY_KEY_LIMIT = 400;
const WEEK_KEY_LIMIT = 480;
const MONTH_KEY_LIMIT = 480;

interface RangeWindow {
  start: Date;
  end: Date;
}

function rangeWindow(range: UsageRangeKey, now: Date, custom?: { from?: string; to?: string } | null): RangeWindow {
  if (range === "custom") {
    const fromParsed = custom?.from ? parseDateKey(custom.from) : null;
    const toParsed = custom?.to ? parseDateKey(custom.to) : null;
    if (!fromParsed || !toParsed) return rangeWindow("30d", now, null);
    const a = new Date(fromParsed.y, fromParsed.m - 1, fromParsed.d);
    const b = new Date(toParsed.y, toParsed.m - 1, toParsed.d);
    const first = a <= b ? a : b;
    const last = a <= b ? b : a;
    return { start: first, end: new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999) };
  }
  if (range === "24h") return { start: alignHour(new Date(now.getTime() - 23 * 3_600_000)), end: now };
  if (range === "today") return { start: startOfDay(now), end: now };
  if (range === "7d") return { start: addDays(startOfDay(now), -6), end: now };
  if (range === "30d") return { start: addDays(startOfDay(now), -29), end: now };
  if (range === "12w") return { start: addDays(startOfWeek(now), -77), end: now };
  return { start: new Date(now.getFullYear(), now.getMonth() - 11, 1), end: now };
}

function hourKeysIn(win: RangeWindow): string[] {
  const end = alignHour(win.end);
  let start = alignHour(win.start);
  const earliest = new Date(end.getTime() - (HOUR_KEY_LIMIT - 1) * 3_600_000);
  if (start < earliest) start = earliest;
  const keys: string[] = [];
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 3_600_000)) {
    const key = hourKeyOf(cursor);
    if (keys[keys.length - 1] !== key) keys.push(key);
  }
  return keys;
}

function dayKeysIn(win: RangeWindow): string[] {
  const keys: string[] = [];
  const last = startOfDay(win.end);
  for (let cursor = startOfDay(win.start), guard = 0; cursor <= last && guard < DAY_KEY_LIMIT; cursor = addDays(cursor, 1), guard += 1) {
    keys.push(dateKeyOf(cursor));
  }
  return keys;
}

function weekKeysIn(win: RangeWindow): string[] {
  const keys: string[] = [];
  const last = startOfWeek(win.end);
  for (let cursor = startOfWeek(win.start), guard = 0; cursor <= last && guard < WEEK_KEY_LIMIT; cursor = addDays(cursor, 7), guard += 1) {
    keys.push(dateKeyOf(cursor));
  }
  return keys;
}

function monthKeysIn(win: RangeWindow): string[] {
  const keys: string[] = [];
  const last = startOfMonth(win.end);
  for (let cursor = startOfMonth(win.start), guard = 0; cursor <= last && guard < MONTH_KEY_LIMIT; cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1), guard += 1) {
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    keys.push(`${cursor.getFullYear()}-${month}`);
  }
  return keys;
}

function buildPlan(range: UsageRangeKey, granularity: UsageGranularity, now: Date, custom?: { from?: string; to?: string } | null): RangePlan {
  const win = rangeWindow(range, now, custom);
  const startKey = hourKeyOf(win.start);
  const endKey = hourKeyOf(win.end);
  if (granularity === "hour") {
    return {
      periodKeys: hourKeysIn(win),
      startKey,
      endKey,
      periodKeyOf: (key) => key.slice(0, 13),
      label: (key) => `${key.slice(11, 13)}:00`,
      full: (key) => `${key.slice(0, 10)} ${key.slice(11, 13)}:00`,
    };
  }
  if (granularity === "week") {
    return {
      periodKeys: weekKeysIn(win),
      startKey,
      endKey,
      periodKeyOf: (key) => weekKeyOf(key.slice(0, 10)),
      label: (key) => shortDay(key),
      full: (key) => {
        const monday = dateOfKey(key);
        return monday ? `${shortDay(key)}\u2013${shortDay(dateKeyOf(addDays(monday, 6)))}` : key;
      },
    };
  }
  if (granularity === "month") {
    return {
      periodKeys: monthKeysIn(win),
      startKey,
      endKey,
      periodKeyOf: (key) => key.slice(0, 7),
      label: (key) => {
        const [year, month] = key.split("-");
        return `${year}/${Number(month)}`;
      },
      full: (key) => key,
    };
  }
  return {
    periodKeys: dayKeysIn(win),
    startKey,
    endKey,
    periodKeyOf: (key) => key.slice(0, 10),
    label: (key) => shortDay(key.slice(0, 10)),
    full: (key) => key.slice(0, 10),
  };
}

export function buildReport(state: ScanState, range: UsageRangeKey, scan: ScanInfo, hosts: HostView[], origin?: string, enabledHarnesses?: ReadonlySet<string>, custom?: { from?: string; to?: string } | null, granularity: UsageGranularity = "day"): UsageReport {
  const now = new Date();
  const plan = buildPlan(range, granularity, now, custom);
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
      const [bucketKey = "", harness = "", model = "", project = ""] = key.split("\u0001");
      if (enabledHarnesses && !enabledHarnesses.has(harness)) continue;
      const date = bucketKey.slice(0, 10);
      if (!firstDay || date < firstDay) firstDay = date;
      if (bucketKey < plan.startKey || bucketKey > plan.endKey) continue;
      const periodKey = plan.periodKeyOf(bucketKey);
      const inSeries = allowed.has(periodKey);
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
      if (inSeries) {
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
        full: plan.full(key),
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

export function buildAgentReport(state: ScanState, agent: string, range: UsageRangeKey, origin?: string, enabledHarnesses?: ReadonlySet<string>, custom?: { from?: string; to?: string } | null, granularity: UsageGranularity = "day"): UsageAgentReport {
  const now = new Date();
  const plan = buildPlan(range, granularity, now, custom);
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
      const [bucketKey = "", harness = "", model = "", project = ""] = key.split("\u0001");
      if (harness !== agent) continue;
      if (bucketKey < plan.startKey || bucketKey > plan.endKey) continue;
      const periodKey = plan.periodKeyOf(bucketKey);
      const inSeries = allowed.has(periodKey);
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
      if (inSeries) {
        let point = series.get(periodKey);
        if (!point) {
          point = { tokens: 0, credits: 0 };
          series.set(periodKey, point);
        }
        point.tokens += bucket.i + bucket.o + bucket.cr + bucket.cw;
        point.credits += bucket.credits;
      }
    }
  }

  const requests: UsageAgentReport["requests"] = [];
  const collectRecords = (records: Record<string, CallRecord[]> | undefined, origin: string) => {
    for (const record of records?.[agent] ?? []) {
      const hourKey = localHourKey(record.t);
      if (hourKey < plan.startKey || hourKey > plan.endKey) continue;
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

  const win = rangeWindow(range, now, custom);
  const sessions = agentEnabled
    ? collectAgentSessions(state, agent, win.start.getTime(), win.end.getTime(), originFilter)
    : { count: 0, items: [] as UsageSessionItem[] };

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
        full: plan.full(key),
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
    sessionCount: sessions.count,
    sessions: sessions.items,
  };
}

/**
 * Session rows for ONE agent: a session belongs to the range where it
 * STARTS and each row shows the session's whole consumption. `count` covers
 * every matching session; `items` is the newest slice taken after sorting.
 */
function collectAgentSessions(state: ScanState, agent: string, startMs: number, endMs: number, originFilter: string | null): { count: number; items: UsageSessionItem[] } {
  const matched: UsageSessionItem[] = [];
  let count = 0;
  for (const source of collectSessionSources(state)) {
    if (originFilter !== null && source.id !== originFilter) continue;
    for (const [key, entry] of Object.entries(source.sessions)) {
      if (!entry || entry.s <= 0) continue;
      const separator = key.indexOf("\u0001");
      if (separator < 0 || key.slice(0, separator) !== agent) continue;
      const sid = key.slice(separator + 1);
      if (!sid) continue;
      if (entry.s < startMs || entry.s > endMs) continue;
      count += 1;
      matched.push({
        id: sid,
        title: typeof entry.title === "string" ? entry.title : "",
        agent,
        project: entry.p,
        start: round0(entry.s),
        end: round0(entry.e),
        requests: round0(entry.r),
        input: round0(entry.i),
        output: round0(entry.o),
        cacheRead: round0(entry.cr),
        cacheWrite: round0(entry.cw),
        totalTokens: round0(entry.i + entry.o + entry.cr + entry.cw),
        reportedCostUsd: round2(entry.cost),
        credits: round2(entry.credits),
      });
    }
  }
  matched.sort((a, b) => b.start - a.start);
  return { count, items: matched.slice(0, MAX_SESSIONS) };
}
