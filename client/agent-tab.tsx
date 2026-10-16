import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import { Text, View } from "react-native";
import type { UsageRangeKey } from "../shared/usage";
import { AGENT_COLORS, FALLBACK_COLOR, TrendChart, type ChartMode } from "./charts";
import { useAgentReport, type CustomRange } from "./data";
import { formatCredits, formatPercent, formatTokens, shortProject } from "./format";

type Theme = PluginScreenProps["theme"];

function formatDateTime(ts: number): string {
  const date = new Date(ts);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hours}:${minutes}`;
}

export function AgentTab({
  agent,
  range,
  origin,
  custom,
  theme,
  compact,
  chartMode,
}: {
  agent: string;
  range: UsageRangeKey;
  origin?: string;
  custom?: CustomRange;
  theme: Theme;
  compact: boolean;
  chartMode: ChartMode;
}) {
  const query = useAgentReport(agent, range, true, origin, custom);
  const data = query.data;
  const styles = useMemo(
    () =>
      ({
        cardRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
        card: { flexGrow: 1, minWidth: compact ? 104 : 150, backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 12, gap: 4 },
        cardLabel: { fontSize: 11, color: theme.colors.foregroundMuted },
        cardValue: { fontSize: compact ? 15 : 18, fontWeight: "700", color: theme.colors.foreground },
        section: { backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 12, gap: 10 },
        sectionTitle: { fontSize: 13, fontWeight: "600", color: theme.colors.foreground },
        row: { flexDirection: "row", alignItems: "center", gap: 6 },
        dot: { width: 8, height: 8, borderRadius: 4 },
        rowName: { fontSize: 11, color: theme.colors.foreground, flex: 1 },
        rowValue: { fontSize: 11, color: theme.colors.foregroundMuted },
        footer: { fontSize: 10, color: theme.colors.foregroundMuted },
        logRow: { gap: 2, paddingVertical: 6, borderTopWidth: 1, borderTopColor: theme.colors.border },
        logHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
        logTime: { fontSize: 10, color: theme.colors.foregroundMuted, width: 84 },
        logModel: { fontSize: 11, color: theme.colors.foreground, flex: 1 },
        logValue: { fontSize: 11, color: theme.colors.foregroundMuted },
        logMeta: { fontSize: 10, color: theme.colors.foregroundMuted },
      }) satisfies Record<string, ViewStyle | TextStyle>,
    [theme, compact],
  );

  if (!data) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>加载中…</Text>
      </View>
    );
  }

  const totals = data.totals;
  const totalTokens = totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
  const color = AGENT_COLORS[agent] ?? FALLBACK_COLOR;
  const cards: Array<{ label: string; value: string }> = [
    { label: "总 Tokens", value: formatTokens(totalTokens) },
    { label: "请求数", value: `${totals.requests}` },
    { label: "缓存读取占比", value: formatPercent(totals.cacheRead, totalTokens) },
  ];
  if (totals.credits > 0) cards.push({ label: "积分", value: formatCredits(totals.credits) });

  return (
    <>
      <View style={styles.cardRow}>
        {cards.map((card) => (
          <View key={card.label} style={styles.card}>
            <Text style={styles.cardLabel}>{card.label}</Text>
            <Text style={styles.cardValue}>{card.value}</Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{data.label} 趋势</Text>
        <TrendChart series={data.series} theme={theme} compact={compact} mode={chartMode} />
      </View>

      {data.models.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>模型明细</Text>
          {data.models.slice(0, compact ? 8 : 12).map((model) => (
            <View key={model.model} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              <Text style={styles.rowName} numberOfLines={1}>
                {model.model}
              </Text>
              <Text style={styles.rowValue}>
                {formatTokens(model.totalTokens)} tok · {model.requests} 次
                {model.credits > 0 ? ` · ${formatCredits(model.credits)} 分` : ""}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {data.projects.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>项目明细</Text>
          {data.projects.slice(0, compact ? 6 : 10).map((project) => (
            <View key={project.project || "unknown"} style={styles.row}>
              <Text style={styles.rowName} numberOfLines={1}>
                {shortProject(project.project)}
              </Text>
              <Text style={styles.rowValue}>
                {formatTokens(project.totalTokens)} tok
                {project.credits > 0 ? ` · ${formatCredits(project.credits)} 分` : ""}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>请求日志（最近 {data.requests.length} 条）</Text>
        {data.requests.length === 0 ? (
          <Text style={styles.footer}>所选范围内暂无记录；日志只保留最近约 400 条调用。</Text>
        ) : (
          data.requests.map((record, index) => {
            const tokens = record.input + record.output + record.cacheRead + record.cacheWrite;
            const parts: string[] = [];
            if (tokens > 0) parts.push(`${formatTokens(tokens)} tok`);
            if (record.credits > 0) parts.push(`${formatCredits(record.credits)} 分`);
            return (
              <View key={`${record.ts}-${index}`} style={styles.logRow}>
                <View style={styles.logHeader}>
                  <Text style={styles.logTime}>{formatDateTime(record.ts)}</Text>
                  <Text style={styles.logModel} numberOfLines={1}>
                    {record.model}
                  </Text>
                  <Text style={styles.logValue}>{parts.join(" · ")}</Text>
                </View>
                <Text style={styles.logMeta} numberOfLines={1}>
                  {shortProject(record.project)}
                  {record.session ? ` · ${record.session.slice(0, 8)}` : ""} · {record.origin === "local" ? "本机" : record.origin}
                  {tokens > 0 ? ` · 入 ${formatTokens(record.input)} · 出 ${formatTokens(record.output)} · 缓存 ${formatTokens(record.cacheRead)}` : ""}
                </Text>
              </View>
            );
          })
        )}
        <Text style={styles.footer}>日志仅保留最近约 400 条调用，更早的会滚动淘汰。</Text>
      </View>
    </>
  );
}
