import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
import { useUsageReport } from "./data";
import { formatTokens } from "./format";
import { AGENT_USAGE_ICON } from "./icons";

export function UsageSidebarItem({ currentScreen, openScreen, theme }: PluginSidebarItemProps) {
  const query = useUsageReport("today");
  const totals = query.data?.totals;
  const tokens = totals ? totals.input + totals.output + totals.cacheRead + totals.cacheWrite : 0;
  const trailing: string | null = tokens > 0 ? formatTokens(tokens) : null;
  return (
    <SidebarRow
      icon={{ svg: AGENT_USAGE_ICON }}
      label="Agent Usage"
      active={currentScreen?.screenId === "usage"}
      trailing={trailing ? <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>{trailing}</Text> : undefined}
      onPress={() => openScreen({ screenId: "usage" })}
    />
  );
}
