import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { UsageModelItem } from "../../shared/usage";
import { agentColor, TOKEN_COLORS, COST_COLOR } from "../agents";
import { totalTokens } from "../dashboard-data";
import { formatTokens, formatUsd } from "../format";
import { Empty, MetricSwitch, ScatterPlot, ShareBar, StackedColumns, TrendChart } from "../visuals";
import { costSourceShort, downsampleSeries, hitOf, percentText, pick, pointAverageRequest, pointCacheHit, pointOutputRatio, sum, unpricedSummary, type CardProps } from "./shared";

export function CacheHitCard({ data, theme, locale, compact }: CardProps) {
  const series = useMemo(() => downsampleSeries(data.series, compact ? 30 : 60), [data.series, compact]);
  const hit = hitOf(data.totals);
  if (data.totals.cacheRead <= 0) return <Empty theme={theme} text={pick(locale, "当前范围没有缓存读取。", "No cache reads in this range.")} />;
  return (
    <View style={{ gap: 6 }}>
      <TrendChart
        theme={theme}
        points={series.map((point) => ({ label: point.label, value: (pointCacheHit(point) ?? 0) * 100, detail: point.full }))}
        color={TOKEN_COLORS.cacheRead}
        format={(value) => `${value.toFixed(0)}%`}
        mode="line"
        average={false}
        target={80}
        targetLabel="80%"
        height={120}
        compact={compact}
      />
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
        {pick(locale, `当前 ${hit === null ? "—" : percentText(hit)}，缓存读 ${formatTokens(data.totals.cacheRead)}。`, `Now ${hit === null ? "—" : percentText(hit)}, cache read ${formatTokens(data.totals.cacheRead)}.`)}
      </Text>
    </View>
  );
}

export function CacheFlowCard({ data, theme, locale, compact }: CardProps) {
  const series = useMemo(() => downsampleSeries(data.series, compact ? 30 : 60), [data.series, compact]);
  const read = data.totals.cacheRead;
  const write = data.totals.cacheWrite;
  const ratio = write > 0 ? read / write : null;
  return (
    <View style={{ gap: 7 }}>
      <ShareBar
        theme={theme}
        height={8}
        segments={[
          { key: "read", value: read, color: TOKEN_COLORS.cacheRead },
          { key: "write", value: write, color: TOKEN_COLORS.cacheWrite },
        ]}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
        <Text style={{ fontSize: 11, color: theme.colors.foreground }}>{pick(locale, "缓存读", "Cache read")} <Text style={{ fontWeight: "700" }}>{formatTokens(read)}</Text></Text>
        <Text style={{ fontSize: 11, color: theme.colors.foreground }}>{pick(locale, "缓存写", "Cache write")} <Text style={{ fontWeight: "700" }}>{formatTokens(write)}</Text></Text>
        <Text style={{ fontSize: 11, color: theme.colors.foreground }}>{pick(locale, "读写比", "Read/write")} <Text style={{ fontWeight: "700" }}>{ratio === null ? "—" : `${ratio.toFixed(1)}×`}</Text></Text>
      </View>
      {write > 0 ? (
        <TrendChart
          theme={theme}
          points={series.map((point) => ({ label: point.label, value: point.cacheWrite, detail: point.full }))}
          color={TOKEN_COLORS.cacheWrite}
          format={formatTokens}
          average
          height={80}
          compact={compact}
        />
      ) : (
        <Empty theme={theme} text={pick(locale, "该范围没有缓存写；缓存读仍可被复用。", "No cache writes in this range; cache reads can still be reused.")} />
      )}
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "缓存写是新增提示词缓存，缓存读是命中后的复用。", "Cache write fills the prompt cache; cache read reuses it.")}</Text>
    </View>
  );
}

export function AvgRequestCard({ data, theme, locale, compact }: CardProps) {
  const series = useMemo(() => downsampleSeries(data.series, compact ? 30 : 60), [data.series, compact]);
  const totals = data.totals;
  const avg = totals.requests > 0 ? totalTokens(totals) / totals.requests : 0;
  return (
    <View style={{ gap: 6 }}>
      <TrendChart
        theme={theme}
        points={series.map((point) => ({ label: point.label, value: pointAverageRequest(point), detail: point.full }))}
        color={TOKEN_COLORS.input}
        format={formatTokens}
        mode="line"
        average
        height={112}
        compact={compact}
      />
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
        {pick(
          locale,
          `当前均值 ${formatTokens(avg)} tok/次；输入 ${formatTokens(totals.requests > 0 ? totals.input / totals.requests : 0)}，输出 ${formatTokens(totals.requests > 0 ? totals.output / totals.requests : 0)}。`,
          `Now ${formatTokens(avg)} tok/req; input ${formatTokens(totals.requests > 0 ? totals.input / totals.requests : 0)}, output ${formatTokens(totals.requests > 0 ? totals.output / totals.requests : 0)}.`,
        )}
      </Text>
    </View>
  );
}

