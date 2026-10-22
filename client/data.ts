import { useRpc } from "@getpaseo/plugin/client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usageAgentRpc, usageAgentsGetRpc, usageAgentsSetRpc, usagePrefsGetRpc, usagePrefsSetRpc, usageRefreshRpc, usageReportRpc, usageUpdateCheckRpc, type UsageGranularity, type UsageRangeKey } from "../shared/usage";

export const PREFS_QUERY_KEY = ["agent-usage-prefs"] as const;

export interface CustomRange {
  from: string;
  to: string;
}

export function useUsageReport(range: UsageRangeKey, origin?: string, custom?: CustomRange, granularity: UsageGranularity = "day") {
  const call = useRpc(usageReportRpc);
  return useQuery({
    queryKey: ["agent-usage", range, origin ?? "aggregate", custom ? `${custom.from}~${custom.to}` : "", granularity],
    queryFn: () => call({ range, origin, ...(custom ? { from: custom.from, to: custom.to } : {}), granularity }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    refetchInterval: (query) => (query.state.data?.scanning ? 2_500 : 30_000),
  });
}

export function useAgentReport(agent: string, range: UsageRangeKey, enabled = true, origin?: string, custom?: CustomRange, granularity: UsageGranularity = "day") {
  const call = useRpc(usageAgentRpc);
  return useQuery({
    queryKey: ["agent-usage-agent", agent, range, origin ?? "aggregate", custom ? `${custom.from}~${custom.to}` : "", granularity],
    queryFn: () => call({ agent, range, origin, ...(custom ? { from: custom.from, to: custom.to } : {}), granularity }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useAgentsConfig() {
  const call = useRpc(usageAgentsGetRpc);
  return useQuery({
    queryKey: ["agent-usage-agents"],
    queryFn: () => call({}),
    staleTime: 30_000,
  });
}

export function useSetAgentsConfig() {
  const call = useRpc(usageAgentsSetRpc);
  return call;
}

export function useRefreshUsage() {
  const call = useRpc(usageRefreshRpc);
  return call;
}

export function usePrefs(systemLocale?: "zh" | "en") {
  const call = useRpc(usagePrefsGetRpc);
  return useQuery({
    queryKey: PREFS_QUERY_KEY,
    queryFn: () => call(systemLocale ? { locale: systemLocale } : {}),
    staleTime: 30_000,
  });
}

export function useSetPrefs() {
  return useRpc(usagePrefsSetRpc);
}

export function useUpdateCheck() {
  const call = useRpc(usageUpdateCheckRpc);
  return useQuery({
    queryKey: ["agent-usage", "update-check"],
    queryFn: () => call({}),
    staleTime: 3_600_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
