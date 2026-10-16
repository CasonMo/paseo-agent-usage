import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useMemo, useState } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { UsageRangeKey } from "../shared/usage";
import { AgentTab } from "./agent-tab";
import { ConfigScreen } from "./config";
import { DateRangePicker } from "./date-range";
import { AGENT_COLORS, FALLBACK_COLOR, TrendChart, type ChartMode } from "./charts";
import { useRefreshUsage, useUsageReport } from "./data";
import { formatCredits, formatPercent, formatTokens, shortProject } from "./format";

function originStatusText(status: string, lastPullAt: number | null): string {
  if (status === "pulling") return "拉取中…";
  if (status === "error") return "拉取失败";
  if (status === "never") return "未拉取";
  if (lastPullAt) {
    const date = new Date(lastPullAt);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `已同步 ${hours}:${minutes}`;
  }
  return "正常";
}

const RANGES: Array<{ key: UsageRangeKey; label: string }> = [
  { key: "today", label: "今日" },
  { key: "7d", label: "近 7 天" },
  { key: "30d", label: "近 30 天" },
  { key: "12w", label: "近 12 周" },
  { key: "12m", label: "近 12 月" },
  { key: "custom", label: "自定义" },
];

function defaultCustomRange(): { from: string; to: string } {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
  const key = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  return { from: key(start), to: key(today) };
}

