import type { PluginClientContext } from "@getpaseo/plugin/client";
import { UsageScreen } from "./client/screen";
import { ConfigScreen } from "./client/config";
import { UsageSidebarItem } from "./client/sidebar";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addScreen({ id: "usage", title: "Agent 用量", Component: UsageScreen }),
    client.addSidebarFooterItem({ id: "usage", title: "用量", Component: UsageSidebarItem }),
    client.addSettingsScreen({ id: "config", title: "配置", icon: "Settings", Component: ConfigScreen }),
    client.addCommandCenterItem({
      id: "open-usage",
      title: "打开 Agent 用量",
      icon: "Activity",
      context: "global",
      keywords: ["usage", "用量", "token", "tokens", "积分"],
      onSelect(context) {
        context.openScreen({ screenId: "usage" });
      },
    }),
  ];
  return () => {
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {
        /* the host is tearing down already */
      }
    }
  };
}
