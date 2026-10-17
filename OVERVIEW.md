# Agent Usage

在 Paseo 中查看各编码 Agent 的本地用量统计。

数据源（在 daemon 所在机器本地读取；远端机器数据经 SSH 采集，见下文）：

- Claude Code：`~/.claude/projects`（含 subagents）
- Codex：`~/.codex/sessions` 与 `~/.codex/archived_sessions`
- OpenCode：`~/.local/share/opencode/opencode.db`（通过 node:sqlite 只读；reasoning token 计入输出，与计费口径一致）
- Pi：`~/.pi/agent/sessions`（含 forks 与子会话目录；跨文件按消息去重，fork 复制段不重复计）

界面：侧边栏底部「用量」行显示今日 token；点击打开全屏页，支持近24小时 / 今日 / 近 7 天 / 近 30 天 / 近 12 周 / 近 12 月 / 自定义日期范围（日历圈选起止），趋势图可在小时 / 日 / 周 / 月 四种聚合粒度间切换（默认日，范围与粒度相互独立）。

- 顶部两层页签：① 设备切换（聚合 / 本机 / 各远端，「聚合」在最前）② Agent 页签（总览 + Claude Code / Codex / OpenCode / Pi）；「配置」入口在右上角刷新按钮右侧（含 Agent 统计开关与 SSH 主机管理）
- 总览：总量卡片、趋势图（可切换柱状图 / 折线图，聚合粒度四段开关）、按 Agent / 模型 / 项目 的明细；底部「统计口径与已知差异」说明与 CC Switch 等代理工具的对比口径（含无法对齐的原因）
- 图表交互：鼠标悬浮（或点按）图表查看当期用量明细（总 token 与各 Agent 拆分）；悬浮提示显示完整周期标签（如 `2026-08-15 14:00`）
- Agent 页签：该 Agent 的概况卡片、趋势图、模型明细、项目明细与请求日志（时间、模型、项目、会话、输入/输出/缓存 token）；请求日志只保留每个 Agent 最近约 400 条调用

刷新机制：首次扫描全量历史日志（本机约 30 秒，其间页面显示扫描进度），之后按文件增量刷新（约 1~2 秒）；Agent 回合结束后会自动触发防抖增量刷新。插件升级后（统计数据改为小时粒度缓存）会有一次全量重扫。

配置（用量页右上角「配置」或 Paseo 设置 → 插件）：

- **通用**：界面语言（跟随系统 / 中文 / English，自动检测系统语言）与**定时刷新**（关闭 / 5 分钟 / 15 分钟 / **30 分钟（默认）** / 1 小时 / 6 小时 / 24 小时；定时自动扫描本地日志并同步远端主机）
- **Agent 开关**：关闭的 Agent 不展示、不拉取
- **远端主机（SSH）**：增删改与测试连接

## 远端统计（SSH）

可以把其他机器上的用量一起统计进来。两种配置方式：

1. **可视化配置（推荐）**：用量页右上角「配置」入口，或 **Paseo 设置 → 插件 → Agent Usage**，在其中增删改 SSH 主机、测试连接；保存后新主机/变更主机会自动拉取
2. 手动编辑插件数据目录的 `hosts.json`（`~/.paseo/plugin-data/agent-usage-plugin/hosts.json`）：

```json
[
  { "name": "dev1", "target": "dev1" },
  { "name": "srv2", "target": "user@10.0.0.2", "passwordCommand": "security find-generic-password -s agent-usage-ssh-srv2 -w" }
]
```

- `target`：`~/.ssh/config` 别名或 `user@host`；认证默认走 SSH 密钥，也支持账号密码：`password` 字段（明文，注意文件权限）或更安全的 `passwordCommand`（从钥匙串/密码管理器取密码）
- 可选字段：`port`、`identityFile`、`nodePath`（远端 node 路径）、`cacheDir`（远端增量缓存目录）、`timeoutMs`、`enabled`
- 远端要求：无需安装任何额外软件，插件自动探测 JS 运行时（PATH / nvm / volta / fnm / asdf / homebrew 等常见位置，并尝试加载 `~/.nvm/nvm.sh`）；探测不到时才需要填 `nodePath`。SQLite 源需 Node ≥ 22.5，否则自动跳过；首次拉取为全量，之后增量
- 安全：插件不读取/解密任何远端凭据；远端只读日志，仅写一个小增量缓存（`~/.cache/agent-usage-plugin`）
- 界面：顶部「设备」页签可切换聚合 / 单机视图（页签下方显示各机器的同步状态）；请求日志带设备来源标签

## 数据与权限

- 读取：本机（及各远端主机）的本地会话日志
- 写入：daemon 所在机器的插件数据目录（扫描状态与主机配置）；远端仅写增量缓存
- 网络：插件自身的网络访问只有版本更新检查（每小时最多一次，仅读取公开的 registry 记录与对应提交的 package.json，来自 raw.githubusercontent.com、api.github.com，不发送任何数据）；SSH 采集通过系统 ssh 命令连接你配置的主机
- 不读取、不保存、不发送任何登录凭据；不发送 prompts、代码或日志内容到任何服务
- 支持 macOS 与 Linux；需要 Paseo 0.11.2 或更高版本
