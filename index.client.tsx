import type { PluginClientContext } from "@getpaseo/plugin/client";
import { UsageScreen } from "./client/screen";
import { ConfigScreen } from "./client/config";
import { UsageSidebarItem } from "./client/sidebar";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addScreen({ id: "usage", title: "Agent Usage", Component: UsageScreen }),
    client.addSidebarFooterItem({ id: "usage", title: "Agent Usage", Component: UsageSidebarItem }),
    client.addSettingsScreen({ id: "config", title: "Settings", icon: "Settings", Component: ConfigScreen }),
    client.addCommandCenterItem({
      id: "open-usage",
      title: "Open Agent Usage",
      icon: "Activity",
      context: "global",
      keywords: ["usage", "用量", "token", "tokens", "积分", "agent usage"],
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
