# paseo-agent-usage

Paseo plugin: token usage statistics for coding agents, computed from their local session logs, with optional SSH collection from remote machines.

- Sidebar footer row: today's token total, click to open the full usage screen
- Screen: device tabs (aggregate, local, each remote), agent tabs (overview + Claude Code / Codex / OpenCode / Pi), ranges (today / 7 days / 30 days / 12 weeks / 12 months / custom), bar and line charts with hover tooltips, model / project / request breakdowns
- SSH: collect usage from other machines using the system ssh command; hosts are managed from the settings entry in the usage screen or from Paseo Settings
- Settings: English / Chinese UI (system-detected, manually switchable) and a configurable auto-refresh interval (off / 5 / 15 / 30 / 60 / 360 / 1440 minutes)

## Development

- `npm run typecheck`
- `npm run build:collector` regenerates `server/remote/collector.bundle.js` and `server/remote/collector.script.ts` from the sources in `server/`.

## Structure

- `index.client.tsx` / `index.server.ts`: plugin entries
- `client/`: sidebar row, usage screen, charts, settings
- `server/scan/`: local log adapters (Claude Code, Codex, OpenCode, Pi)
- `server/remote/`: SSH collection and the bundled remote collector
- `server/service.ts`: scanning service, cache and RPC handlers
