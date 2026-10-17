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

## rap-lens  (ref: apmantza/pi-lens) — PARTIAL

| Feature | ref | rap |
|---|---|---|
| LSP diagnostics on write/edit | ✓ | ✗ (not impl; ships tsc type-check on demand) |
| LSP navigation (definition/references) | ✓ | ✗ (not impl) |
| Impact cascade diagnostics | ✓ | ✗ (not impl) |
| Language linters/type-checkers | ✓ | ~ (TS `tsc --noEmit` only; eslint/ruff detected but not invoked) |
| Safe formatting/autofix | ✓ | ✗ (not impl) |
| ast-grep / tree-sitter structural rules | ✓ | ✗ (not impl — heavy dep) |
| `symbol_search` / `module_report` / `read_symbol` | ✓ | ✗ (not impl) |
| `lens_diagnostic_mark` triage | ✓ | ✓ |
| `/lens-map` HTML | ✓ | ✗ (not impl) |
| Dynamic dependency detection | ✓ | ✓ |

## rap-agent-ide  (ref: alexshpunt/pi-agent-ide, MIT) — PARTIAL

| Feature | ref | rap |
|---|---|---|
| Guarded file editing (path safety + sensitive-path block + size cap + confirm) | ✓ | ✓ |
| Diff inspection (`git diff` per path) | ✓ | ✓ |
| Code search (ripgrep-backed) | ✓ | ✓ |
| LSP / diagnostic surfacing | ✓ | ✗ (not impl; use rap-lens `/lens`) |
| Terminal | ✓ | ✗ (Pi already has bash) |
| Debugging | ✓ | ✗ (use rap-debug-mode `/debug`) |
| Undo / recovery | ✓ | ✗ (not impl; confirm gate only) |
| Capability discovery | ✓ | ✗ (not impl) |
| Observability | ✓ | ✗ (not impl) |

## Summary of partial / not-implemented (honest)

- **rap-lens**: navigation, impact cascade, autofix, ast-grep/tree-sitter, symbol search, `/lens-map` are **not implemented**. Full LSP engine parity is out of scope here; a focused diagnostics + triage subset ships. Marked partial.
- **rap-agent-ide**: terminals, debugging, observability are **not implemented** (Pi already provides bash; debugging belongs to rap-debug-mode). A guarded-edit + search + diff + capability-discovery subset ships. Marked partial.

No 100% parity is claimed for rap-lens or rap-agent-ide.