export function IoStructureCard({ data, theme, locale, compact }: CardProps) {
  const series = useMemo(() => downsampleSeries(data.series, compact ? 30 : 60), [data.series, compact]);
  const totals = data.totals;
  const total = totalTokens(totals);
  const reasoningShare = total > 0 ? totals.reasoning / total : 0;
  return (
    <View style={{ gap: 6 }}>
      <TrendChart
        theme={theme}
        points={series.map((point) => ({ label: point.label, value: pointOutputRatio(point), detail: point.full }))}
        color={TOKEN_COLORS.output}
        format={(value) => `${value.toFixed(2)}×`}
        mode="line"
        average
        height={112}
        compact={compact}
      />
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
        {pick(
          locale,
          `输出/输入比；Reasoning 占总量 ${percentText(reasoningShare, 1)}，平均每次 ${formatTokens(totals.requests > 0 ? totals.reasoning / totals.requests : 0)} tok。`,
          `Output/input ratio; reasoning is ${percentText(reasoningShare, 1)} of total, ${formatTokens(totals.requests > 0 ? totals.reasoning / totals.requests : 0)} tok per request.`,
        )}
      </Text>
    </View>
  );
}

export function EfficiencyQuadrantCard({ data, theme, locale }: CardProps) {
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; tokens: number; requests: number; input: number; cacheRead: number; cacheWrite: number; agents: Set<string> }>();
    for (const model of data.models as UsageModelItem[]) {
      const key = model.model || "unknown";
      const group = map.get(key) ?? { key, tokens: 0, requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, agents: new Set<string>() };
      group.tokens += model.totalTokens;
      group.requests += model.requests;
      group.input += model.input;
      group.cacheRead += model.cacheRead;
      group.cacheWrite += model.cacheWrite;
      group.agents.add(model.agent);
      map.set(key, group);
    }
    return [...map.values()].filter((group) => group.requests > 0).sort((a, b) => b.requests - a.requests).slice(0, 14);
  }, [data.models]);
  if (groups.length === 0) return <Empty theme={theme} text={pick(locale, "当前范围没有模型数据。", "No model data in this range.")} />;
  const maxRequests = Math.max(1, ...groups.map((group) => group.requests));
  const points = groups.map((group) => {
    const denominator = group.input + group.cacheRead + group.cacheWrite;
    return {
      key: group.key,
      x: group.tokens / group.requests,
      y: denominator > 0 ? group.cacheRead / denominator : 0,
      size: 2 + Math.sqrt(group.requests / maxRequests) * 5,
      color: agentColor([...group.agents][0] ?? "codex"),
      label: group.key,
    };
  });
  return (
    <View style={{ gap: 6 }}>
      <ScatterPlot theme={theme} points={points} xLabel={pick(locale, "Token / 请求", "Tokens / request")} yLabel={pick(locale, "缓存命中", "Cache hit")} formatX={formatTokens} formatY={(value) => `${Math.round(value * 100)}%`} logX height={180} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {groups.slice(0, 6).map((group) => (
          <View key={group.key} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: agentColor([...group.agents][0] ?? "codex") }} />
            <Text style={{ fontSize: 9, color: theme.colors.foregroundMuted }}>{group.key}</Text>
          </View>
        ))}
      </View>
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "越靠左上（请求更小、缓存命中更高）越省；气泡越大请求越多。", "Up and left (smaller requests, higher cache hit) is more efficient; bigger bubbles mean more requests.")}</Text>
    </View>
  );
}

type CostView = "trend" | "efficiency";

