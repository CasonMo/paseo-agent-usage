import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useAgentsConfig, useSetAgentsConfig } from "./data";
import { HostsManager } from "./settings";

type Theme = PluginSurfaceProps["theme"];

function AgentsSection({ theme, compact }: { theme: Theme; compact: boolean }) {
  const query = useAgentsConfig();
  const setCall = useSetAgentsConfig();
  const queryClient = useQueryClient();
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
        setMessage(result.error ?? "保存失败");
      }
    } catch (error) {
      setMessage(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Agent 开关</Text>
      <Text style={styles.hint}>关闭的 Agent 不展示、不拉取。</Text>
      {query.isLoading ? <Text style={styles.hint}>加载中…</Text> : null}
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
              <Text style={styles.backText}>← 返回</Text>
            </Pressable>
          ) : null}
          <Text style={styles.title}>配置</Text>
        </View>
        <AgentsSection theme={theme} compact={compact} />
        <HostsManager theme={theme} compact={compact} />
      </ScrollView>
    </View>
  );
}
