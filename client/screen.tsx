import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useMemo, useState } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { UsageGranularity, UsageRangeKey } from "../shared/usage";
import { ConfigScreen } from "./config";
import { Dashboard } from "./dashboard";
import { fromAgentReport, fromReport } from "./dashboard-data";
import { DateRangePicker } from "./date-range";
import { useAgentReport, usePrefs, useRefreshUsage, useUpdateCheck, useUsageReport } from "./data";
import { detectSystemLocale, useI18n, type Translate } from "./i18n";
import { MetricSwitch } from "./visuals";

const RANGE_KEYS: UsageRangeKey[] = ["24h", "today", "7d", "30d", "12w", "12m", "custom"];
const RANGE_LABEL_KEYS = ["range.24h", "range.today", "range.7d", "range.30d", "range.12w", "range.12m", "range.custom"] as const;
const GRANULARITY_KEYS: UsageGranularity[] = ["hour", "day", "week", "month"];
const GRANULARITY_LABEL_KEYS = ["granularity.hour", "granularity.day", "granularity.week", "granularity.month"] as const;

function defaultCustomRange(): { from: string; to: string } {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
  const key = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  return { from: key(start), to: key(today) };
}

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

export function UsageScreen(props: PluginScreenProps) {
  const { theme, layout } = props;
  const [range, setRange] = useState<UsageRangeKey | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [device, setDevice] = useState<string>("aggregate");
  const [tab, setTab] = useState<string>("overview");
  const [granularity, setGranularity] = useState<UsageGranularity | null>(null);
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [showNotes, setShowNotes] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const updateQuery = useUpdateCheck();
  const prefsQuery = usePrefs(detectSystemLocale());
  const deviceOrigin = device === "aggregate" ? undefined : device;
  const effectiveRange = range ?? prefsQuery.data?.defaultRange ?? "7d";
  const effectiveGranularity = granularity ?? prefsQuery.data?.defaultGranularity ?? "day";
  const customPayload = useMemo(() => {
    if (effectiveRange !== "custom" || !customFrom || !customTo) return undefined;
    return { from: customFrom, to: customTo };
  }, [effectiveRange, customFrom, customTo]);
  const query = useUsageReport(effectiveRange, deviceOrigin, customPayload, effectiveGranularity);
  const refreshUsage = useRefreshUsage();
  const { t } = useI18n();
  const localLabel = prefsQuery.data?.localAlias || t("origin.local");
  const ranges = useMemo(() => RANGE_KEYS.map((key, index) => ({ key, label: t(RANGE_LABEL_KEYS[index]) })), [t]);
  const granularities = useMemo(
    () => GRANULARITY_KEYS.map((key, index) => ({ value: key, label: t(GRANULARITY_LABEL_KEYS[index]) })),
    [t],
  );
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
        footer: { fontSize: 10, color: theme.colors.foregroundMuted, lineHeight: 15 },
        section: { backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 12, gap: 8 },
        sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
        sectionTitle: { fontSize: 12, fontWeight: "600", color: theme.colors.foreground },
        notesToggle: { fontSize: 11, color: theme.colors.foregroundMuted },
        notesText: { fontSize: 11, color: theme.colors.foregroundMuted, lineHeight: 16 },
        controlRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
        controlLabel: { fontSize: 10, color: theme.colors.foregroundMuted },
      }) satisfies Record<string, ViewStyle | TextStyle>,
    [theme, compact],
  );

  const data = query.data;
  const deviceTabs = useMemo(() => {
    const list: Array<{ id: string; label: string }> = [{ id: "aggregate", label: t("origin.aggregate") }];
    for (const origin of data?.origins ?? []) {
      list.push({ id: origin.id, label: origin.id === "local" ? localLabel : origin.label });
    }
    return list;
  }, [data?.origins, t, localLabel]);
  const hasDevice = device === "aggregate" || (data?.origins ?? []).some((origin) => origin.id === device);
  const activeDevice = hasDevice ? device : "aggregate";
  const selectedOrigin = (data?.origins ?? []).find((origin) => origin.id === activeDevice) ?? null;
  const failedOrigins = (data?.origins ?? []).filter((origin) => origin.id !== "local" && origin.status === "error");

  const tabs = useMemo(() => {
    const list: Array<{ id: string; label: string }> = [{ id: "overview", label: t("tab.overview") }];
    for (const agent of data?.agents ?? []) {
      list.push({ id: agent.id, label: agent.label });
    }
    return list;
  }, [data?.agents, t]);
  const hasTab = tabs.some((item) => item.id === tab);
  const activeTab = hasTab ? tab : "overview";
  const agentQuery = useAgentReport(activeTab === "overview" ? "claude" : activeTab, effectiveRange, activeTab !== "overview", deviceOrigin, customPayload, effectiveGranularity);
  const dashboardData = activeTab === "overview" ? (data ? fromReport(data) : null) : agentQuery.data ? fromAgentReport(agentQuery.data) : null;

  if (showSettings) {
    return <ConfigScreen {...props} onBack={() => setShowSettings(false)} />;
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View style={{ gap: 2, flexShrink: 1 }}>
            <Text style={styles.title}>{t("app.title")}</Text>
            <Text style={styles.subtitle}>{data?.firstDay ? t("app.subtitleSince", { day: data.firstDay }) : t("app.subtitle")}</Text>
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
                void refreshUsage({}).then(() => {
                  void query.refetch();
                  void agentQuery.refetch();
                });
              }}
            >
              <Text style={styles.refreshText}>{query.isFetching ? t("app.refreshing") : t("app.refresh")}</Text>
            </Pressable>
          </View>
        </View>

        {updateQuery.data?.updateAvailable && !updateDismissed ? (
          <View style={styles.updateBanner}>
            <Text style={styles.updateText}>{t("update.available", { latest: updateQuery.data.latestVersion, current: updateQuery.data.currentVersion })}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t("update.dismiss")} onPress={() => setUpdateDismissed(true)} style={styles.updateDismiss}>
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
            const active = item.key === effectiveRange;
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

        <View style={styles.controlRow}>
          <Text style={styles.controlLabel}>{t("chart.granularity")}</Text>
          <MetricSwitch theme={theme} value={effectiveGranularity} options={granularities} onChange={setGranularity} />
        </View>

        {effectiveRange === "custom" ? (
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

        {dashboardData ? (
          <Dashboard data={dashboardData} scope={activeTab === "overview" ? "aggregate" : "agent"} theme={theme} compact={compact} />
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{activeTab === "overview" ? (data?.scanning ? t("empty.preparing") : t("empty.noData")) : t("common.loading")}</Text>
            <Text style={styles.footer}>{activeTab === "overview" ? (data?.scanning ? t("empty.firstScan") : t("empty.none")) : ""}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Pressable style={styles.sectionHeader} onPress={() => setShowNotes((value) => !value)}>
            <Text style={styles.sectionTitle}>{t("notes.title")}</Text>
            <Text style={styles.notesToggle}>{showNotes ? t("notes.collapse") : t("notes.expand")}</Text>
          </Pressable>
          {showNotes ? (
            <View style={{ gap: 6 }}>
              <Text style={styles.notesText}>{t("notes.item1")}</Text>
              <Text style={styles.notesText}>{t("notes.item2")}</Text>
              <Text style={styles.notesText}>{t("notes.item3")}</Text>
              <Text style={styles.notesText}>{t("notes.item4")}</Text>
              <Text style={styles.notesText}>{t("notes.item5")}</Text>
            </View>
          ) : (
            <Text style={styles.footer}>{t("notes.collapsedHint")}</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}