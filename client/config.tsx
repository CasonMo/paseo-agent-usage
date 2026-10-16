import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useAgentsConfig, usePrefs, useSetAgentsConfig, useSetPrefs } from "./data";
import { detectSystemLocale, setLanguageMode, useI18n, type LanguageMode } from "./i18n";
import { HostsManager } from "./settings";

type Theme = PluginSurfaceProps["theme"];

const PREFS_QUERY_KEY = ["agent-usage-prefs"];

function GeneralSection({ theme, compact }: { theme: Theme; compact: boolean }) {
  const { t } = useI18n();
  const prefsQuery = usePrefs(detectSystemLocale());
  const setCall = useSetPrefs();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const styles = useMemo(
    () =>
      ({
        section: { backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 12, gap: 10 },
        sectionTitle: { fontSize: 13, fontWeight: "600", color: theme.colors.foreground },
        field: { gap: 6 },
        fieldLabel: { fontSize: 11, color: theme.colors.foregroundMuted },
        hint: { fontSize: 10, color: theme.colors.foregroundMuted },
        chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
        chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: theme.colors.surface0 },
        chipActive: { backgroundColor: theme.colors.accent },
        chipText: { fontSize: 11, color: theme.colors.foregroundMuted },
        chipTextActive: { color: theme.colors.accentForeground },
        errorText: { fontSize: 11, color: theme.colors.statusDanger },
      }) satisfies Record<string, ViewStyle | TextStyle>,
    [theme, compact],
  );

  const current = prefsQuery.data ?? { language: "auto" as LanguageMode, refreshMinutes: 30 };
  const languageOptions: Array<{ value: LanguageMode; label: string }> = [
    { value: "auto", label: t("config.language.system") },
    { value: "zh", label: "中文" },
    { value: "en", label: "English" },
  ];
  const refreshOptions = useMemo(
    () => [
      { minutes: 0, label: t("config.refresh.off") },
      { minutes: 5, label: t("config.refresh.5") },
      { minutes: 15, label: t("config.refresh.15") },
      { minutes: 30, label: t("config.refresh.30") },
      { minutes: 60, label: t("config.refresh.60") },
      { minutes: 360, label: t("config.refresh.360") },
      { minutes: 1440, label: t("config.refresh.1440") },
    ],
    [t],
  );

  const save = async (next: { language: LanguageMode; refreshMinutes: number }) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await setCall(next);
      if (result.saved) {
        queryClient.setQueryData(PREFS_QUERY_KEY, next);
        setLanguageMode(next.language);
      } else {
        setMessage(result.error ?? t("common.saveFailed"));
      }
    } catch (error) {
      setMessage(t("common.saveFailedDetail", { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t("config.general")}</Text>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{t("config.language")}</Text>
        <View style={styles.chipRow}>
          {languageOptions.map((item) => {
            const active = current.language === item.value;
            return (
              <Pressable
                key={item.value}
                disabled={busy}
                onPress={() => void save({ language: item.value, refreshMinutes: current.refreshMinutes })}
                style={active ? [styles.chip, styles.chipActive] : styles.chip}
              >
                <Text style={active ? [styles.chipText, styles.chipTextActive] : styles.chipText}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{t("config.autoRefresh")}</Text>
        <Text style={styles.hint}>{t("config.autoRefreshHint")}</Text>
        <View style={styles.chipRow}>
          {refreshOptions.map((item) => {
            const active = current.refreshMinutes === item.minutes;
            return (
              <Pressable
                key={item.minutes}
                disabled={busy}
                onPress={() => void save({ language: current.language, refreshMinutes: item.minutes })}
                style={active ? [styles.chip, styles.chipActive] : styles.chip}
              >
                <Text style={active ? [styles.chipText, styles.chipTextActive] : styles.chipText}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {message ? <Text style={styles.errorText}>{message}</Text> : null}
    </View>
  );
}

function AgentsSection({ theme, compact }: { theme: Theme; compact: boolean }) {
  const query = useAgentsConfig();
  const setCall = useSetAgentsConfig();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const styles = useMemo(
    () =>
      ({
        section: { backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 12, gap: 10 },
        sectionTitle: { fontSize: 13, fontWeight: "600", color: theme.colors.foreground },
        hint: { fontSize: 10, color: theme.colors.foregroundMuted },
        row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
        rowName: { fontSize: 12, color: theme.colors.foreground },
        errorText: { fontSize: 11, color: theme.colors.statusDanger },
      }) satisfies Record<string, ViewStyle | TextStyle>,
    [theme, compact],
  );

  const agents = query.data?.agents ?? [];
  const toggle = async (id: string, enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = agents.map((agent) => (agent.id === id ? { ...agent, enabled } : agent));
      const result = await setCall({ agents: next.map(({ id: agentId, enabled: value }) => ({ id: agentId, enabled: value })) });
      if (result.saved) {
        queryClient.setQueryData(["agent-usage-agents"], { agents: next });
        void queryClient.invalidateQueries({ queryKey: ["agent-usage"] });
      } else {
        setMessage(result.error ?? t("common.saveFailed"));
      }
    } catch (error) {
      setMessage(t("common.saveFailedDetail", { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t("config.agents")}</Text>
      <Text style={styles.hint}>{t("config.agentsHint")}</Text>
      {query.isLoading ? <Text style={styles.hint}>{t("common.loading")}</Text> : null}
      {agents.map((agent) => (
        <View key={agent.id} style={styles.row}>
          <Text style={styles.rowName}>{agent.label}</Text>
          <Switch value={agent.enabled} disabled={busy} onValueChange={(value) => void toggle(agent.id, value)} />
        </View>
      ))}
      {message ? <Text style={styles.errorText}>{message}</Text> : null}
    </View>
  );
}

export function ConfigScreen({ theme, layout, onBack }: PluginSurfaceProps & { onBack?: () => void }) {
  const compact = layout.compact;
  const { t } = useI18n();
  const styles = useMemo(
    () =>
      ({
        screen: { flex: 1, backgroundColor: theme.colors.surface0 },
        content: { padding: compact ? 14 : 20, gap: compact ? 14 : 16, paddingBottom: 48 },
        headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
        backButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.surface1 },
        backText: { fontSize: 12, color: theme.colors.foreground },
        title: { fontSize: 17, fontWeight: "700", color: theme.colors.foreground, flex: 1 },
      }) satisfies Record<string, ViewStyle | TextStyle>,
    [theme, compact],
  );

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          {onBack ? (
            <Pressable accessibilityRole="button" onPress={onBack} style={styles.backButton}>
              <Text style={styles.backText}>{t("common.back")}</Text>
            </Pressable>
          ) : null}
          <Text style={styles.title}>{t("config.title")}</Text>
        </View>
        <GeneralSection theme={theme} compact={compact} />
        <AgentsSection theme={theme} compact={compact} />
        <HostsManager theme={theme} compact={compact} />
      </ScrollView>
    </View>
  );
}
