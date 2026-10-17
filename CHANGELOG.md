# Changelog

All notable changes to **rap-plus**.

## [Unreleased] — 7 new extensions

### Added
- **rap-plan-mode** — read-only planning mode (`/plan`). Removes edit/write tools via `setActiveTools`; blocks destructive bash via the `tool_call` event. Plan widget with `[DONE:n]` progress, persistence, `Ctrl+Alt+P` shortcut, `--plan` flag. Faithful adaptation of Pi's bundled `plan-mode` example.
- **rap-subagents** — agent delegation (`/subagent`, `/subagents`): single, parallel (max 8 tasks / 4 concurrent), and chain (max depth 3) modes. Agent discovery from `~/.pi/agent/agents` + nearest `.pi/agents`. Safety: `RAP_SUBAGENT_DEPTH` env propagation, stderr redaction, trust gating, `SIGTERM`→`SIGKILL` abort. Adapted from Pi's bundled `subagent` example.
- **rap-simplify** — review & simplify git-diff changed code (`/simplify`). Detects changed files, constructs a scoped review instruction, sends to the session agent. Regression-safe (no silent edits).
- **rap-code-review** — automated + on-demand code review (`/review`). Auto-injects a language-aware checklist after edits (via `tool_result`/`turn_end`/`before_agent_start`); on-demand `/review` calls `ctx.modelRegistry.complete` for structured severity findings (CRITICAL/HIGH/MEDIUM/INFO), parsed from JSON with tolerant fallback. Read-only.
- **rap-lens** — focused diagnostics subset (`/lens`, `lens_diagnostic_mark` tool). Dynamic tool detection, `tsc --noEmit` type-check, compiler/linter output parsing (tsc/rustc/gcc/ruff/flake8), triage marks. Partial: LSP navigation, ast-grep, symbol search, autofix not implemented.
- **rap-debug-mode** — evidence-first debug workflow (`/debug`, `debug_checkpoint` tool). Six-stage methodology (investigate→hypothesize→probe→reproduce→fix→verify); fix stage gated behind confirmed reproduction.
- **rap-agent-ide** — guarded IDE assistance (`ide_search`, `ide_diff`, `ide_edit_guarded` tools). Ripgrep search, git-diff inspection, safety-validated editing with path/size/sensitive-path guards + interactive confirm. Partial: terminals, debugging, observability not implemented.
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
