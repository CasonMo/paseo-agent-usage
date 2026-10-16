import { useEffect, useMemo, useState } from "react";
import { usePrefs } from "./data";

export type Locale = "zh" | "en";
export type LanguageMode = "auto" | Locale;

const listeners = new Set<() => void>();
let mode: LanguageMode = "auto";
let locale: Locale = resolveLocale("auto");

/** Best-effort system locale detection (navigator / Intl), defaulting to Chinese. */
export function detectSystemLocale(): Locale {
  try {
    const nav = (globalThis as { navigator?: { language?: unknown; languages?: unknown } }).navigator;
    const candidates: string[] = [];
    if (nav && Array.isArray(nav.languages)) {
      for (const item of nav.languages) if (typeof item === "string") candidates.push(item);
    }
    if (nav && typeof nav.language === "string") candidates.push(nav.language);
    try {
      const intl = Intl.DateTimeFormat().resolvedOptions().locale;
      if (intl) candidates.push(intl);
    } catch {
      /* ignore */
    }
    for (const raw of candidates) if (/^zh/i.test(raw)) return "zh";
    for (const raw of candidates) if (/^en/i.test(raw)) return "en";
  } catch {
    /* ignore */
  }
  return "zh";
}

function resolveLocale(next: LanguageMode): Locale {
  return next === "auto" ? detectSystemLocale() : next;
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function setLanguageMode(next: LanguageMode): void {
  if (next === mode && resolveLocale(next) === locale) return;
  mode = next;
  locale = resolveLocale(next);
  notify();
}

export function getLocale(): Locale {
  return locale;
}

const zh = {
  "common.loading": "加载中…",
  "common.save": "保存",
  "common.saving": "保存中…",
  "common.saved": "已保存",
  "common.cancel": "取消",
  "common.edit": "编辑",
  "common.delete": "删除",
  "common.test": "测试连接",
  "common.testing": "测试中…",
  "common.back": "← 返回",
  "common.saveFailed": "保存失败",
  "common.saveFailedDetail": "保存失败：{message}",

  "unit.requests": "{n} 次",
  "unit.credits": "{n} 积分",
  "unit.creditsShort": "{n} 分",
  "unit.in": "入",
  "unit.out": "出",
  "unit.cache": "缓存",

  "app.title": "Agent 用量",
  "app.subtitleSince": "数据自 {day} 起 · 基于本地会话日志",
  "app.subtitle": "基于本地会话日志统计",
  "app.config": "配置",
  "app.refresh": "刷新",
  "app.refreshing": "刷新中…",
  "app.a11yOpenConfig": "打开配置",
  "app.a11yRefresh": "刷新用量",

  "range.today": "今日",
  "range.7d": "近 7 天",
  "range.30d": "近 30 天",
  "range.12w": "近 12 周",
  "range.12m": "近 12 月",
  "range.custom": "自定义",

  "chart.bar": "柱状图",
  "chart.line": "折线图",
  "chart.hoverHint": "悬浮（或点按）图表查看当期明细。",
  "chart.pointA11y": "{label} 用量",

  "origin.aggregate": "聚合",
  "origin.local": "本机",
  "origin.pulling": "拉取中…",
  "origin.error": "拉取失败",
  "origin.never": "未拉取",
  "origin.ok": "正常",
  "origin.synced": "已同步 {time}",
  "origin.pullFailed": "{label} 拉取失败：{error}",

  "scan.scanning": "正在扫描本地日志 {done}/{total}",
  "scan.firstHint": "（首次扫描，Codex 历史日志较大，可能需要一会儿）",
  "scan.error": "上次扫描出错：{error}",

  "tab.overview": "总览",
  "card.totalTokens": "总 Tokens",
  "card.requests": "请求数",
  "card.cacheShare": "缓存读取占比",
  "card.credits": "积分",
  "section.trend": "趋势",
  "section.byAgent": "按 Agent",
  "section.models": "模型明细",
  "section.projects": "项目明细",
  "section.agentTrend": "{label} 趋势",
  "section.requestLog": "请求日志（最近 {n} 条）",
  "log.empty": "所选范围内暂无记录；日志只保留最近约 400 条调用。",
  "log.footer": "日志仅保留最近约 400 条调用，更早的会滚动淘汰。",

  "notes.title": "统计口径与已知差异",
  "notes.collapse": "收起",
  "notes.expand": "展开",
  "notes.collapsedHint": "与 CC Switch 对比时存在少量口径差异，展开查看原因。",
  "notes.item1":
    "· 本插件仅统计本地（及远端）会话日志；CC Switch 等代理工具还会记录「代理层」流量，口径天然不同。",
  "notes.item2":
    "· Codex 少量「一次性 App Server 线程」请求不写入任何本地日志（仅代理可见），本插件无法统计；量级通常小于 0.1%。",
  "notes.item3":
    "· 请求数：CC Switch 的请求数包含其自身探针、限流与失败请求，通常略高；对比时建议以 token 总量为准。",
  "notes.item4":
    "· 历史差异：源端清理过的记录（如 Claude Code 约 30 天自动清理）无法补回；本插件也会统计部分 CC Switch 不扫描的内容（Pi forks/子会话、Codex fork 恢复事件），个别数字可能更大。",
  "notes.item5": "以上均为数据源结构差异，不是统计误差。",

  "empty.preparing": "正在准备数据…",
  "empty.noData": "暂无数据",
  "empty.firstScan": "首次扫描完成后，这里会显示统计。",
  "empty.none": "未找到本地会话日志，或所选设备范围内没有用量。",

  "date.pickStart": "请选择起始日期",
  "date.pickEnd": "{from} ~ 请选择结束日期",
  "date.clear": "清除",
  "date.ym": "{year}年{month}月",

  "project.unknown": "(未知项目)",

  "config.title": "配置",
  "config.general": "通用",
  "config.language": "语言",
  "config.language.system": "跟随系统",
  "config.autoRefresh": "定时刷新",
  "config.autoRefreshHint": "定时自动扫描本地日志并同步远端主机。",
  "config.refresh.off": "关闭",
  "config.refresh.5": "5 分钟",
  "config.refresh.15": "15 分钟",
  "config.refresh.30": "30 分钟",
  "config.refresh.60": "1 小时",
  "config.refresh.360": "6 小时",
  "config.refresh.1440": "24 小时",
  "config.agents": "Agent 开关",
  "config.agentsHint": "关闭的 Agent 不展示、不拉取。",

  "hosts.title": "远端主机（SSH）",
  "hosts.add": "新增主机",
  "hosts.empty": "还没有远端主机。点击「新增主机」添加，支持 SSH 密钥或账号密码认证。",
  "hosts.auth.passwordCommand": "取密命令",
  "hosts.auth.password": "密码认证",
  "hosts.auth.key": "密钥认证",
  "hosts.edit": "编辑「{name}」",
  "hosts.nameLabel": "名称（唯一标识）",
  "hosts.targetLabel": "地址（user@host 或 ~/.ssh/config 别名）",
  "hosts.targetPlaceholder": "例如 dev1 或 user@host",
  "hosts.portLabel": "端口（可选）",
  "hosts.timeoutLabel": "超时（秒）",
  "hosts.authLabel": "认证方式",
  "hosts.passwordSaved": "密码（已保存，留空保持不变）",
  "hosts.password": "密码",
  "hosts.passwordPlaceholder": "输入密码",
  "hosts.passwordCommandLabel": "取密命令（在本机执行，输出即密码）",
  "hosts.identityLabel": "密钥文件（可选）",
  "hosts.nodePathLabel": "远端 node 路径（可选）",
  "hosts.cacheDirLabel": "远端缓存目录（可选）",
  "hosts.saved": "已保存（新主机或变更的主机会自动拉取）",
  "hosts.needNameTarget": "请填写名称和地址（target）",
  "hosts.notes1":
    "说明：远端无需安装任何东西——自动探测 JS 运行时（PATH / nvm / volta / fnm / homebrew）；仅当探测不到时才需填 nodePath。",
  "hosts.notes2": "密码只保存在本机（hosts.json，权限 600），也可用取密命令从钥匙串读取。",
} as const;

type DictKey = keyof typeof zh;

const en: Record<DictKey, string> = {
  "common.loading": "Loading…",
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.saved": "Saved",
  "common.cancel": "Cancel",
  "common.edit": "Edit",
  "common.delete": "Delete",
  "common.test": "Test connection",
  "common.testing": "Testing…",
  "common.back": "← Back",
  "common.saveFailed": "Save failed",
  "common.saveFailedDetail": "Save failed: {message}",

  "unit.requests": "{n} reqs",
  "unit.credits": "{n} credits",
  "unit.creditsShort": "{n} cr",
  "unit.in": "in",
  "unit.out": "out",
  "unit.cache": "cache",

  "app.title": "Agent Usage",
  "app.subtitleSince": "Since {day} · from local session logs",
  "app.subtitle": "Based on local session logs",
  "app.config": "Settings",
  "app.refresh": "Refresh",
  "app.refreshing": "Refreshing…",
  "app.a11yOpenConfig": "Open settings",
  "app.a11yRefresh": "Refresh usage",

  "range.today": "Today",
  "range.7d": "Last 7 days",
  "range.30d": "Last 30 days",
  "range.12w": "Last 12 weeks",
  "range.12m": "Last 12 months",
  "range.custom": "Custom",

  "chart.bar": "Bars",
  "chart.line": "Line",
  "chart.hoverHint": "Hover (or tap) the chart for details.",
  "chart.pointA11y": "{label} usage",

  "origin.aggregate": "All",
  "origin.local": "Local",
  "origin.pulling": "Pulling…",
  "origin.error": "Pull failed",
  "origin.never": "Not yet",
  "origin.ok": "OK",
  "origin.synced": "Synced {time}",
  "origin.pullFailed": "{label} pull failed: {error}",

  "scan.scanning": "Scanning local logs {done}/{total}",
  "scan.firstHint": " (first scan may take a while — large Codex history)",
  "scan.error": "Last scan error: {error}",

  "tab.overview": "Overview",
  "card.totalTokens": "Total tokens",
  "card.requests": "Requests",
  "card.cacheShare": "Cache read share",
  "card.credits": "Credits",
  "section.trend": "Trend",
  "section.byAgent": "By agent",
  "section.models": "Models",
  "section.projects": "Projects",
  "section.agentTrend": "{label} trend",
  "section.requestLog": "Request log (latest {n})",
  "log.empty": "No records in this range; only the latest ~400 calls are kept.",
  "log.footer": "Only the latest ~400 calls are kept; older entries roll off.",

  "notes.title": "Scope & known differences",
  "notes.collapse": "Collapse",
  "notes.expand": "Expand",
  "notes.collapsedHint": "A few differences vs CC Switch are expected — expand for details.",
  "notes.item1":
    "· This plugin only reads local (and remote) session logs; proxy tools like CC Switch also record proxy-layer traffic, so scopes differ by design.",
  "notes.item2":
    "· A few Codex \"one-shot app-server thread\" requests are never written to local logs (proxy-only) and cannot be counted here; usually under 0.1%.",
  "notes.item3":
    "· Request counts: CC Switch includes its own probes, throttled and failed requests, so its count runs a bit higher; compare token totals instead.",
  "notes.item4":
    "· History: records cleaned at the source (e.g. Claude Code's ~30-day cleanup) cannot be recovered; this plugin also counts things CC Switch skips (Pi forks/sub-runs, recovered Codex fork events), so occasional numbers can be larger here.",
  "notes.item5": "These are structural data-source differences, not counting errors.",

  "empty.preparing": "Preparing data…",
  "empty.noData": "No data",
  "empty.firstScan": "Stats appear here once the first scan finishes.",
  "empty.none": "No local session logs found, or no usage in the selected scope.",

  "date.pickStart": "Select start date",
  "date.pickEnd": "{from} ~ select end date",
  "date.clear": "Clear",
  "date.ym": "{month}/{year}",

  "project.unknown": "(unknown project)",

  "config.title": "Settings",
  "config.general": "General",
  "config.language": "Language",
  "config.language.system": "System",
  "config.autoRefresh": "Auto refresh",
  "config.autoRefreshHint": "Periodically scan local logs and sync remote hosts.",
  "config.refresh.off": "Off",
  "config.refresh.5": "5 min",
  "config.refresh.15": "15 min",
  "config.refresh.30": "30 min",
  "config.refresh.60": "1 hour",
  "config.refresh.360": "6 hours",
  "config.refresh.1440": "24 hours",
  "config.agents": "Agents",
  "config.agentsHint": "Disabled agents are hidden and not scanned.",

  "hosts.title": "Remote hosts (SSH)",
  "hosts.add": "Add host",
  "hosts.empty": "No remote hosts yet. Click \"Add host\" to add one — SSH key or password auth supported.",
  "hosts.auth.passwordCommand": "Password command",
  "hosts.auth.password": "Password",
  "hosts.auth.key": "SSH key",
  "hosts.edit": "Edit \"{name}\"",
  "hosts.nameLabel": "Name (unique id)",
  "hosts.targetLabel": "Address (user@host or ~/.ssh/config alias)",
  "hosts.targetPlaceholder": "e.g. dev1 or user@host",
  "hosts.portLabel": "Port (optional)",
  "hosts.timeoutLabel": "Timeout (seconds)",
  "hosts.authLabel": "Authentication",
  "hosts.passwordSaved": "Password (saved — leave blank to keep)",
  "hosts.password": "Password",
  "hosts.passwordPlaceholder": "Enter password",
  "hosts.passwordCommandLabel": "Password command (runs locally; stdout is the password)",
  "hosts.identityLabel": "Identity file (optional)",
  "hosts.nodePathLabel": "Remote node path (optional)",
  "hosts.cacheDirLabel": "Remote cache dir (optional)",
  "hosts.saved": "Saved (new or changed hosts pull automatically)",
  "hosts.needNameTarget": "Please fill in a name and target",
  "hosts.notes1":
    "Notes: nothing needs to be installed on the remote — the JS runtime is auto-detected (PATH / nvm / volta / fnm / homebrew); set nodePath only if detection fails.",
  "hosts.notes2": "Passwords stay on this machine only (hosts.json, mode 600); a password command can read from the Keychain instead.",
};

const DICT: Record<Locale, Record<DictKey, string>> = { zh, en };

export type Translate = (key: DictKey, params?: Record<string, string | number>) => string;

function makeTranslate(loc: Locale): Translate {
  const table = DICT[loc];
  return (key, params) => {
    let text = table[key] ?? DICT.zh[key] ?? String(key);
    if (params) {
      for (const [name, value] of Object.entries(params)) text = text.split(`{${name}}`).join(String(value));
    }
    return text;
  };
}

/** Non-reactive translation for helpers outside components (uses the current locale). */
export function translateNow(key: DictKey, params?: Record<string, string | number>): string {
  return makeTranslate(locale)(key, params);
}

/** Localized strings + reactive locale; subscribes to the shared language store. */
export function useI18n(): { locale: Locale; mode: LanguageMode; t: Translate } {
  const [, setTick] = useState(0);
  const prefs = usePrefs(detectSystemLocale());
  useEffect(() => {
    const listener = () => setTick((value) => value + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    const language = prefs.data?.language;
    if (language) setLanguageMode(language);
  }, [prefs.data?.language]);
  const current = locale;
  const t = useMemo(() => makeTranslate(current), [current]);
  return { locale: current, mode, t };
}
