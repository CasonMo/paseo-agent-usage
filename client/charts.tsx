import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Fragment, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { UsageGranularity, UsageSeriesPoint } from "../shared/usage";
import { formatCredits, formatTokens } from "./format";
import { useI18n } from "./i18n";

export type ChartMode = "bar" | "line";
export type ChartMetric = "tokens" | "credits";

export const GRANULARITY_KEYS: UsageGranularity[] = ["hour", "day", "week", "month"];
export const GRANULARITY_LABEL_KEYS = ["granularity.hour", "granularity.day", "granularity.week", "granularity.month"] as const;

export const AGENT_ORDER = ["claude", "codex", "opencode", "pi"];
export const AGENT_COLORS: Record<string, string> = {
  claude: "#E5764B",
  codex: "#4C8DFF",
  opencode: "#2BB673",
  pi: "#9B6EF3",
};
export const AGENT_SHORT: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "Pi",
};
export const FALLBACK_COLOR = "#8A94A6";

type Theme = PluginScreenProps["theme"];

function indexOfAgent(id: string): number {
  const index = AGENT_ORDER.indexOf(id);
  return index === -1 ? AGENT_ORDER.length : index;
}

function orderedEntries(byAgent: Record<string, number>): Array<[string, number]> {
  const entries = Object.entries(byAgent).filter(([, value]) => value > 0);
  entries.sort((a, b) => indexOfAgent(a[0]) - indexOfAgent(b[0]));
  return entries;
}

