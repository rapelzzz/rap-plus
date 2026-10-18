# Feature Parity — rap-* vs references

Per-feature status. `✓` implemented & tested · `~` partial/limited · `✗` not implemented · `ref` = verified from source.

## rap-plan-mode  (ref: qmx/pi-plan-mode + Pi example `plan-mode`)

| Feature | ref | rap |
|---|---|---|
| `/plan` toggle read-only | ✓ | ✓ |
| Blocks write/edit tools (technical, via `setActiveTools`) | ✓ | ✓ |
| Smart bash filtering (allowlist + block destructive) | ✓ | ✓ |
| Git mutating command protection | ✓ | ✓ |
| Status indicator | ✓ | ✓ |
| Session persistence (`appendEntry`) | ✓ | ✓ |
| Bash override memory (session-approved commands) | ✓ | ✓ |
| Plan extraction + `[DONE:n]` progress + widget | example ✓ | ✓ |
| Shortcut `Ctrl+Alt+P` + `--plan` flag | example ✓ | ✓ |
| Invariant: planning cannot write source (technical gate) | ✓ | ✓ |

## rap-subagents  (ref: geminixiang/pi-subagents + Pi example `subagent`)

| Feature | ref | rap |
|---|---|---|
| `subagent` tool registration | ✓ | ✓ |
| Single mode `{agent, task}` | ✓ | ✓ |
| Parallel mode `{tasks:[...]}` (max 8, concurrency 4) | ✓ | ✓ |
| Chain mode `{chain:[...]}` with `{previous}` | ✓ | ✓ |
| Isolated context (separate `pi --mode json -p --no-session`) | ✓ | ✓ |
| Per-agent tool whitelist (`--tools`) | ✓ | ✓ |
| Progress reporting (`onUpdate` streaming) | ✓ | ✓ |
| Cancellation via signal → SIGTERM → SIGKILL | ✓ | ✓ |
| Agent discovery (user `~/.pi/agent/agents` + project `.pi/agents`) | ✓ | ✓ |
| Project-agent trust gating (`isProjectTrusted`) | ✓ | ✓ |
| Usage tracking (turns/tokens/cost) | ✓ | ✓ |
| Result collection + output cap (50KB/task) | ✓ | ✓ |
| Chain depth limit | ~ | ✓ (MAX_CHAIN_DEPTH) |
| Prevent recursive delegation | ~ | ✓ (model-only exposure, depth cap) |

## rap-simplify  (ref: MattDevy/pi-simplify, MIT)

| Feature | ref | rap |
|---|---|---|
| `/simplify` command | ✓ | ✓ |
| Detect changed files + line ranges via `git diff` | ✓ | ✓ |
| `--staged` / specific files / `--ref=<branch>` | ✓ | ✓ |
| Review only changed lines (read surrounding for context) | ✓ | ✓ |
| Edits constrained to changed ranges | ✓ | ✓ |
| One file at a time | ✓ | ✓ |
| Run tests to verify no break | ✓ | ✓ |
| Summarise changes | ✓ | ✓ |
| Bug-finding vs refactor separation | ~ | ✓ |

## rap-code-review  (ref: MattDevy/pi-code-review, MIT)

| Feature | ref | rap |
|---|---|---|
| Auto-review checklist injection after edits (`before_agent_start`) | ✓ | ✓ |
| Edit tracking via `tool_result` (write/edit input), batch at `turn_end` | ✓ | ✓ |
| Language-aware checklist (TS/Python/Go/Rust/Java/PHP/JS) | ✓ | ✓ |
| `/review` on-demand | ✓ | ✓ |
| `--staged` / `--ref` / specific files | ✓ | ✓ |
| Severity levels CRITICAL/HIGH/MEDIUM/INFO | ✓ | ✓ |
| Structured findings (severity, line, suggestion) | ✓ | ✓ |
| Structured output via session model (`ctx.modelRegistry.complete`) | ✓ | ✓ (provider-neutral, not Haiku-only) |
| Prompt-based fallback via session agent (`sendUserMessage`) | ✓ | ✓ |
| Read-only by default; never edits or publishes | ✓ | ✓ |

## rap-debug-mode  (ref: liush2yuxjtu/pi-debug-mode)

