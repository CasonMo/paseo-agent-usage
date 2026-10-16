import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useMemo, useState } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { UsageRangeKey } from "../shared/usage";
import { AgentTab } from "./agent-tab";
import { ConfigScreen } from "./config";
import { DateRangePicker } from "./date-range";
import { AGENT_COLORS, FALLBACK_COLOR, TrendChart, type ChartMode } from "./charts";
import { useRefreshUsage, useUsageReport, useUpdateCheck } from "./data";
import { formatCredits, formatPercent, formatTokens, shortProject } from "./format";
import { useI18n, type Translate } from "./i18n";

function originStatusText(t: Translate, status: string, lastPullAt: number | null): string {
  if (status === "pulling") return t("origin.pulling");
  if (status === "error") return t("origin.error");
  if (status === "never") return t("origin.never");
  if (lastPullAt) {
    const date = new Date(lastPullAt);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return t("origin.synced", { time: `${hours}:${minutes}` });
  }
  return t("origin.ok");
}

const RANGE_KEYS: UsageRangeKey[] = ["today", "7d", "30d", "12w", "12m", "custom"];
const RANGE_LABEL_KEYS = ["range.today", "range.7d", "range.30d", "range.12w", "range.12m", "range.custom"] as const;

function defaultCustomRange(): { from: string; to: string } {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
  const key = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  return { from: key(start), to: key(today) };
}

const CHART_MODE_KEYS: ChartMode[] = ["bar", "line"];
const CHART_MODE_LABEL_KEYS = ["chart.bar", "chart.line"] as const;