function Tooltip({ point, theme, metric }: { point: UsageSeriesPoint; theme: Theme; metric: ChartMetric }) {
  const { t } = useI18n();
  const entries = metric === "tokens" ? orderedEntries(point.byAgent) : [];
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, alignItems: "center", zIndex: 10 }}>
      <View
        style={{
          backgroundColor: theme.colors.surface0,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
          gap: 3,
          minWidth: 150,
        }}
      >
        <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{point.full}</Text>
        {metric === "credits" ? (
          <Text style={{ fontSize: 12, fontWeight: "700", color: theme.colors.foreground }}>{t("unit.credits", { n: formatCredits(point.credits) })}</Text>
        ) : (
          <Text style={{ fontSize: 12, fontWeight: "700", color: theme.colors.foreground }}>
            {formatTokens(point.totalTokens)} tok{point.credits > 0 ? ` · ${t("unit.credits", { n: formatCredits(point.credits) })}` : ""}
          </Text>
        )}
        {entries.map(([agent, value]) => (
          <View key={agent} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: AGENT_COLORS[agent] ?? FALLBACK_COLOR }} />
            <Text style={{ fontSize: 10, color: theme.colors.foreground, flex: 1 }}>{AGENT_SHORT[agent] ?? agent}</Text>
            <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{formatTokens(value)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function BarLayer({
  points,
  max,
  height,
  gap,
  theme,
  activeIndex,
  metric,
  singleAgent,
}: {
  points: UsageSeriesPoint[];
  max: number;
  height: number;
  gap: number;
  theme: Theme;
  activeIndex: number | null;
  metric: ChartMetric;
  singleAgent: string | null;
}) {
  const valueOf = (point: UsageSeriesPoint) => (metric === "credits" ? point.credits : point.totalTokens);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap, height }}>
      {points.map((point, index) => {
        const total = valueOf(point);
        const columnHeight = total <= 0 ? 2 : Math.max(3, Math.round((total / max) * height));
        const entries: Array<[string, number]> =
          total <= 0 ? [] : metric === "credits" && singleAgent ? [[singleAgent, total]] : orderedEntries(point.byAgent);
        const dim = activeIndex !== null && activeIndex !== index;
        return (
          <View key={point.key} style={{ flex: 1, height, justifyContent: "flex-end", opacity: dim ? 0.45 : 1 }}>
            <View style={{ height: columnHeight, borderRadius: 3, overflow: "hidden", backgroundColor: theme.colors.surface2 }}>
              {entries.map(([agent, value]) => (
                <View
                  key={agent}
                  style={{
                    height: Math.max(1, Math.round((value / total) * columnHeight)),
                    backgroundColor: AGENT_COLORS[agent] ?? FALLBACK_COLOR,
                  }}
                />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function LineLayer({
  points,
  max,
  height,
  width,
  theme,
  activeIndex,
  metric,
  singleAgent,
}: {
  points: UsageSeriesPoint[];
  max: number;
  height: number;
  width: number;
  theme: Theme;
  activeIndex: number | null;
  metric: ChartMetric;
  singleAgent: string | null;
}) {
  const marginX = 8;
  const padTop = 10;
  const padBottom = 10;
  const innerWidth = Math.max(1, width - marginX * 2);
  const innerHeight = Math.max(1, height - padTop - padBottom);
  if (points.length === 0) return <View style={{ height }} />;
  const valueOf = (point: UsageSeriesPoint) => (metric === "credits" ? point.credits : point.totalTokens);
  const xOf = (index: number) => (points.length <= 1 ? marginX + innerWidth / 2 : marginX + (index * innerWidth) / (points.length - 1));
  const yOf = (value: number) => padTop + innerHeight - (value <= 0 ? 0 : (value / max) * innerHeight);
  const allAgents = new Set<string>();
  if (singleAgent) {
    if (points.some((point) => valueOf(point) > 0)) allAgents.add(singleAgent);
  } else {
    for (const point of points) {
      for (const [agent, value] of Object.entries(point.byAgent)) {
        if (value > 0) allAgents.add(agent);
      }
    }
  }
  const agents = [...allAgents].sort((a, b) => indexOfAgent(a) - indexOfAgent(b));
  const valuesOf = (agent: string) => (singleAgent ? points.map(valueOf) : points.map((point) => point.byAgent[agent] ?? 0));
  return (
    <View style={{ height }}>
      {width > 40 ? (
        <>
          <View style={{ position: "absolute", left: marginX, right: marginX, top: padTop + innerHeight, height: 1, backgroundColor: theme.colors.border }} />
          {activeIndex !== null ? (
            <View
              style={{
                position: "absolute",
                left: Math.round(xOf(activeIndex)) - 1,
                top: padTop,
                width: 1,
                height: innerHeight + 1,
                backgroundColor: theme.colors.border,
              }}
            />
          ) : null}
          {agents.map((agent) => {
            const color = AGENT_COLORS[agent] ?? FALLBACK_COLOR;
            const values = valuesOf(agent);
            const segments = [];
            if (points.length === 1) {
              segments.push(
                <View
                  key={`${agent}-single`}
                  style={{ position: "absolute", left: xOf(0) - 2, top: yOf(values[0] ?? 0) - 2, width: 4, height: 4, borderRadius: 2, backgroundColor: color }}
                />,
              );
            }
            for (let index = 0; index < points.length - 1; index += 1) {
              const x1 = xOf(index);
              const y1 = yOf(values[index] ?? 0);
              const x2 = xOf(index + 1);
              const y2 = yOf(values[index + 1] ?? 0);
              const dx = x2 - x1;
              const dy = y2 - y1;
              const length = Math.sqrt(dx * dx + dy * dy);
              const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
              segments.push(
                <View
                  key={`${agent}-${index}`}
                  style={{
                    position: "absolute",
                    left: x1 + dx / 2 - length / 2,
                    top: y1 + dy / 2 - 1,
                    width: length,
                    height: 2,
                    borderRadius: 1,
                    backgroundColor: color,
                    transform: [{ rotate: `${angle}deg` }],
                  }}
                />,
              );
            }
            return <Fragment key={agent}>{segments}</Fragment>;
          })}
          {activeIndex !== null
            ? agents.map((agent) => {
                const color = AGENT_COLORS[agent] ?? FALLBACK_COLOR;
                const value = singleAgent ? valueOf(points[activeIndex] as UsageSeriesPoint) : points[activeIndex]?.byAgent[agent] ?? 0;
                return (
                  <View
                    key={`active-${agent}`}
                    style={{
                      position: "absolute",
                      left: xOf(activeIndex) - 3,
                      top: yOf(value) - 3,
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: color,
                      borderWidth: 1,
                      borderColor: theme.colors.surface0,
                    }}
                  />
                );
              })
            : null}
        </>
      ) : null}
    </View>
  );
}

export function TrendChart({
  series,
  theme,
  compact,
  mode,
  metric = "tokens",
  singleAgent = null,
}: {
  series: UsageSeriesPoint[];
  theme: Theme;
  compact: boolean;
  mode: ChartMode;
  metric?: ChartMetric;
  singleAgent?: string | null;
}) {
  const { t } = useI18n();
  const [active, setActive] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const points = compact && series.length > 12 ? series.slice(-12) : series;
  const valueOf = (point: UsageSeriesPoint) => (metric === "credits" ? point.credits : point.totalTokens);
  const max = Math.max(1, ...points.map(valueOf));
  const height = compact ? 96 : 140;
  const activeIndex = active !== null && active < points.length ? active : null;
  const labelStep = Math.max(1, Math.ceil(points.length / 12));
  const crowded = points.length > 14;
  // With many points a 3px gap (and per-point label cells) no longer fits:
  // flex would squeeze every bar below zero width. Drop the gap and render
  // labels as absolutely centered texts so dense ranges still draw as columns.
  const barGap = points.length * 4 <= width ? 3 : 0;
  const rowGap = mode === "bar" ? barGap : 3;
  const hoverProps = (index: number) => ({
    onHoverIn: () => setActive(index),
    onHoverOut: () => setActive((current) => (current === index ? null : current)),
    onPress: () => setActive((current) => (current === index ? null : index)),
  });
  return (
    <View>
      <View style={{ position: "relative" }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {mode === "bar" ? (
          <BarLayer points={points} max={max} height={height} gap={barGap} theme={theme} activeIndex={activeIndex} metric={metric} singleAgent={singleAgent} />
        ) : (
          <LineLayer points={points} max={max} height={height} width={width} theme={theme} activeIndex={activeIndex} metric={metric} singleAgent={singleAgent} />
        )}
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, flexDirection: "row", gap: rowGap }}>
          {points.map((point, index) => (
            <Pressable key={point.key} style={{ flex: 1 }} accessibilityLabel={t("chart.pointA11y", { label: point.label })} {...hoverProps(index)} />
          ))}
        </View>
        {activeIndex !== null ? <Tooltip point={points[activeIndex] as UsageSeriesPoint} theme={theme} metric={metric} /> : null}
      </View>
      <View style={{ flexDirection: "row", gap: rowGap, marginTop: 6 }}>
        {points.map((point, index) => {
          const show = index % labelStep === 0 || index === points.length - 1;
          if (!show) return <View key={point.key} style={{ flex: 1, height: 12 }} />;
          return (
            <View key={point.key} style={crowded ? { flex: 1, height: 12 } : { flex: 1 }}>
              <Text
                numberOfLines={1}
                style={
                  crowded
                    ? { position: "absolute", left: -20, width: 40, fontSize: 9, textAlign: "center", color: theme.colors.foregroundMuted }
                    : { fontSize: 9, textAlign: "center", color: theme.colors.foregroundMuted }
                }
              >
                {point.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
