# Changelog

All notable changes to **rap-plus**.

## [Unreleased] — full feature parity (rap-lens + rap-agent-ide)

### Added
- **rap-lens full surface**: LSP navigation via the TypeScript LanguageService (`lens_goto_definition`, `lens_find_references`, `lens_hover`); symbol discovery (`lens_symbol_search`, `lens_module_report`, `lens_read_symbol` with regex fallback); ast-grep structural search/replace (`lens_ast_grep` RO + `lens_ast_grep_replace` mutating, with dynamic binary detection that rejects the system `sg`/newgrp); autofix (`lens_autofix`: TS codefixes + `eslint --fix` + `prettier --write`); `/lens-map` HTML module-map generator. New modules: `lsp.ts`, `symbols.ts`, `astgrep.ts`, `autofix.ts`, `lensmap.ts`.
- **rap-agent-ide full surface**: terminal pool (`ide_terminal`: persistent shell sessions — create/send/list/output/kill, sentinel-based output capture); debugging over CDP (`ide_debug_run` + `ide_debug`: `node --inspect-brk`, breakpoint/resume/step/evaluate/locals/stop); observability (`ide_system_metrics` via `node:os`; `ide_cpu_profile` via the CDP Profiler domain → `.cpuprofile`). New modules: `terminal.ts`, `cdp.ts`, `debugging.ts`, `observability.ts`.
- **ast-grep** (`@ast-grep/cli`) added as a local dev dependency for `lens_ast_grep`.
- `/todo clear` command: wipe all todos (completed + unfinished) with confirmation.
- Renamed slash commands `/todo` → `/rap-todo`, `/todos` → `/rap-todos` (rap- prefix consistency).

### Fixed
- Completed-todos-reappear bug: `planTasks` now drops completed automatic tasks only when the previous automatic plan is fully complete (fresh start); mid-work re-plans preserve completed tasks for progress context.
- Node 24 native type stripping: added explicit `.ts` extensions to all relative imports across `todo/` and `rap-bluemon/`.

## [Unreleased] — 7 new extensions

### Added
- **rap-plan-mode** — read-only planning mode (`/plan`). Removes edit/write tools via `setActiveTools`; blocks destructive bash via the `tool_call` event. Plan widget with `[DONE:n]` progress, persistence, `Ctrl+Alt+P` shortcut, `--plan` flag. Faithful adaptation of Pi's bundled `plan-mode` example.
- **rap-subagents** — agent delegation (`/subagent`, `/subagents`): single, parallel (max 8 tasks / 4 concurrent), and chain (max depth 3) modes. Agent discovery from `~/.pi/agent/agents` + nearest `.pi/agents`. Safety: `RAP_SUBAGENT_DEPTH` env propagation, stderr redaction, trust gating, `SIGTERM`→`SIGKILL` abort. Adapted from Pi's bundled `subagent` example.
- **rap-simplify** — review & simplify git-diff changed code (`/simplify`). Detects changed files, constructs a scoped review instruction, sends to the session agent. Regression-safe (no silent edits).
- **rap-code-review** — automated + on-demand code review (`/review`). Auto-injects a language-aware checklist after edits (via `tool_result`/`turn_end`/`before_agent_start`); on-demand `/review` calls `ctx.modelRegistry.complete` for structured severity findings (CRITICAL/HIGH/MEDIUM/INFO), parsed from JSON with tolerant fallback. Read-only.
- **rap-lens** — diagnostics + LSP navigation, symbol discovery, ast-grep, autofix, `/lens-map` (`/lens`, `/lens-map`, `lens_*` tools). FULL parity (event-driven diagnostics-on-edit + impact cascade not implemented).
- **rap-debug-mode** — evidence-first debug workflow (`/debug`, `debug_checkpoint` tool). Six-stage methodology (investigate→hypothesize→probe→reproduce→fix→verify); fix stage gated behind confirmed reproduction.
- **rap-agent-ide** — guarded IDE assistance + terminals + CDP debugging + observability (`ide_search`, `ide_diff`, `ide_edit_guarded`, `ide_terminal`, `ide_debug_run`, `ide_debug`, `ide_system_metrics`, `ide_cpu_profile`). FULL parity (undo stack + event-driven LSP-on-edit not implemented).
- **Shared utilities** (`extensions/_shared/`): `safety.ts` (severity parsing, path resolution, secret redaction, truncation, dedup), `subprocess.ts` (argument-array execution, timeout/cancellation, output cap), `git-diff.ts` (diff parsing/formatting), `bash-allowlist.ts` (destructive-command detection). Pure modules for unit testability.
- **Research docs** (`research/`): `extension-matrix.md`, `feature-parity.md`, `evidence-log.md`.
- `typecheck`, `test`, `test:integration` npm scripts.
- `allowImportingTsExtensions: true` in `tsconfig.json` (required for Node 24 native type stripping).

### Tests
- 91 unit tests across shared utils + 7 new extensions (all passing).
- 12 pre-existing baseline typecheck errors in `rap-web-search.ts` (DOM types) — unchanged, not caused by this work.

### Renamed (earlier in this release)
- Theme files: `pi-tokyo-night*.json` → `rap-bluemon*.json`.
- Command `/rap-night` → `/rap-plus`.
- Folder `rap-extension` → `rap-plus`.