export function CostCard({ data, theme, locale, compact }: CardProps) {
  const [view, setView] = useState<CostView>("trend");
  const agents = data.agents.filter((agent) => agent.costUsd > 0);
  const totalCost = sum(agents.map((agent) => agent.costUsd));
  const series = useMemo(() => downsampleSeries(data.series, compact ? 30 : 60), [data.series, compact]);
  const unpricedNote = unpricedSummary(data.totals.unpricedTokens, data.totals.unpricedModels, locale);
  if (agents.length === 0) {
    return (
      <View style={{ gap: 4 }}>
        <Empty theme={theme} text={pick(locale, "当前范围内暂无已定价的成本数据。", "No priced cost data in this range.")} />
        {unpricedNote ? <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{unpricedNote}</Text> : null}
      </View>
    );
  }
  return (
    <View style={{ gap: 7 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <MetricSwitch
          theme={theme}
          value={view}
          options={[
            { value: "trend", label: pick(locale, "趋势", "Trend") },
            { value: "efficiency", label: pick(locale, "效率", "Efficiency") },
          ]}
          onChange={setView}
        />
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          {data.totals.cacheSavingsUsd > 0 ? (
            <Text style={{ fontSize: 10, color: theme.colors.statusSuccess, fontVariant: ["tabular-nums"] }}>
              {pick(locale, `缓存省 ${formatUsd(data.totals.cacheSavingsUsd)}`, `Saved ${formatUsd(data.totals.cacheSavingsUsd)}`)}
            </Text>
          ) : null}
          <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.foreground, fontVariant: ["tabular-nums"] }}>{formatUsd(totalCost)}</Text>
        </View>
      </View>
      {view === "trend" ? (
        <TrendChart
          theme={theme}
          points={series.map((point) => ({ label: point.label, value: point.costUsd, detail: point.full }))}
          color={COST_COLOR}
          format={formatUsd}
          average
          height={112}
          compact={compact}
        />
      ) : (
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", paddingBottom: 2 }}>
            <Text style={{ flex: 1, fontSize: 9, color: theme.colors.foregroundMuted }}>{pick(locale, "Agent", "Agent")}</Text>
            <Text style={{ width: 34, textAlign: "right", fontSize: 9, color: theme.colors.foregroundMuted }}>{pick(locale, "口径", "Src")}</Text>
            <Text style={{ width: 54, textAlign: "right", fontSize: 9, color: theme.colors.foregroundMuted }}>{pick(locale, "成本", "Cost")}</Text>
            <Text style={{ width: 54, textAlign: "right", fontSize: 9, color: theme.colors.foregroundMuted }}>{pick(locale, "$/1M", "$/1M")}</Text>
            <Text style={{ width: 50, textAlign: "right", fontSize: 9, color: theme.colors.foregroundMuted }}>{pick(locale, "$/次", "$/req")}</Text>
          </View>
          {agents
            .slice()
            .sort((a, b) => b.costUsd - a.costUsd)
            .map((agent) => {
              const perM = agent.totalTokens > 0 ? agent.costUsd / (agent.totalTokens / 1_000_000) : 0;
              const perRequest = agent.requests > 0 ? agent.costUsd / agent.requests : 0;
              return (
                <View key={agent.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 5, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
                  <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: agentColor(agent.id) }} />
                    <Text numberOfLines={1} style={{ fontSize: 11, color: theme.colors.foreground }}>{agent.label}</Text>
                  </View>
                  <Text style={{ width: 34, textAlign: "right", fontSize: 9, color: theme.colors.foregroundMuted }}>{costSourceShort(agent.reportedCostUsd, agent.estimatedCostUsd, locale)}</Text>
                  <Text style={{ width: 54, textAlign: "right", fontSize: 11, color: theme.colors.foreground, fontVariant: ["tabular-nums"] }}>{formatUsd(agent.costUsd)}</Text>
                  <Text style={{ width: 54, textAlign: "right", fontSize: 11, color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{perM > 0 ? `$${perM.toFixed(2)}` : "—"}</Text>
                  <Text style={{ width: 50, textAlign: "right", fontSize: 11, color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{perRequest > 0 ? `$${perRequest.toFixed(3)}` : "—"}</Text>
                </View>
              );
            })}
        </View>
      )}
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
        {pick(locale, "日志上报值优先，未上报模型按 API 费率表估算；$/1M 为每百万 Token 成本。", "Reported costs take precedence; unbilled models use API-equivalent rates. $/1M is cost per million tokens.")}
      </Text>
      {unpricedNote ? <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{unpricedNote}</Text> : null}
    </View>
  );
}

type CumulativeMetric = "tokens" | "cost";

export function CumulativeCard({ data, theme, locale, compact }: CardProps) {
  const [metric, setMetric] = useState<CumulativeMetric>("tokens");
  const series = useMemo(() => downsampleSeries(data.series, compact ? 24 : 48), [data.series, compact]);
  const agents = data.agents.filter((agent) => (metric === "tokens" ? agent.totalTokens > 0 : agent.costUsd > 0));
  const running = new Map<string, number>();
  const points = series.map((point) => {
    const parts = agents.map((agent) => {
      const value = metric === "tokens" ? point.byAgent[agent.id] ?? 0 : point.byAgentCostUsd[agent.id] ?? 0;
      const next = (running.get(agent.id) ?? 0) + value;
      running.set(agent.id, next);
      return next;
    });
    return { key: point.key, label: point.label, detail: point.full, parts };
  });
  const final = points[points.length - 1]?.parts.reduce((total, value) => total + value, 0) ?? 0;
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 6, flexWrap: "wrap", paddingBottom: 2 }}>
        <MetricSwitch
          theme={theme}
          value={metric}
          options={[
            { value: "tokens", label: pick(locale, "Token", "Tokens") },
            { value: "cost", label: pick(locale, "成本", "Cost") },
          ]}
          onChange={setMetric}
        />
        <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.foreground, fontVariant: ["tabular-nums"] }}>{metric === "tokens" ? formatTokens(final) : formatUsd(final)}</Text>
      </View>
      {agents.length === 0 ? (
        <Empty theme={theme} text={pick(locale, "当前范围没有可累计的已定价成本。", "No priced cost to accumulate in this range.")} />
      ) : (
        <View style={{ paddingTop: 8 }}>
          <StackedColumns
            theme={theme}
            points={points}
            colors={agents.map((agent) => agentColor(agent.id))}
            names={agents.map((agent) => agent.label)}
            format={metric === "tokens" ? formatTokens : formatUsd}
            compact={compact}
          />
        </View>
      )}
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "累计曲线按 Agent 分层；成本包含日志上报与 API 估算。", "Cumulative curve split by agent; cost includes reported and API-estimated amounts.")}</Text>
    </View>
  );
}