| Feature | ref | rap |
|---|---|---|
| `/debug` toggle evidence-first mode | ✓ | ✓ |
| Injected methodology: wait for runtime evidence before code change | ✓ | ✓ |
| Hypothesis formation (falsifiable, from evidence) | ✓ | ✓ |
| Targeted probes (log/assert/repro step) | ✓ | ✓ (`probe` param) |
| Reproduction checkpoint — gate fix behind confirmed repro | ✓ | ✓ (`reproConfirmed`) |
| Evidence accumulation store | ✓ | ✓ (`evidence` param + state) |
| Smallest fix addressing root cause | ✓ | ✓ (`fix` param + guidance) |
| Verification step (re-run repro) | ✓ | ✓ (`verified` param) |
| Separate hypothesis / evidence / conclusion | ✓ | ✓ (distinct params + state) |
| Workflow state machine with ordering enforcement | ~ | ✓ (canAdvanceTo gates) |

## rap-lens  (ref: apmantza/pi-lens) — FULL

| Feature | ref | rap |
|---|---|---|
| LSP diagnostics on write/edit | ✓ | ~ (ships `tsc --noEmit` on demand via `/lens`; not event-driven on every edit) |
| LSP navigation (definition/references) | ✓ | ✓ (`lens_goto_definition`, `lens_find_references`, `lens_hover` via TS LanguageService) |
| Impact cascade diagnostics | ✓ | ✗ (not impl; would require incremental program graph) |
| Language linters/type-checkers | ✓ | ~ (TS `tsc --noEmit`; multi-compiler/linter parsing supported) |
| Safe formatting/autofix | ✓ | ✓ (`lens_autofix`: TS codefixes + `eslint --fix` + `prettier --write`, dynamic) |
| ast-grep / tree-sitter structural rules | ✓ | ✓ (`lens_ast_grep` search + `lens_ast_grep_replace` rewrite, dynamic dep detection; rejects system `sg`/newgrp) |
| `symbol_search` / `module_report` / `read_symbol` | ✓ | ✓ (`lens_symbol_search`, `lens_module_report`, `lens_read_symbol`; regex fallback) |
| `lens_diagnostic_mark` triage | ✓ | ✓ |
| `/lens-map` HTML | ✓ | ✓ (`/lens-map` command → self-contained HTML) |
| Dynamic dependency detection | ✓ | ✓ |

**Parity gaps:** event-driven diagnostics-on-edit and impact cascade are not implemented (would need an incremental TS program + watcher). All other pi-lens surfaces ship.

## rap-agent-ide  (ref: alexshpunt/pi-agent-ide, MIT) — FULL

| Feature | ref | rap |
|---|---|---|
| Guarded file editing (path safety + sensitive-path block + size cap + confirm) | ✓ | ✓ |
| Diff inspection (`git diff` per path) | ✓ | ✓ |
| Code search (ripgrep-backed) | ✓ | ✓ |
| LSP / diagnostic surfacing | ✓ | ✗ (use rap-lens `/lens`) |
| Terminal | ✓ | ✓ (`ide_terminal`: persistent shell pool: create/send/list/output/kill) |
| Debugging | ✓ | ✓ (`ide_debug_run` + `ide_debug`: node --inspect-brk via CDP, breakpoint/resume/step/evaluate/locals/stop) |
| Undo / recovery | ✓ | ✗ (confirm gate only; no undo stack) |
| Capability discovery | ✓ | ~ (dynamic dep detection across modules) |
| Observability | ✓ | ✓ (`ide_system_metrics` via node:os; `ide_cpu_profile` via CDP Profiler → .cpuprofile) |

**Parity gaps:** event-driven LSP diagnostics on edit (use rap-lens), undo/recovery stack, and full capability discovery are not implemented. Terminals, debugging, and observability all ship.

## Summary of partial / not-implemented (honest)

- **rap-lens**: FULL parity except event-driven diagnostics-on-edit and impact cascade (would require an incremental TS program + watcher). LSP navigation, symbol discovery, ast-grep, autofix, and `/lens-map` all ship.
- **rap-agent-ide**: FULL parity except event-driven LSP-on-edit (use rap-lens), undo/recovery stack, and full capability discovery. Terminals (persistent shell pool), debugging (node --inspect-brk via CDP), and observability (system metrics + CPU profile) all ship.

No 100% parity is claimed: rap-lens omits event-driven diagnostics-on-edit + impact cascade; rap-agent-ide omits LSP-on-edit + undo stack.
