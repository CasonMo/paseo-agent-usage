import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const usageRangeSchema = z.enum(["24h", "today", "7d", "30d", "12w", "12m", "custom"]);
export type UsageRangeKey = z.infer<typeof usageRangeSchema>;

export const usageGranularitySchema = z.enum(["hour", "day", "week", "month"]);
export type UsageGranularity = z.infer<typeof usageGranularitySchema>;

export const totalsSchema = z.object({
  requests: z.number(),
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number(),
  reportedCostUsd: z.number(),
  credits: z.number(),
});

export const seriesPointSchema = z.object({
  key: z.string(),
  label: z.string(),
  full: z.string(),
  totalTokens: z.number(),
  credits: z.number(),
  byAgent: z.record(z.string(), z.number()),
});

export const modelItemSchema = z.object({
  agent: z.string(),
  model: z.string(),
  requests: z.number(),
  totalTokens: z.number(),
  credits: z.number(),
  reportedCostUsd: z.number(),
});

export const projectItemSchema = z.object({
  project: z.string(),
  requests: z.number(),
  totalTokens: z.number(),
  credits: z.number(),
});

export const callRecordSchema = z.object({
  ts: z.number(),
  model: z.string(),
  project: z.string(),
  session: z.string(),
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number(),
  credits: z.number(),
  costUsd: z.number(),
  origin: z.string(),
});

export const originSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["ok", "pulling", "error", "never"]),
  lastPullAt: z.number().nullable(),
  lastError: z.string().nullable(),
  requests: z.number(),
  totalTokens: z.number(),
  credits: z.number(),
});

export const agentItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  requests: z.number(),
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number(),
  totalTokens: z.number(),
  reportedCostUsd: z.number(),
  credits: z.number(),
});

export const usageReportOutput = z.object({
  generatedAt: z.number(),
  scanning: z.boolean(),
  scanDone: z.number(),
  scanTotal: z.number(),
  scanError: z.string().nullable(),
  firstDay: z.string().nullable(),
  totals: totalsSchema,
  agents: z.array(agentItemSchema),
  series: z.array(seriesPointSchema),
  models: z.array(modelItemSchema),
  projects: z.array(projectItemSchema),
  origins: z.array(originSchema),
});

export const usageReportRpc = defineRpc({
  name: "usage.report",
  input: z.object({
    range: usageRangeSchema,
    granularity: usageGranularitySchema.optional(),
    origin: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  output: usageReportOutput,
});

export const usageRefreshRpc = defineRpc({
  name: "usage.refresh",
  input: z.object({}),
  output: z.object({ started: z.boolean() }),
});

export const sessionItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  agent: z.string(),
  project: z.string(),
  start: z.number(),
  end: z.number(),
  requests: z.number(),
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  totalTokens: z.number(),
  reportedCostUsd: z.number(),
  credits: z.number(),
});

export const agentReportOutput = z.object({
  agent: z.string(),
  label: z.string(),
  totals: totalsSchema,
  series: z.array(seriesPointSchema),
  models: z.array(modelItemSchema),
  projects: z.array(projectItemSchema),
  requests: z.array(callRecordSchema),
  sessionCount: z.number(),
  sessions: z.array(sessionItemSchema),
});

export const usageAgentRpc = defineRpc({
  name: "usage.agent",
  input: z.object({
    agent: z.string(),
    range: usageRangeSchema,
    granularity: usageGranularitySchema.optional(),
    origin: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  output: agentReportOutput,
});

export const hostFormSchema = z.object({
  name: z.string(),
  target: z.string(),
  enabled: z.boolean(),
  port: z.number().nullable(),
  identityFile: z.string(),
  passwordCommand: z.string(),
  nodePath: z.string(),
  cacheDir: z.string(),
  timeoutMs: z.number().nullable(),
  password: z.string().optional(),
});

const hostListItemSchema = hostFormSchema.omit({ password: true }).extend({ hasPassword: z.boolean() });

export const usageHostsListRpc = defineRpc({
  name: "usage.hosts.list",
  input: z.object({}),
  output: z.object({ hosts: z.array(hostListItemSchema) }),
});

export const usageHostsSetRpc = defineRpc({
  name: "usage.hosts.set",
  input: z.object({ hosts: z.array(hostFormSchema) }),
  output: z.object({ saved: z.boolean(), error: z.string().nullable() }),
});

export const usageHostsTestRpc = defineRpc({
  name: "usage.hosts.test",
  input: z.object({ host: hostFormSchema }),
  output: z.object({ ok: z.boolean(), detail: z.string() }),
});

export type UsageHostForm = z.infer<typeof hostFormSchema>;
export type UsageHostListItem = z.infer<typeof hostListItemSchema>;

export const agentToggleSchema = z.object({
  id: z.string(),
  label: z.string(),
  enabled: z.boolean(),
});

export const usageAgentsGetRpc = defineRpc({
  name: "usage.agents.get",
  input: z.object({}),
  output: z.object({ agents: z.array(agentToggleSchema) }),
});

export const agentSetItemSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
});

export const usageAgentsSetRpc = defineRpc({
  name: "usage.agents.set",
  input: z.object({ agents: z.array(agentSetItemSchema) }),
  output: z.object({ saved: z.boolean(), error: z.string().nullable() }),
});

export const usageLanguageSchema = z.enum(["auto", "zh", "en"]);

export const usagePrefsSchema = z.object({
  language: usageLanguageSchema,
  refreshMinutes: z.number().int().min(0).max(1440),
});

export const usagePrefsGetRpc = defineRpc({
  name: "usage.prefs.get",
  input: z.object({ locale: z.enum(["zh", "en"]).optional() }),
  output: usagePrefsSchema,
});

export const usagePrefsSetRpc = defineRpc({
  name: "usage.prefs.set",
  input: usagePrefsSchema,
  output: z.object({ saved: z.boolean(), error: z.string().nullable() }),
});

export const usageUpdateCheckRpc = defineRpc({
  name: "usage.update.check",
  input: z.object({}),
  output: z.object({
    currentVersion: z.string(),
    latestVersion: z.string(),
    latestCommit: z.string(),
    updateAvailable: z.boolean(),
    checkedAt: z.string(),
  }),
});

export type UsagePrefs = z.infer<typeof usagePrefsSchema>;
export type UsageLanguage = z.infer<typeof usageLanguageSchema>;

export type UsageAgentToggle = z.infer<typeof agentToggleSchema>;
export type UsageAgentSetItem = z.infer<typeof agentSetItemSchema>;

export type UsageReport = z.infer<typeof usageReportOutput>;
export type UsageAgent = z.infer<typeof agentItemSchema>;
export type UsageSeriesPoint = z.infer<typeof seriesPointSchema>;
export type UsageAgentReport = z.infer<typeof agentReportOutput>;
export type UsageCallRecord = z.infer<typeof callRecordSchema>;
export type UsageSessionItem = z.infer<typeof sessionItemSchema>;