export function UsageScreen(props: PluginScreenProps) {
  const { theme, layout } = props;
  const [range, setRange] = useState<UsageRangeKey>("7d");
  const [showSettings, setShowSettings] = useState(false);
  const [device, setDevice] = useState<string>("aggregate");
  const [tab, setTab] = useState<string>("overview");
  const [chartMode, setChartMode] = useState<ChartMode>("bar");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [showNotes, setShowNotes] = useState(true);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const updateQuery = useUpdateCheck();
  const deviceOrigin = device === "aggregate" ? undefined : device;
  const customPayload = useMemo(() => {
    if (range !== "custom" || !customFrom || !customTo) return undefined;
    return { from: customFrom, to: customTo };
  }, [range, customFrom, customTo]);
  const query = useUsageReport(range, deviceOrigin, customPayload);
  const refresh = useRefreshUsage();
  const { t } = useI18n();
  const ranges = useMemo(() => RANGE_KEYS.map((key, index) => ({ key, label: t(RANGE_LABEL_KEYS[index]) })), [t]);
  const chartModes = useMemo(() => CHART_MODE_KEYS.map((key, index) => ({ key, label: t(CHART_MODE_LABEL_KEYS[index]) })), [t]);
  const compact = layout.compact;
  const styles = useMemo(
    () =>
      ({
        screen: { flex: 1, backgroundColor: theme.colors.surface0 },
        content: { padding: compact ? 14 : 20, gap: compact ? 14 : 18, paddingBottom: 48 },
        headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
        title: { fontSize: 18, fontWeight: "700", color: theme.colors.foreground },
        subtitle: { fontSize: 11, color: theme.colors.foregroundMuted },
        buttonRow: { flexDirection: "row", gap: 6 },
        refreshButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.surface1 },
        refreshText: { fontSize: 12, color: theme.colors.foreground },
        tabRow: { gap: 6, paddingVertical: 2 },
        tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.surface1 },
        tabText: { fontSize: 12, color: theme.colors.foregroundMuted },
        tabActive: { backgroundColor: theme.colors.accent },
        tabTextActive: { color: theme.colors.accentForeground },
        pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
        pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: theme.colors.surface1 },
        pillText: { fontSize: 12, color: theme.colors.foregroundMuted },
        pillActive: { backgroundColor: theme.colors.accent },
        pillTextActive: { color: theme.colors.accentForeground },
        banner: { backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 10 },
        bannerText: { fontSize: 11, color: theme.colors.foregroundMuted },
        updateBanner: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 6,
        },
        updateText: { flex: 1, fontSize: 11, color: theme.colors.foreground, lineHeight: 16 },
        updateDismiss: { paddingHorizontal: 4, paddingVertical: 2 },
        updateDismissText: { fontSize: 12, color: theme.colors.foregroundMuted },
        cardRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
        card: { flexGrow: 1, minWidth: compact ? 104 : 150, backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 12, gap: 4 },
        cardLabel: { fontSize: 11, color: theme.colors.foregroundMuted },
        cardValue: { fontSize: compact ? 15 : 18, fontWeight: "700", color: theme.colors.foreground },
        section: { backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 12, gap: 10 },
        sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
        sectionTitle: { fontSize: 13, fontWeight: "600", color: theme.colors.foreground },
        modeRow: { flexDirection: "row", gap: 4 },
        modeButton: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: theme.colors.surface0 },
        modeButtonActive: { backgroundColor: theme.colors.accent },
        modeText: { fontSize: 10, color: theme.colors.foregroundMuted },
        modeTextActive: { color: theme.colors.accentForeground },
        agentRow: { gap: 6 },
        agentHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
        dot: { width: 8, height: 8, borderRadius: 4 },
        agentName: { fontSize: 12, color: theme.colors.foreground },
        agentNumbers: { fontSize: 11, color: theme.colors.foregroundMuted, flex: 1, textAlign: "right" },
        barTrack: { height: 6, borderRadius: 3, backgroundColor: theme.colors.surface0, overflow: "hidden", flexDirection: "row" },
        modelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
        modelName: { fontSize: 11, color: theme.colors.foreground, flex: 1 },
        modelValue: { fontSize: 11, color: theme.colors.foregroundMuted },
        legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
        legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
        legendText: { fontSize: 10, color: theme.colors.foregroundMuted },
        footer: { fontSize: 10, color: theme.colors.foregroundMuted },
        notesToggle: { fontSize: 11, color: theme.colors.foregroundMuted },
        notesList: { gap: 6 },
        notesText: { fontSize: 11, color: theme.colors.foregroundMuted, lineHeight: 16 },
      }) satisfies Record<string, ViewStyle | TextStyle>,
    [theme, compact],
  );

  const data = query.data;
  const totals = data?.totals;
  const totalTokens = totals ? totals.input + totals.output + totals.cacheRead + totals.cacheWrite : 0;
  const agents = data?.agents ?? [];
  const visibleAgents = agents;
  const maxAgentTokens = Math.max(1, ...visibleAgents.map((agent) => agent.totalTokens));
  const hasData = (totals?.requests ?? 0) > 0;
  const legendAgents = agents.filter((agent) => agent.totalTokens > 0);

  const deviceTabs = useMemo(() => {
    const list: Array<{ id: string; label: string }> = [{ id: "aggregate", label: t("origin.aggregate") }];
    for (const origin of data?.origins ?? []) {
      list.push({ id: origin.id, label: origin.id === "local" ? t("origin.local") : origin.label });
    }
    return list;
  }, [data?.origins, t]);
  const hasDevice = device === "aggregate" || (data?.origins ?? []).some((origin) => origin.id === device);
  const activeDevice = hasDevice ? device : "aggregate";
  const selectedOrigin = (data?.origins ?? []).find((origin) => origin.id === activeDevice) ?? null;
  const failedOrigins = (data?.origins ?? []).filter((origin) => origin.id !== "local" && origin.status === "error");

  const tabs = useMemo(() => {
    const list: Array<{ id: string; label: string }> = [{ id: "overview", label: t("tab.overview") }];
    const seen = new Set<string>();
    for (const agent of data?.agents ?? []) {
      list.push({ id: agent.id, label: agent.label });
      seen.add(agent.id);
    }
    return list;
  }, [data?.agents, t]);

  // Keep every hook above this early return; otherwise React throws #300
  // ("Rendered fewer hooks than expected") when toggling the settings view.
  if (showSettings) {
    return <ConfigScreen {...props} onBack={() => setShowSettings(false)} />;
  }

  const hasTab = tabs.some((item) => item.id === tab);
  const activeTab = hasTab ? tab : "overview";

  const cards: Array<{ label: string; value: string }> = [];
  if (totals && hasData) {
    cards.push({ label: t("card.totalTokens"), value: formatTokens(totalTokens) });
    cards.push({ label: t("card.requests"), value: `${totals.requests}` });
    cards.push({ label: t("card.cacheShare"), value: formatPercent(totals.cacheRead, totalTokens) });
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View style={{ gap: 2, flexShrink: 1 }}>
            <Text style={styles.title}>{t("app.title")}</Text>
            <Text style={styles.subtitle}>
              {data?.firstDay ? t("app.subtitleSince", { day: data.firstDay }) : t("app.subtitle")}
            </Text>
          </View>
          <View style={styles.buttonRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={t("app.a11yOpenConfig")} style={styles.refreshButton} onPress={() => setShowSettings(true)}>
              <Text style={styles.refreshText}>{t("app.config")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("app.a11yRefresh")}
              style={styles.refreshButton}
              onPress={() => {
                void refresh({}).then(() => query.refetch());
              }}
            >
              <Text style={styles.refreshText}>{query.isFetching ? t("app.refreshing") : t("app.refresh")}</Text>
            </Pressable>
          </View>
        </View>

        {updateQuery.data?.updateAvailable && !updateDismissed ? (
          <View style={styles.updateBanner}>
            <Text style={styles.updateText}>
              {t("update.available", { latest: updateQuery.data.latestVersion, current: updateQuery.data.currentVersion })}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("update.dismiss")}
              onPress={() => setUpdateDismissed(true)}
              style={styles.updateDismiss}
            >
              <Text style={styles.updateDismissText}>✕</Text>
            </Pressable>
          </View>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
          {deviceTabs.map((item) => {
            const active = item.id === activeDevice;
            return (
              <Pressable key={item.id} onPress={() => setDevice(item.id)} style={active ? [styles.tab, styles.tabActive] : styles.tab}>
                <Text style={active ? [styles.tabText, styles.tabTextActive] : styles.tabText}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
          {tabs.map((item) => {
            const active = item.id === activeTab;
            return (
              <Pressable key={item.id} onPress={() => setTab(item.id)} style={active ? [styles.tab, styles.tabActive] : styles.tab}>
                <Text style={active ? [styles.tabText, styles.tabTextActive] : styles.tabText}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.pillRow}>
          {ranges.map((item) => {
            const active = item.key === range;
            return (
              <Pressable
                key={item.key}
                onPress={() => {
                  setRange(item.key);
                  if (item.key === "custom" && (!customFrom || !customTo)) {
                    const defaults = defaultCustomRange();
                    setCustomFrom(defaults.from);
                    setCustomTo(defaults.to);
                  }
                }}
                style={active ? [styles.pill, styles.pillActive] : styles.pill}
              >
                <Text style={active ? [styles.pillText, styles.pillTextActive] : styles.pillText}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {range === "custom" ? (
          <DateRangePicker
            theme={theme}
            compact={compact}
            from={customFrom}
            to={customTo}
            onChange={(next) => {
              setCustomFrom(next.from);
              setCustomTo(next.to);
            }}
          />
        ) : null}

        {activeDevice !== "aggregate" && selectedOrigin ? (
          <Text style={styles.footer}>
            {selectedOrigin.label} · {originStatusText(t, selectedOrigin.status, selectedOrigin.lastPullAt)}
            {selectedOrigin.lastError ? ` · ${selectedOrigin.lastError}` : ""}
          </Text>
        ) : null}
        {activeDevice === "aggregate"
          ? failedOrigins.map((origin) => (
              <Text key={origin.id} style={styles.footer}>
                {t("origin.pullFailed", { label: origin.label, error: origin.lastError ?? "" })}
              </Text>
            ))
          : null}

        {data?.scanning ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              {t("scan.scanning", { done: data.scanDone, total: Math.max(data.scanTotal, 1) })}
              {data.firstDay ? "" : t("scan.firstHint")}
            </Text>
          </View>
        ) : null}
        {data?.scanError && !data.scanning ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{t("scan.error", { error: data.scanError })}</Text>
          </View>
        ) : null}

        {activeTab !== "overview" ? (
          <AgentTab agent={activeTab} range={range} origin={deviceOrigin} custom={customPayload} theme={theme} compact={compact} chartMode={chartMode} />
        ) : hasData ? (
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
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t("section.trend")}</Text>
                <View style={styles.modeRow}>
                  {chartModes.map((item) => {
                    const active = chartMode === item.key;
                    return (
                      <Pressable
                        key={item.key}
                        onPress={() => setChartMode(item.key)}
                        style={active ? [styles.modeButton, styles.modeButtonActive] : styles.modeButton}
                      >
                        <Text style={active ? [styles.modeText, styles.modeTextActive] : styles.modeText}>{item.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <TrendChart series={data?.series ?? []} theme={theme} compact={compact} mode={chartMode} />
              <View style={styles.legendRow}>
                {legendAgents.map((agent) => (
                  <View key={agent.id} style={styles.legendItem}>
                    <View style={[styles.dot, { backgroundColor: AGENT_COLORS[agent.id] ?? FALLBACK_COLOR }]} />
                    <Text style={styles.legendText}>{agent.label}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.footer}>{t("chart.hoverHint")}</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t("section.byAgent")}</Text>
              {visibleAgents.map((agent) => {
                const share = Math.max(1, Math.round((agent.totalTokens / maxAgentTokens) * 100));
                return (
                  <View key={agent.id} style={styles.agentRow}>
                    <View style={styles.agentHeader}>
                      <View style={[styles.dot, { backgroundColor: AGENT_COLORS[agent.id] ?? FALLBACK_COLOR }]} />
                      <Text style={styles.agentName}>{agent.label}</Text>
                      <Text style={styles.agentNumbers} numberOfLines={1}>
                        {formatTokens(agent.totalTokens)} tok · {t("unit.requests", { n: agent.requests })}
                        {agent.credits > 0 ? ` · ${t("unit.credits", { n: formatCredits(agent.credits) })}` : ""}
                      </Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={{ flex: share, backgroundColor: AGENT_COLORS[agent.id] ?? FALLBACK_COLOR }} />
                      {share < 100 ? <View style={{ flex: 100 - share }} /> : null}
                    </View>
                  </View>
                );
              })}
            </View>

            {(data?.models ?? []).length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t("section.models")}</Text>
                {(data?.models ?? [])
                  .slice(0, compact ? 6 : 10)
                  .map((model) => (
                    <View key={`${model.agent}-${model.model}`} style={styles.modelRow}>
                      <View style={[styles.dot, { backgroundColor: AGENT_COLORS[model.agent] ?? FALLBACK_COLOR }]} />
                      <Text style={styles.modelName} numberOfLines={1}>
                        {model.model}
                      </Text>
                      <Text style={styles.modelValue}>
                        {formatTokens(model.totalTokens)} tok
                        {model.credits > 0 ? ` · ${t("unit.creditsShort", { n: formatCredits(model.credits) })}` : ""}
                      </Text>
                    </View>
                  ))}
              </View>
            ) : null}

            {(data?.projects ?? []).length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t("section.projects")}</Text>
                {(data?.projects ?? [])
                  .slice(0, compact ? 5 : 8)
                  .map((project) => (
                    <View key={project.project || "unknown"} style={styles.modelRow}>
                      <Text style={styles.modelName} numberOfLines={1}>
                        {shortProject(project.project)}
                      </Text>
                      <Text style={styles.modelValue}>
                        {formatTokens(project.totalTokens)} tok
                        {project.credits > 0 ? ` · ${t("unit.creditsShort", { n: formatCredits(project.credits) })}` : ""}
                      </Text>
                    </View>
                  ))}
              </View>
            ) : null}

            <View style={styles.section}>
              <Pressable style={styles.sectionHeader} onPress={() => setShowNotes((value) => !value)}>
                <Text style={styles.sectionTitle}>{t("notes.title")}</Text>
                <Text style={styles.notesToggle}>{showNotes ? t("notes.collapse") : t("notes.expand")}</Text>
              </Pressable>
              {showNotes ? (
                <View style={styles.notesList}>
                  <Text style={styles.notesText}>
                    {t("notes.item1")}
                  </Text>
                  <Text style={styles.notesText}>
                    {t("notes.item2")}
                  </Text>
                  <Text style={styles.notesText}>
                    {t("notes.item3")}
                  </Text>
                  <Text style={styles.notesText}>
                    {t("notes.item4")}
                  </Text>
                  <Text style={styles.notesText}>{t("notes.item5")}</Text>
                </View>
              ) : (
                <Text style={styles.footer}>{t("notes.collapsedHint")}</Text>
              )}
            </View>
          </>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{data?.scanning ? t("empty.preparing") : t("empty.noData")}</Text>
            <Text style={styles.footer}>
              {data?.scanning ? t("empty.firstScan") : t("empty.none")}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
