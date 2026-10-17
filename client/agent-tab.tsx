import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import { Text, View } from "react-native";
import type { UsageGranularity, UsageRangeKey } from "../shared/usage";
import { AGENT_COLORS, FALLBACK_COLOR, TrendChart, type ChartMode } from "./charts";
import { useAgentReport, type CustomRange } from "./data";
import { formatCredits, formatPercent, formatTokens, shortProject } from "./format";
import { useI18n } from "./i18n";

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
  granularity,
  theme,
  compact,
  chartMode,
}: {
  agent: string;
  range: UsageRangeKey;
  origin?: string;
  custom?: CustomRange;
  granularity: UsageGranularity;
  theme: Theme;
  compact: boolean;
  chartMode: ChartMode;
}) {
  const query = useAgentReport(agent, range, true, origin, custom, granularity);
  const { t } = useI18n();
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
        <Text style={styles.sectionTitle}>{t("common.loading")}</Text>
      </View>
    );
  }

  const totals = data.totals;
  const totalTokens = totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
  const color = AGENT_COLORS[agent] ?? FALLBACK_COLOR;
  const cards: Array<{ label: string; value: string }> = [
    { label: t("card.totalTokens"), value: formatTokens(totalTokens) },
    { label: t("card.requests"), value: `${totals.requests}` },
    { label: t("card.cacheShare"), value: formatPercent(totals.cacheRead, totalTokens) },
  ];
  if (totals.credits > 0) cards.push({ label: t("card.credits"), value: formatCredits(totals.credits) });

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
        <Text style={styles.sectionTitle}>{t("section.agentTrend", { label: data.label })}</Text>
        <TrendChart series={data.series} theme={theme} compact={compact} mode={chartMode} />
      </View>

      {data.models.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("section.models")}</Text>
          {data.models.slice(0, compact ? 8 : 12).map((model) => (
            <View key={model.model} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              <Text style={styles.rowName} numberOfLines={1}>
                {model.model}
              </Text>
              <Text style={styles.rowValue}>
                {formatTokens(model.totalTokens)} tok · {t("unit.requests", { n: model.requests })}
                {model.credits > 0 ? ` · ${t("unit.creditsShort", { n: formatCredits(model.credits) })}` : ""}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {data.projects.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("section.projects")}</Text>
          {data.projects.slice(0, compact ? 6 : 10).map((project) => (
            <View key={project.project || "unknown"} style={styles.row}>
              <Text style={styles.rowName} numberOfLines={1}>
                {shortProject(project.project)}
              </Text>
              <Text style={styles.rowValue}>
                {formatTokens(project.totalTokens)} tok
                {project.credits > 0 ? ` · ${t("unit.creditsShort", { n: formatCredits(project.credits) })}` : ""}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("section.requestLog", { n: data.requests.length })}</Text>
        {data.requests.length === 0 ? (
          <Text style={styles.footer}>{t("log.empty")}</Text>
        ) : (
          data.requests.map((record, index) => {
            const tokens = record.input + record.output + record.cacheRead + record.cacheWrite;
            const parts: string[] = [];
            if (tokens > 0) parts.push(`${formatTokens(tokens)} tok`);
            if (record.credits > 0) parts.push(t("unit.creditsShort", { n: formatCredits(record.credits) }));
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
                  {record.session ? ` · ${record.session.slice(0, 8)}` : ""} · {record.origin === "local" ? t("origin.local") : record.origin}
                  {tokens > 0
                    ? ` · ${t("unit.in")} ${formatTokens(record.input)} · ${t("unit.out")} ${formatTokens(record.output)} · ${t("unit.cache")} ${formatTokens(record.cacheRead)}`
                    : ""}
                </Text>
              </View>
            );
          })
        )}
        <Text style={styles.footer}>{t("log.footer")}</Text>
      </View>
    </>
  );
}