const CHART_MODES: Array<{ key: ChartMode; label: string }> = [
  { key: "bar", label: "柱状图" },
  { key: "line", label: "折线图" },
];

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
  const deviceOrigin = device === "aggregate" ? undefined : device;
  const customPayload = useMemo(() => {
    if (range !== "custom" || !customFrom || !customTo) return undefined;
    return { from: customFrom, to: customTo };
  }, [range, customFrom, customTo]);
  const query = useUsageReport(range, deviceOrigin, customPayload);
  const refresh = useRefreshUsage();
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
    const list: Array<{ id: string; label: string }> = [{ id: "aggregate", label: "聚合" }];
    for (const origin of data?.origins ?? []) {
      list.push({ id: origin.id, label: origin.id === "local" ? "本机" : origin.label });
    }
    return list;
  }, [data?.origins]);
  const hasDevice = device === "aggregate" || (data?.origins ?? []).some((origin) => origin.id === device);
  const activeDevice = hasDevice ? device : "aggregate";
  const selectedOrigin = (data?.origins ?? []).find((origin) => origin.id === activeDevice) ?? null;
  const failedOrigins = (data?.origins ?? []).filter((origin) => origin.id !== "local" && origin.status === "error");

  const tabs = useMemo(() => {
    const list: Array<{ id: string; label: string }> = [{ id: "overview", label: "总览" }];
    const seen = new Set<string>();
    for (const agent of data?.agents ?? []) {
      list.push({ id: agent.id, label: agent.label });
      seen.add(agent.id);
    }
    return list;
  }, [data?.agents]);

  // Keep every hook above this early return; otherwise React throws #300
  // ("Rendered fewer hooks than expected") when toggling the settings view.
  if (showSettings) {
    return <ConfigScreen {...props} onBack={() => setShowSettings(false)} />;
  }

  const hasTab = tabs.some((item) => item.id === tab);
  const activeTab = hasTab ? tab : "overview";

  const cards: Array<{ label: string; value: string }> = [];
  if (totals && hasData) {
    cards.push({ label: "总 Tokens", value: formatTokens(totalTokens) });
    cards.push({ label: "请求数", value: `${totals.requests}` });
    cards.push({ label: "缓存读取占比", value: formatPercent(totals.cacheRead, totalTokens) });
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View style={{ gap: 2, flexShrink: 1 }}>
            <Text style={styles.title}>Agent 用量</Text>
            <Text style={styles.subtitle}>
              {data?.firstDay ? `数据自 ${data.firstDay} 起 · 基于本地会话日志` : "基于本地会话日志统计"}
            </Text>
          </View>
          <View style={styles.buttonRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="打开配置" style={styles.refreshButton} onPress={() => setShowSettings(true)}>
              <Text style={styles.refreshText}>配置</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="刷新用量"
              style={styles.refreshButton}
              onPress={() => {
                void refresh({}).then(() => query.refetch());
              }}
            >
              <Text style={styles.refreshText}>{query.isFetching ? "刷新中…" : "刷新"}</Text>
            </Pressable>
          </View>
        </View>

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
          {RANGES.map((item) => {
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
            {selectedOrigin.label} · {originStatusText(selectedOrigin.status, selectedOrigin.lastPullAt)}
            {selectedOrigin.lastError ? ` · ${selectedOrigin.lastError}` : ""}
          </Text>
        ) : null}
        {activeDevice === "aggregate"
          ? failedOrigins.map((origin) => (
              <Text key={origin.id} style={styles.footer}>
                {origin.label} 拉取失败：{origin.lastError}
              </Text>
            ))
          : null}

        {data?.scanning ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              正在扫描本地日志 {data.scanDone}/{Math.max(data.scanTotal, 1)}
              {data.firstDay ? "" : "（首次扫描，Codex 历史日志较大，可能需要一会儿）"}
            </Text>
          </View>
        ) : null}
        {data?.scanError && !data.scanning ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>上次扫描出错：{data.scanError}</Text>
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
                <Text style={styles.sectionTitle}>趋势</Text>
                <View style={styles.modeRow}>
                  {CHART_MODES.map((item) => {
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
              <Text style={styles.footer}>悬浮（或点按）图表查看当期明细。</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>按 Agent</Text>
              {visibleAgents.map((agent) => {
                const share = Math.max(1, Math.round((agent.totalTokens / maxAgentTokens) * 100));
                return (
                  <View key={agent.id} style={styles.agentRow}>
                    <View style={styles.agentHeader}>
                      <View style={[styles.dot, { backgroundColor: AGENT_COLORS[agent.id] ?? FALLBACK_COLOR }]} />
                      <Text style={styles.agentName}>{agent.label}</Text>
                      <Text style={styles.agentNumbers} numberOfLines={1}>
                        {formatTokens(agent.totalTokens)} tok · {agent.requests} 次
                        {agent.credits > 0 ? ` · ${formatCredits(agent.credits)} 积分` : ""}
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
                <Text style={styles.sectionTitle}>模型明细</Text>
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
                        {model.credits > 0 ? ` · ${formatCredits(model.credits)} 分` : ""}
                      </Text>
                    </View>
                  ))}
              </View>
            ) : null}

            {(data?.projects ?? []).length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>项目明细</Text>
                {(data?.projects ?? [])
                  .slice(0, compact ? 5 : 8)
                  .map((project) => (
                    <View key={project.project || "unknown"} style={styles.modelRow}>
                      <Text style={styles.modelName} numberOfLines={1}>
                        {shortProject(project.project)}
                      </Text>
                      <Text style={styles.modelValue}>
                        {formatTokens(project.totalTokens)} tok
                        {project.credits > 0 ? ` · ${formatCredits(project.credits)} 分` : ""}
                      </Text>
                    </View>
                  ))}
              </View>
            ) : null}

            <View style={styles.section}>
              <Pressable style={styles.sectionHeader} onPress={() => setShowNotes((value) => !value)}>
                <Text style={styles.sectionTitle}>统计口径与已知差异</Text>
                <Text style={styles.notesToggle}>{showNotes ? "收起" : "展开"}</Text>
              </Pressable>
              {showNotes ? (
                <View style={styles.notesList}>
                  <Text style={styles.notesText}>
                    · 本插件仅统计本地（及远端）会话日志；CC Switch 等代理工具还会记录「代理层」流量，口径天然不同。
                  </Text>
                  <Text style={styles.notesText}>
                    · Codex 少量「一次性 App Server 线程」请求不写入任何本地日志（仅代理可见），本插件无法统计；量级通常小于 0.1%。
                  </Text>
                  <Text style={styles.notesText}>
                    · 请求数：CC Switch 的请求数包含其自身探针、限流与失败请求，通常略高；对比时建议以 token 总量为准。
                  </Text>
                  <Text style={styles.notesText}>
                    · 历史差异：源端清理过的记录（如 Claude Code 约 30 天自动清理）无法补回；本插件也会统计部分 CC Switch 不扫描的内容（Pi forks/子会话、Codex fork 恢复事件），个别数字可能更大。
                  </Text>
                  <Text style={styles.notesText}>以上均为数据源结构差异，不是统计误差。</Text>
                </View>
              ) : (
                <Text style={styles.footer}>与 CC Switch 对比时存在少量口径差异，展开查看原因。</Text>
              )}
            </View>
          </>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{data?.scanning ? "正在准备数据…" : "暂无数据"}</Text>
            <Text style={styles.footer}>
              {data?.scanning ? "首次扫描完成后，这里会显示统计。" : "未找到本地会话日志，或所选设备范围内没有用量。"}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
