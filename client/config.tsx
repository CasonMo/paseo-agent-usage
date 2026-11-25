import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { estimateTokenCost, normalizeModelId } from "../shared/pricing";
import { DEFAULT_ARCHIVE_RETENTION_DAYS } from "../shared/usage";
import type { CustomModelPriceConfig, UsageGranularity, UsagePrefs, UsageRangeKey } from "../shared/usage";
import { PREFS_QUERY_KEY, useAgentsConfig, usePrefs, useSetAgentsConfig, useSetPrefs, useUsageReport } from "./data";
import { formatUsd } from "./format";
import { detectSystemLocale, setLanguageMode, useI18n, type DictKey, type LanguageMode } from "./i18n";
import { ISSUE_URL } from "./links";
import { HostsManager } from "./settings";

type Theme = PluginSurfaceProps["theme"];

type UsagePatch = Partial<
  Pick<
    UsagePrefs,
    "language" | "refreshMinutes" | "localAlias" | "defaultRange" | "defaultGranularity" | "monthlyBudgetUsd" | "archiveRetentionDays"
  >
>;

const DEFAULT_RANGE_OPTIONS: UsageRangeKey[] = ["24h", "today", "7d", "30d", "12w", "12m"];
const DEFAULT_GRANULARITY_OPTIONS: UsageGranularity[] = ["hour", "day", "week", "month"];
const RETENTION_OPTIONS: ReadonlyArray<{ days: number; key: DictKey }> = [
  { days: 30, key: "config.retention.30" },
  { days: 92, key: "config.retention.92" },
  { days: 180, key: "config.retention.180" },
  { days: 365, key: "config.retention.365" },
  { days: 0, key: "config.retention.0" },
];

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
        input: {
          borderRadius: 8,
          backgroundColor: theme.colors.surface0,
          paddingHorizontal: 10,
          paddingVertical: 6,
          fontSize: 12,
          color: theme.colors.foreground,
        },
        saveButton: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.accent },
        saveButtonText: { fontSize: 12, color: theme.colors.accentForeground },
        errorText: { fontSize: 11, color: theme.colors.statusDanger },
      }) satisfies Record<string, ViewStyle | TextStyle>,
    [theme, compact],
  );

  const current: UsagePrefs = prefsQuery.data ?? { language: "auto", refreshMinutes: 30, coCreateDismissed: false };
  const [aliasDraft, setAliasDraft] = useState("");
  const [budgetDraft, setBudgetDraft] = useState("");
  useEffect(() => {
    setAliasDraft(current.localAlias ?? "");
  }, [current.localAlias]);
  useEffect(() => {
    setBudgetDraft(current.monthlyBudgetUsd && current.monthlyBudgetUsd > 0 ? String(current.monthlyBudgetUsd) : "");
  }, [current.monthlyBudgetUsd]);
  const aliasDirty = aliasDraft.trim() !== (current.localAlias ?? "");
  const budgetDirty = budgetDraft.trim() !== (current.monthlyBudgetUsd && current.monthlyBudgetUsd > 0 ? String(current.monthlyBudgetUsd) : "");
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

  const save = async (patch: UsagePatch) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const latest = queryClient.getQueryData<UsagePrefs>(PREFS_QUERY_KEY) ?? prefsQuery.data;
    if (!latest) {
      setMessage(t("common.loading"));
      setBusy(false);
      return;
    }
    const next: UsagePrefs = { ...latest, language: patch.language ?? latest.language, refreshMinutes: patch.refreshMinutes ?? latest.refreshMinutes };
    const alias = patch.localAlias ?? latest.localAlias;
    if (alias) next.localAlias = alias;
    else delete next.localAlias;
    const defaultRange = patch.defaultRange ?? latest.defaultRange;
    if (defaultRange) next.defaultRange = defaultRange;
    else delete next.defaultRange;
    const defaultGranularity = patch.defaultGranularity ?? latest.defaultGranularity;
    if (defaultGranularity) next.defaultGranularity = defaultGranularity;
    else delete next.defaultGranularity;
    const budget = patch.monthlyBudgetUsd ?? latest.monthlyBudgetUsd;
    if (typeof budget === "number" && budget > 0) next.monthlyBudgetUsd = budget;
    else delete next.monthlyBudgetUsd;
    const retention = patch.archiveRetentionDays !== undefined ? patch.archiveRetentionDays : latest.archiveRetentionDays;
    if (typeof retention === "number" && Number.isFinite(retention)) next.archiveRetentionDays = retention;
    else delete next.archiveRetentionDays;
    try {
      const result = await setCall(next);
      if (result.saved) {
        queryClient.setQueryData(PREFS_QUERY_KEY, next);
        setLanguageMode(next.language);
        void queryClient.invalidateQueries({ queryKey: ["agent-usage"] });
        void queryClient.invalidateQueries({ queryKey: ["agent-usage-agent"] });
      } else {
        setMessage(result.error ?? t("common.saveFailed"));
      }
    } catch (error) {
      setMessage(t("common.saveFailedDetail", { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  };

  const saveAlias = () => {
    void save({ localAlias: aliasDraft.trim() });
  };

  const saveBudget = () => {
    const parsed = Number(budgetDraft.trim());
    void save({ monthlyBudgetUsd: Number.isFinite(parsed) && parsed > 0 ? parsed : 0 });
  };

  const activeRetention = current.archiveRetentionDays ?? DEFAULT_ARCHIVE_RETENTION_DAYS;

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
                onPress={() => void save({ language: item.value })}
                style={active ? [styles.chip, styles.chipActive] : styles.chip}
              >
                <Text style={active ? [styles.chipText, styles.chipTextActive] : styles.chipText}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{t("config.defaultRange")}</Text>
        <View style={styles.chipRow}>
          {DEFAULT_RANGE_OPTIONS.map((value) => {
            const active = (current.defaultRange ?? "7d") === value;
            return (
              <Pressable
                key={value}
                disabled={busy}
                onPress={() => void save({ defaultRange: value })}
                style={active ? [styles.chip, styles.chipActive] : styles.chip}
              >
                <Text style={active ? [styles.chipText, styles.chipTextActive] : styles.chipText}>{t(`range.${value}`)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{t("config.defaultGranularity")}</Text>
        <Text style={styles.hint}>{t("config.defaultHint")}</Text>
        <View style={styles.chipRow}>
          {DEFAULT_GRANULARITY_OPTIONS.map((value) => {
            const active = (current.defaultGranularity ?? "day") === value;
            return (
              <Pressable
                key={value}
                disabled={busy}
                onPress={() => void save({ defaultGranularity: value })}
                style={active ? [styles.chip, styles.chipActive] : styles.chip}
              >
                <Text style={active ? [styles.chipText, styles.chipTextActive] : styles.chipText}>{t(`granularity.${value}`)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{t("config.budget")}</Text>
        <Text style={styles.hint}>{t("config.budgetHint")}</Text>
        <TextInput
          value={budgetDraft}
          onChangeText={setBudgetDraft}
          placeholder={t("config.budgetPlaceholder")}
          placeholderTextColor={theme.colors.foregroundMuted}
          keyboardType="decimal-pad"
          style={styles.input}
        />
        {budgetDirty ? (
          <Pressable accessibilityRole="button" disabled={busy} onPress={saveBudget} style={styles.saveButton}>
            <Text style={styles.saveButtonText}>{busy ? t("common.saving") : t("common.save")}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{t("config.retention")}</Text>
        <Text style={styles.hint}>{t("config.retentionHint")}</Text>
        <View style={styles.chipRow}>
          {RETENTION_OPTIONS.map((item) => {
            const active = activeRetention === item.days;
            return (
              <Pressable
                key={item.days}
                disabled={busy}
                onPress={() => void save({ archiveRetentionDays: item.days })}
                style={active ? [styles.chip, styles.chipActive] : styles.chip}
              >
                <Text style={active ? [styles.chipText, styles.chipTextActive] : styles.chipText}>{t(item.key)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{t("config.localAlias", { default: current.localAlias || t("origin.local") })}</Text>
        <Text style={styles.hint}>{t("config.localAliasHint", { default: current.localAlias || t("origin.local") })}</Text>
        <TextInput
          value={aliasDraft}
          onChangeText={setAliasDraft}
          placeholder={current.localAlias || t("origin.local")}
          placeholderTextColor={theme.colors.foregroundMuted}
          maxLength={40}
          style={styles.input}
        />
        {aliasDirty ? (
          <Pressable accessibilityRole="button" disabled={busy} onPress={saveAlias} style={styles.saveButton}>
            <Text style={styles.saveButtonText}>{busy ? t("common.saving") : t("common.save")}</Text>
          </Pressable>
        ) : null}
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
                onPress={() => void save({ refreshMinutes: item.minutes })}
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

interface PriceDraft {
  originalModel: string | null;
  model: string;
  mapTo: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
}

function emptyPriceDraft(model = ""): PriceDraft {
  return { originalModel: null, model, mapTo: "", input: "", output: "", cacheRead: "", cacheWrite: "" };
}

function draftFromPrice(entry: CustomModelPriceConfig): PriceDraft {
  return {
    originalModel: entry.model,
    model: entry.model,
    mapTo: entry.mapTo ?? "",
    input: entry.input !== undefined ? String(entry.input) : "",
    output: entry.output !== undefined ? String(entry.output) : "",
    cacheRead: entry.cacheRead !== undefined ? String(entry.cacheRead) : "",
    cacheWrite: entry.cacheWrite !== undefined ? String(entry.cacheWrite) : "",
  };
}

function parseOptionalRate(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 && value <= 10_000 ? value : undefined;
}

function draftToCustomPrice(draft: PriceDraft): CustomModelPriceConfig | null {
  const model = draft.model.trim();
  if (!model) return null;
  const mapTo = draft.mapTo.trim();
  const input = parseOptionalRate(draft.input);
  const output = parseOptionalRate(draft.output);
  const cacheRead = parseOptionalRate(draft.cacheRead);
  const cacheWrite = parseOptionalRate(draft.cacheWrite);
  if (!mapTo && input === undefined && output === undefined && cacheRead === undefined && cacheWrite === undefined) {
    return null;
  }
  const entry: CustomModelPriceConfig = { model };
  if (mapTo) entry.mapTo = mapTo;
  if (input !== undefined) entry.input = input;
  if (output !== undefined) entry.output = output;
  if (cacheRead !== undefined) entry.cacheRead = cacheRead;
  if (cacheWrite !== undefined) entry.cacheWrite = cacheWrite;
  return entry;
}

function formatPriceRuleSummary(entry: CustomModelPriceConfig): string {
  const parts: string[] = [];
  if (entry.mapTo) parts.push(`-> ${entry.mapTo}`);
  if (entry.input !== undefined) parts.push(`in $${entry.input}`);
  if (entry.output !== undefined) parts.push(`out $${entry.output}`);
  if (entry.cacheRead !== undefined) parts.push(`read $${entry.cacheRead}`);
  if (entry.cacheWrite !== undefined) parts.push(`write $${entry.cacheWrite}`);
  return `${parts.join(" · ")} / 1M`;
}

function PricingSection({ theme, compact }: { theme: Theme; compact: boolean }) {
  const { t } = useI18n();
  const prefsQuery = usePrefs(detectSystemLocale());
  const reportQuery = useUsageReport("30d");
  const setCall = useSetPrefs();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PriceDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const styles = useMemo(
    () =>
      ({
        section: { backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 12, gap: 10 },
        sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
        sectionTitle: { fontSize: 13, fontWeight: "600", color: theme.colors.foreground },
        hint: { fontSize: 10, color: theme.colors.foregroundMuted },
        banner: { borderRadius: 8, padding: 8, backgroundColor: theme.colors.surface0 },
        bannerOk: { borderLeftWidth: 3, borderLeftColor: theme.colors.statusSuccess },
        bannerError: { borderLeftWidth: 3, borderLeftColor: theme.colors.statusDanger },
        bannerText: { fontSize: 11, color: theme.colors.foreground },
        itemCard: { gap: 6, padding: 10, borderRadius: 8, backgroundColor: theme.colors.surface0 },
        itemHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
        itemModel: { fontSize: 12, fontWeight: "600", color: theme.colors.foreground, flex: 1 },
        itemMeta: { fontSize: 10, color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] },
        buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
        smallButton: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: theme.colors.surface0 },
        smallButtonOnCard: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: theme.colors.surface1 },
        smallButtonText: { fontSize: 11, color: theme.colors.foreground },
        smallButtonDangerText: { fontSize: 11, color: theme.colors.statusDanger },
        primaryButton: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.accent },
        primaryButtonText: { fontSize: 12, color: theme.colors.accentForeground, fontWeight: "600" },
        chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
        chip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: theme.colors.surface0, borderWidth: 1, borderColor: theme.colors.border },
        chipText: { fontSize: 10, color: theme.colors.foreground },
        field: { gap: 4 },
        row2: { flexDirection: "row", gap: 8 },
        flexField: { flex: 1, gap: 4 },
        fieldLabel: { fontSize: 11, color: theme.colors.foregroundMuted },
        input: {
          fontSize: 12,
          color: theme.colors.foreground,
          backgroundColor: theme.colors.surface0,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 7,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        previewText: { fontSize: 10, color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] },
      }) satisfies Record<string, ViewStyle | TextStyle>,
    [theme, compact],
  );

  const customPrices = prefsQuery.data?.customModelPrices ?? [];
  const unpricedModels = reportQuery.data?.totals.unpricedModels ?? [];

  const persistPrices = async (entries: CustomModelPriceConfig[]): Promise<boolean> => {
    if (busy) return false;
    const latest = queryClient.getQueryData<UsagePrefs>(PREFS_QUERY_KEY) ?? prefsQuery.data;
    if (!latest) {
      setMessage({ kind: "error", text: t("common.loading") });
      return false;
    }
    setBusy(true);
    setMessage(null);
    const next: UsagePrefs = { ...latest };
    if (entries.length > 0) next.customModelPrices = entries;
    else delete next.customModelPrices;
    try {
      const result = await setCall(next);
      if (result.saved) {
        queryClient.setQueryData(PREFS_QUERY_KEY, next);
        setMessage({ kind: "ok", text: t("config.pricing.saved") });
        void queryClient.invalidateQueries({ queryKey: ["agent-usage"] });
        void queryClient.invalidateQueries({ queryKey: ["agent-usage-agent"] });
        return true;
      }
      setMessage({ kind: "error", text: result.error ?? t("common.saveFailed") });
      return false;
    } catch (error) {
      setMessage({ kind: "error", text: t("common.saveFailedDetail", { message: error instanceof Error ? error.message : String(error) }) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.model.trim()) {
      setMessage({ kind: "error", text: t("config.pricing.needModel") });
      return;
    }
    const entry = draftToCustomPrice(draft);
    if (!entry) {
      setMessage({ kind: "error", text: t("config.pricing.needRate") });
      return;
    }
    const replaceKey = normalizeModelId(draft.originalModel ?? entry.model);
    const nextKey = normalizeModelId(entry.model);
    const others = customPrices.filter((item) => {
      const key = normalizeModelId(item.model);
      return key !== replaceKey && key !== nextKey;
    });
    if (await persistPrices([...others, entry])) setDraft(null);
  };

  const removeEntry = async (model: string) => {
    const target = normalizeModelId(model);
    const next = customPrices.filter((item) => normalizeModelId(item.model) !== target);
    await persistPrices(next);
  };

  const draftPreview = useMemo(() => {
    if (!draft) return null;
    const candidate = draftToCustomPrice(draft);
    if (!candidate) return null;
    const replaceKey = normalizeModelId(draft.originalModel ?? candidate.model);
    const merged = [
      ...customPrices.filter((item) => normalizeModelId(item.model) !== replaceKey),
      candidate,
    ];
    return estimateTokenCost(
      candidate.model,
      { input: 100_000, output: 20_000, cacheRead: 1_000_000, cacheWrite: 0, reportedCost: 0 },
      merged,
    );
  }, [draft, customPrices]);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t("config.pricing")}</Text>
        <Pressable
          accessibilityRole="button"
          style={styles.smallButton}
          onPress={() => {
            setDraft(emptyPriceDraft());
            setMessage(null);
          }}
        >
          <Text style={styles.smallButtonText}>{t("config.pricing.add")}</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>{t("config.pricingHint")}</Text>

      {message ? (
        <View style={[styles.banner, message.kind === "ok" ? styles.bannerOk : styles.bannerError]}>
          <Text style={styles.bannerText}>{message.text}</Text>
        </View>
      ) : null}

      {unpricedModels.length > 0 ? (
        <View style={styles.field}>
          <Text style={styles.hint}>{t("config.pricing.unpriced")}</Text>
          <View style={styles.chipRow}>
            {unpricedModels.slice(0, 8).map((model) => (
              <Pressable
                key={model}
                accessibilityRole="button"
                style={styles.chip}
                onPress={() => {
                  setDraft(emptyPriceDraft(model));
                  setMessage(null);
                }}
              >
                <Text style={styles.chipText}>{model}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {customPrices.length === 0 ? <Text style={styles.hint}>{t("config.pricing.empty")}</Text> : null}

      {customPrices.map((entry) => (
        <View key={entry.model} style={styles.itemCard}>
          <View style={styles.itemHeader}>
            <Text numberOfLines={1} style={styles.itemModel}>{entry.model}</Text>
          </View>
          <Text style={styles.itemMeta}>{formatPriceRuleSummary(entry)}</Text>
          <View style={styles.buttonRow}>
            <Pressable
              accessibilityRole="button"
              style={styles.smallButtonOnCard}
              onPress={() => {
                setDraft(draftFromPrice(entry));
                setMessage(null);
              }}
            >
              <Text style={styles.smallButtonText}>{t("common.edit")}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} style={styles.smallButtonOnCard} onPress={() => void removeEntry(entry.model)}>
              <Text style={styles.smallButtonDangerText}>{t("common.delete")}</Text>
            </Pressable>
          </View>
        </View>
      ))}

      {draft ? (
        <View style={styles.itemCard}>
          <Text style={styles.sectionTitle}>{draft.originalModel ? t("config.pricing.edit", { model: draft.originalModel }) : t("config.pricing.add")}</Text>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t("config.pricing.modelLabel")}</Text>
            <TextInput
              style={styles.input}
              value={draft.model}
              onChangeText={(value) => setDraft({ ...draft, model: value })}
              placeholder={t("config.pricing.modelPlaceholder")}
              placeholderTextColor={theme.colors.foregroundMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t("config.pricing.mapToLabel")}</Text>
            <TextInput
              style={styles.input}
              value={draft.mapTo}
              onChangeText={(value) => setDraft({ ...draft, mapTo: value })}
              placeholder={t("config.pricing.mapToPlaceholder")}
              placeholderTextColor={theme.colors.foregroundMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={styles.row2}>
            <View style={styles.flexField}>
              <Text style={styles.fieldLabel}>{t("config.pricing.inputLabel")}</Text>
              <TextInput
                style={styles.input}
                value={draft.input}
                onChangeText={(value) => setDraft({ ...draft, input: value })}
                placeholder="3"
                placeholderTextColor={theme.colors.foregroundMuted}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.flexField}>
              <Text style={styles.fieldLabel}>{t("config.pricing.outputLabel")}</Text>
              <TextInput
                style={styles.input}
                value={draft.output}
                onChangeText={(value) => setDraft({ ...draft, output: value })}
                placeholder="15"
                placeholderTextColor={theme.colors.foregroundMuted}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          <View style={styles.row2}>
            <View style={styles.flexField}>
              <Text style={styles.fieldLabel}>{t("config.pricing.cacheReadLabel")}</Text>
              <TextInput
                style={styles.input}
                value={draft.cacheRead}
                onChangeText={(value) => setDraft({ ...draft, cacheRead: value })}
                placeholder="0.3"
                placeholderTextColor={theme.colors.foregroundMuted}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.flexField}>
              <Text style={styles.fieldLabel}>{t("config.pricing.cacheWriteLabel")}</Text>
              <TextInput
                style={styles.input}
                value={draft.cacheWrite}
                onChangeText={(value) => setDraft({ ...draft, cacheWrite: value })}
                placeholder="3.75"
                placeholderTextColor={theme.colors.foregroundMuted}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          <Text style={styles.previewText}>
            {draftPreview && draftPreview.source !== "unpriced"
              ? t("config.pricing.preview", { cost: formatUsd(draftPreview.costUsd), saved: formatUsd(draftPreview.cacheSavingsUsd) })
              : t("config.pricing.previewUnpriced")}
          </Text>
          <View style={styles.buttonRow}>
            <Pressable accessibilityRole="button" style={styles.primaryButton} disabled={busy} onPress={() => void saveDraft()}>
              <Text style={styles.primaryButtonText}>{busy ? t("common.saving") : t("common.save")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.smallButtonOnCard}
              onPress={() => {
                setDraft(null);
                setMessage(null);
              }}
            >
              <Text style={styles.smallButtonText}>{t("common.cancel")}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
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

const FEEDBACK_ITEMS: ReadonlyArray<{ template: string; title: DictKey; hint: DictKey }> = [
  { template: "bug_report.yml", title: "config.feedback.bug", hint: "config.feedback.bugHint" },
  { template: "feature_request.yml", title: "config.feedback.feature", hint: "config.feedback.featureHint" },
  { template: "new_provider.yml", title: "config.feedback.provider", hint: "config.feedback.providerHint" },
];

function FeedbackSection({ theme }: { theme: Theme }) {
  const { t } = useI18n();
  const styles = useMemo(
    () =>
      ({
        section: { backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 12, gap: 8 },
        sectionTitle: { fontSize: 13, fontWeight: "600", color: theme.colors.foreground },
        hint: { fontSize: 10, color: theme.colors.foregroundMuted },
        item: { gap: 2, paddingVertical: 2 },
        link: { fontSize: 12, color: theme.colors.accent },
      }) satisfies Record<string, ViewStyle | TextStyle>,
    [theme],
  );

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t("config.feedback")}</Text>
      <Text style={styles.hint}>{t("config.feedbackHint")}</Text>
      {FEEDBACK_ITEMS.map((item) => (
        <View key={item.template} style={styles.item}>
          <ExternalLink href={`${ISSUE_URL}?template=${item.template}`} accessibilityLabel={t(item.title)}>
            <Text style={styles.link}>{t(item.title)}</Text>
          </ExternalLink>
          <Text style={styles.hint}>{t(item.hint)}</Text>
        </View>
      ))}
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
        <PricingSection theme={theme} compact={compact} />
        <AgentsSection theme={theme} compact={compact} />
        <HostsManager theme={theme} />
        <FeedbackSection theme={theme} />
      </ScrollView>
    </View>
  );
}
