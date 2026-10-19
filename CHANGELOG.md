# Changelog

All notable changes to **rap-plus**.

## [Unreleased]

### Theme — rap-bluemon
The `rap-bluemon` theme is a vivid cobalt-blue dark theme:
- `themes/rap-bluemon.json`: primary blue `#4f9eff`, blueBright `#79c0ff`, fg `#d6dde3`, canvas `#0d1117`, borders `#1c2d44`/`#16233a`, semantic green/red/yellow/orange/purple/pink/cyan, diff backgrounds, and export `pageBg`/`cardBg`/`infoBg`. `dim` uses `#768494`.
- `extensions/todo/ui/theme-palette.ts`: the centralized chrome palette (status-bar powerline gradient, frame, status-segment foreground tints, working-shimmer text) — a 7-step vivid cobalt-blue gradient (model→cost) preserved as Bluemon's signature, spanning the selection blue (`#1a4480` family) toward the primary blue (`#4f9eff` family). Frame `#2a4060`; working text `#d6dde3`/`#929eab`. No algorithms, role names, types, or APIs changed.
- All other extensions render through `theme.fg(...)` / theme tokens (or return plain text/markdown) and pick up the theme automatically — no per-extension code changes needed.
- Non-TUI artifacts left untouched on purpose: `rap-lens/lensmap.ts` standalone HTML report CSS and `install.sh` shell-log ANSI colors are outside the terminal theme surface.

### Logo recolor — explicit opt-in
Pi's startup logo is hardcoded in its global bundle and is not themeable. Recoloring is now deliberately excluded from installation and session startup because it modifies files outside the project. Run `npm run recolor-logo` only when explicitly desired; the script requires `--apply` and creates a `.rap-plus-original.bak` backup beside a target file before modifying it. Restore the original by copying the backup over the modified bundle file. If the logo customization is not needed, no action is required.

### Added — extensions
- **rap-plan-mode** — read-only planning mode (`/rap-plan`, `/rap-todos`). Removes edit/write tools via `setActiveTools`; blocks destructive bash via the `tool_call` event. Plan widget with `[DONE:n]` progress, persistence, `Ctrl+Alt+P` shortcut, `--plan` flag.
- **rap-subagents** — agent delegation via the `subagent` tool: single, parallel (max 8 tasks / 4 concurrent), and chain (max depth 3) modes. Agent discovery from `~/.pi/agent/agents` + nearest `.pi/agents`. Safety: `RAP_SUBAGENT_DEPTH` env propagation, stderr redaction, trust gating, `SIGTERM`→`SIGKILL` abort.
- **rap-simplify** — review & simplify git-diff changed code (`/rap-simplify`). Detects changed files, constructs a scoped review instruction, sends to the session agent. Regression-safe (no silent edits).
- **rap-code-review** — automated + on-demand code review (`/rap-review`). Auto-injects a language-aware checklist after edits (via `tool_result`/`turn_end`/`before_agent_start`); on-demand `/rap-review` calls `ctx.modelRegistry.complete` for structured severity findings (CRITICAL/HIGH/MEDIUM/INFO), parsed from JSON with tolerant fallback. Read-only.
- **rap-lens** — diagnostics + code intelligence (`/rap-lens`, `/rap-lens-map`, `lens_*` tools). TypeScript type-check (`tsc --noEmit`), multi-compiler/linter parsing (tsc/rustc/gcc/ruff/flake8), triage marks; LSP navigation (goto-definition/find-references/hover) via the TypeScript LanguageService; symbol discovery (search/module-report/read-symbol, regex fallback); ast-grep structural search/replace; autofix (TS codefixes + eslint --fix + prettier --write); HTML module-map generator. New modules: `lsp.ts`, `symbols.ts`, `astgrep.ts`, `autofix.ts`, `lensmap.ts`.
- **rap-debug-mode** — evidence-first debug workflow (`/rap-debug`, `debug_checkpoint` tool). Six-stage methodology (investigate→hypothesize→probe→reproduce→fix→verify); fix stage gated behind confirmed reproduction.
- **rap-agent-ide** — guarded IDE assistance (`ide_search`, `ide_diff`, `ide_edit_guarded`, `ide_terminal`, `ide_debug_run`, `ide_debug`, `ide_system_metrics`, `ide_cpu_profile`). Guarded editing, ripgrep search, git-diff inspection, persistent terminal pool, CDP debugging (`node --inspect-brk`), and observability (system metrics + CPU profile). New modules: `terminal.ts`, `cdp.ts`, `debugging.ts`, `observability.ts`.
- **Shared utilities** (`extensions/_shared/`): `safety.ts` (severity parsing, path resolution, secret redaction, truncation, dedup), `subprocess.ts` (argument-array execution, timeout/cancellation, output cap), `git-diff.ts` (diff parsing/formatting), `bash-allowlist.ts` (destructive-command detection). Pure modules for unit testability.
- **rap-lens full surface**: LSP navigation (`lens_goto_definition`, `lens_find_references`, `lens_hover`); symbol discovery (`lens_symbol_search`, `lens_module_report`, `lens_read_symbol`); ast-grep (`lens_ast_grep` RO + `lens_ast_grep_replace` mutating, with dynamic binary detection that rejects the system `sg`/newgrp); autofix (`lens_autofix`); `/rap-lens-map` HTML module-map generator.
- **rap-agent-ide full surface**: terminal pool (`ide_terminal`: persistent shell sessions — create/send/list/output/kill, sentinel-based output capture); debugging over CDP (`ide_debug_run` + `ide_debug`: breakpoint/resume/step/evaluate/locals/stop); observability (`ide_system_metrics` via `node:os`; `ide_cpu_profile` via the CDP Profiler domain → `.cpuprofile`).
- **ast-grep** (`@ast-grep/cli`) added as an optional dependency for `lens_ast_grep`.
- `/rap-todo clear` command: wipe all todos (completed + unfinished) with confirmation.
- `typecheck`, `test`, `test:integration` npm scripts.
- `allowImportingTsExtensions: true` in `tsconfig.json` (required for Node 24 native type stripping).


### Commands — `/rap-` prefix
All slash commands now share the `rap-` prefix for a consistent suite identity:
- `/plan` → `/rap-plan`, `/todos` → `/rap-todos`
- `/lens` → `/rap-lens`, `/lens-map` → `/rap-lens-map`
- `/debug` → `/rap-debug`, `/simplify` → `/rap-simplify`, `/review` → `/rap-review`
- `/todo` → `/rap-todo` (already prefixed: `/rap-plus`)

### Fixed
- Completed-todos-reappear bug: `planTasks` now drops completed automatic tasks only when the previous automatic plan is fully complete (fresh start); mid-work re-plans preserve completed tasks for progress context.
- Node 24 native type stripping: added explicit `.ts` extensions to all relative imports across `todo/` and `rap-bluemon/`.
- `--inspect-brk` entry pause requires `Runtime.runIfWaitingForDebugger` (not `Debugger.resume`); breakpoints require `file://` URLs via `pathToFileURL`.

### Removed
- `research/` scaffolding (internal development notes) — not part of the shipped package.

### Tests
- Expanded automated unit and integration coverage; see the CI workflow for the commands run on each pull request.
- 12 pre-existing baseline typecheck errors in `rap-web-search.ts` (DOM types) — unchanged, not caused by this work.
