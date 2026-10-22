# paseo-agent-usage

Paseo plugin: token usage statistics for coding agents, computed from their local session logs, with optional SSH collection from remote machines.

- Sidebar footer row still shows today's token total and opens the dashboard
- Dashboard with six preset pages: Overview, Composition, Efficiency, Rhythm, Sessions, Compare
- Every chart is a card: move up/down, switch full/half width, hide or remove; the layout is saved per page
- Custom pages: create a blank page or duplicate the current one, rename, reorder, hide or delete; a searchable chart catalog and page manager are built in (custom pages live in the aggregate view; agent tabs reuse the preset pages)
- Overview: usage pulse, token-type stack / requests / cost / forecast trend, period comparison, outlier days, agent share, host comparison
- Composition: token mix, model/project ranking with concentration, agent × model and project × agent heatmaps, share map
- Efficiency: cache hit and cache read/write, tokens per request, input/output structure, model efficiency map, cost trend/efficiency, cumulative usage
- Rhythm: year calendar, weekday × hour punchcard, 24-hour profile, weekday profile, activity streak, hour × agent heatmap
- Sessions: duration/token scatter, distribution histograms, top sessions, swimlane, request-size histogram, recent pace, paginated session list and request log
- Compare: agent radar, monthly budget burn with month-end projection, data coverage and host sync state
- Cost cards only count agents that report cost (Claude/Codex may report zero); the optional monthly budget is set in Settings → General
- Kept from the previous version: device tabs (aggregate / local / each remote), agent tabs (overview + Claude Code / Codex / OpenCode / Pi), ranges (last 24 hours / today / 7 days / 30 days / 12 weeks / 12 months / custom), and an independent trend granularity (hour / day / week / month)
- Sessions are grouped by session ID; one agent shows the latest 200 sessions, the request log keeps about 400 calls per agent and reports up to 120; both paginate 20 rows
- SSH: collect usage from other machines using the system ssh command; hosts are managed in the usage screen or Paseo Settings
- Settings: English / Chinese UI, auto-refresh interval, local device label, default range and granularity, optional monthly budget in USD
- Update check: a banner appears when the registry listing has a newer version (reads only public registry data; no user data is sent)

## Development

- `npm run check` (typecheck + layout/report assertions)
- `npm run build:collector` regenerates `server/remote/collector.bundle.js` and `server/remote/collector.script.ts` from the sources in `server/`.

## Structure

- `index.client.tsx` / `index.server.ts`: plugin entries
- `client/`: sidebar row, dashboard shell and pages, ledger charts, settings
- `server/scan/`: local log adapters (Claude Code, Codex, OpenCode, Pi)
- `server/remote/`: SSH collection and the bundled remote collector
- `server/report.ts`: usage aggregation, period/calendar/session/matrix derivations
- `server/service.ts`: scanning service, cache and RPC handlers

---

## 中文

Paseo 插件：基于各编码 Agent 本地会话日志统计 token 用量，支持通过 SSH 采集远端机器数据。

- 侧边栏底部行仍显示今日 token 总量，点击打开看板
- 看板包含 6 个预设页：总览、构成、效率、节奏、会话、对比
- 每张图表都是卡片：可上移/下移、切换整行/半宽、隐藏或移除；布局按页面保存
- 自定义页面：新建空白页或复制当前页，支持改名、排序、隐藏、删除；内置页面管理与可搜索的图表目录（自定义页只在聚合视图生效，Agent 页签复用预设页）
- 总览：用量脉搏、Token 类型堆叠 / 请求 / 成本 / 预测趋势、周期对比、异常日、Agent 份额、主机对比
- 构成：Token 构成、模型/项目排行与集中度、Agent × 模型、项目 × Agent、矩形占比
- 效率：缓存命中率、缓存读写、请求均量、输入输出结构、模型效率象限、成本趋势/效率、累计曲线
- 节奏：年历热力图、星期 × 小时打卡、24 小时画像、星期画像、活跃度与连续天数、时段 × Agent
- 会话：会话散点、时长/Token 分布、Top 会话、会话泳道、请求大小、近期速率、分页会话明细与请求日志
- 对比：Agent 雷达、月度预算燃烧率与月末预测、数据覆盖与主机同步状态
- 成本卡只统计有上报的 Agent（Claude/Codex 可能为 0）；可选月度预算在「配置 → 通用」中设置
- 保留原有能力：设备页签（聚合 / 本机 / 各远端）、Agent 页签（总览 + Claude Code / Codex / OpenCode / Pi）、时间范围（近 24 小时 / 今日 / 近 7 天 / 近 30 天 / 近 12 周 / 近 12 月 / 自定义）、独立的趋势粒度（小时 / 日 / 周 / 月）
- 会话按会话 ID 聚合；单个 Agent 展示最近 200 个会话，请求日志底层每个 Agent 保留约 400 条、报告最多展示 120 条；两者每页 20 条
- SSH：用系统 ssh 命令从其他机器采集用量；主机在用量页或 Paseo 设置中管理
- 设置：中英文界面、自动刷新间隔、本机标签、默认时间范围与粒度、可选月度预算（USD）
- 更新检查：registry 上有新版本时显示横幅（仅读取公开 registry 数据，不发送用户数据）

## 开发

- `npm run check`（typecheck + 布局/报告断言）
- `npm run build:collector`：由 `server/` 源码重新生成 `server/remote/collector.bundle.js` 与 `server/remote/collector.script.ts`

## 目录结构

- `index.client.tsx` / `index.server.ts`：插件入口
- `client/`：侧边栏行、仪表盘壳与页面、账本式图表、设置
- `server/scan/`：本机日志适配器（Claude Code、Codex、OpenCode、Pi）
- `server/remote/`：SSH 采集与打包好的远端 collector
- `server/report.ts`：用量聚合、周期/日历/会话/矩阵派生
- `server/service.ts`：扫描服务、缓存与 RPC 处理器
