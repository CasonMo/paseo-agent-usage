# paseo-agent-usage

Paseo plugin: token usage statistics for coding agents, computed from their local session logs, with optional SSH collection from remote machines.

- Sidebar footer row: today's token total, click to open the full usage screen
- Pagination: session list and request log show 20 rows per page with prev / next controls
- Screen: device tabs (aggregate, local, each remote), agent tabs (overview + Claude Code / Codex / OpenCode / Pi), ranges (last 24 hours / today / 7 days / 30 days / 12 weeks / 12 months / custom), a trend granularity toggle (hour / day / week / month, independent of the range), bar and line charts with hover tooltips, model / project / request / session breakdowns
- Sessions section (each agent tab): per-session consumption (requests, tokens, duration, project) aggregated per session ID, with the same range and device filters; labeled with the first user message (falling back to the session id prefix), the count covers every matching session while the list shows the latest 200 per agent
- SSH: collect usage from other machines using the system ssh command; hosts are managed from the settings entry in the usage screen or from Paseo Settings
- Settings: English / Chinese UI (system-detected, manually switchable), a configurable auto-refresh interval (off / 5 / 15 / 30 / 60 / 360 / 1440 minutes), a custom display name for the local device tab (defaults to 本机 / Local), and saved default range + trend granularity for the usage screen
- Update check: a banner appears at the top of the usage screen when the registry listing has a newer version (reads only the public registry record and the pinned package.json; no user data is sent)

## Development

- `npm run typecheck`
- `npm run build:collector` regenerates `server/remote/collector.bundle.js` and `server/remote/collector.script.ts` from the sources in `server/`.

## Structure

- `index.client.tsx` / `index.server.ts`: plugin entries
- `client/`: sidebar row, usage screen, charts, settings
- `server/scan/`: local log adapters (Claude Code, Codex, OpenCode, Pi)
- `server/remote/`: SSH collection and the bundled remote collector
- `server/service.ts`: scanning service, cache and RPC handlers

---

## 中文

Paseo 插件：基于各编码 Agent 本地会话日志统计 token 用量，支持通过 SSH 采集远端机器数据。

- 侧边栏底部行：显示今日 token 总量，点击打开完整用量页
- 分页：会话列表与请求日志每页 20 条，带上一页 / 下一页
- 页面结构：设备页签（聚合 / 本机 / 各远端）、Agent 页签（总览 + Claude Code / Codex / OpenCode / Pi）、时间范围（近 24 小时 / 今日 / 近 7 天 / 近 30 天 / 近 12 周 / 近 12 月 / 自定义）、趋势聚合粒度切换（小时 / 日 / 周 / 月，与范围相互独立）、柱状图与折线图（悬浮提示）、按模型 / 项目 / 请求 / 会话的明细
- 会话区块（各 Agent 页签）：按会话 ID 聚合的单会话消耗（请求数、token、时长、项目），沿用相同的时间范围与设备过滤；标题取首条用户消息（无则回退会话 ID 前缀），计数覆盖范围内全部匹配会话，列表展示每个 Agent 最近 200 个
- SSH：用系统 ssh 命令从其他机器采集用量；主机在用量页的设置入口或 Paseo 设置中管理
- 设置：中英文界面（跟随系统、可手动切换）、可配置的自动刷新间隔（关闭 / 5 / 15 / 30 / 60 / 360 / 1440 分钟）、本机设备页签的自定义显示名（默认「本机 / Local」）、以及用量页默认时间范围与趋势粒度
- 更新检查：registry 上有新版本时，用量页顶部显示横幅（仅读取公开的 registry 记录与对应提交的 package.json；不发送任何用户数据）

## 开发

- `npm run typecheck`
- `npm run build:collector`：由 `server/` 源码重新生成 `server/remote/collector.bundle.js` 与 `server/remote/collector.script.ts`

## 目录结构

- `index.client.tsx` / `index.server.ts`：插件入口
- `client/`：侧边栏行、用量页、图表、设置
- `server/scan/`：本机日志适配器（Claude Code、Codex、OpenCode、Pi）
- `server/remote/`：SSH 采集与打包好的远端 collector
- `server/service.ts`：扫描服务、缓存与 RPC 处理器
