<p align="center">
  <img src="assets/rap-plus-logo.png" alt="rap-plus logo" width="180">
</p>

<h1 align="center">rap-plus</h1>

A [Pi](https://pi.dev) package — ten extensions, a theme, and tooling for the RAP workflow.

> Install with one line:
>
> ```sh
> curl -fsSL https://raw.githubusercontent.com/rapelzzz/rap-plus/main/install.sh | sh
> ```

That installs Pi (if missing) and registers the `rap-plus` package. Start Pi and the extensions load automatically.

## What's inside

| Extension | Path | Description |
|---|---|---|
| rap-bluemon | `extensions/rap-bluemon` | Neon studio UI: status bar, rain panel, usage analytics, trend chart |
| todo | `extensions/todo` | RAP Todo panel, `/rap-todo` commands, `rap_todo` tool, per-project persistence |
| rap-web-search | `extensions/rap-web-search.ts` | Headless Playwright + DuckDuckGo `web_search` tool |
| rap-plan-mode | `extensions/rap-plan-mode` | Read-only planning mode; blocks writes/destructive bash |
| rap-subagents | `extensions/rap-subagents` | Delegation: single/parallel/chain; depth limit; cancellation |
| rap-simplify | `extensions/rap-simplify` | Review & simplify git-diff changed code; regression-safe |
| rap-code-review | `extensions/rap-code-review` | Auto-review checklist + `/rap-review` with severity findings |
| rap-lens | `extensions/rap-lens` | Diagnostics + LSP nav, symbol search, ast-grep, autofix, `/rap-lens-map` |
| rap-debug-mode | `extensions/rap-debug-mode` | Evidence-first debug workflow; repro-gated fixes |
| rap-agent-ide | `extensions/rap-agent-ide` | Guarded editing, search, diff, terminals, CDP debugging, observability |
| theme | `themes/rap-bluemon.json` | Dark "bluemon" theme |

## Commands & tools

### rap-plan-mode (`/rap-plan`, `/rap-todos`)
Toggleable read-only planning mode. When active, edit/write tools are removed from the active set and destructive bash commands are blocked via the `tool_call` event. Shows a plan widget with `[DONE:n]` progress, persists plans, and supports `Ctrl+Alt+P` + the `--plan` flag.

### rap-subagents (`subagent` tool)
Delegate tasks to other Pi agents with isolated context windows. One tool, three modes: single (`{ agent, task }`), parallel (`{ tasks: [...] }`, max 8 / 4 concurrent), and chain (`{ chain: [...] }`, max depth 3). Agent discovery from `~/.pi/agent/agents` and nearest `.pi/agents`. Safety: depth-limit env propagation (`RAP_SUBAGENT_DEPTH`), stderr redaction, trust gating for project agents, abort via `SIGTERM`→`SIGKILL`.

### rap-simplify (`/rap-simplify`)
Detects files changed via `git diff`, constructs a scoped simplification review instruction, and sends it to the session agent via `pi.sendUserMessage`. Shared git-diff parsing in `extensions/_shared/git-diff.ts`.

### rap-code-review (`/rap-review`)
Two surfaces:
1. **Automatic**: after each turn where the agent edits files, a language-aware review checklist (TypeScript/Python/Go/Rust/Java/PHP/JS) is injected into the next turn via `before_agent_start`.
2. **On-demand `/rap-review`**: computes changed files + line ranges via `git diff`, reads the changed code, and calls the session model (`ctx.modelRegistry.complete`) for structured, severity-tagged findings (CRITICAL/HIGH/MEDIUM/INFO), parsed from JSON. Falls back to a prompt-based review when no model is configured. Read-only.

### rap-lens (`/rap-lens`, `/rap-lens-map`)
Full diagnostics + code-intelligence suite. Dynamic tool/dependency detection, TypeScript type-check (`tsc --noEmit`), compiler/linter output parsing (tsc, rustc/gcc, ruff/flake8), and a triage tool (`lens_diagnostic_mark`: falsePositive/suppressed/deferred/flagFix). LSP navigation via the TypeScript LanguageService: `lens_goto_definition`, `lens_find_references`, `lens_hover`. Symbol discovery: `lens_symbol_search`, `lens_module_report`, `lens_read_symbol` (regex fallback). Structural search/replace via ast-grep: `lens_ast_grep` (RO) + `lens_ast_grep_replace` (mutating; rejects the system `sg`/newgrp). Autofix: `lens_autofix` (TS codefixes + `eslint --fix` + `prettier --write`, dynamic). `/rap-lens-map` writes a self-contained HTML module map. **Gaps**: event-driven diagnostics-on-edit and impact cascade are not implemented.

### rap-debug-mode (`/rap-debug`, `debug_checkpoint`)
Evidence-first debugging methodology. When enabled, injects a six-stage workflow (investigate → hypothesize → probe → reproduce → fix → verify). The `debug_checkpoint` tool records progress and **gates the fix stage behind a confirmed reproduction** (safety invariant: no fixing before repro). Includes the smallest-fix and verify-with-repro disciplines.

### rap-agent-ide (`ide_search`, `ide_diff`, `ide_edit_guarded`, `ide_terminal`, `ide_debug_run`, `ide_debug`, `ide_system_metrics`, `ide_cpu_profile`)
Guarded IDE assistance:
- **Guarded editing** — `ide_edit_guarded`: write/edit with safety validation (path must resolve within the project root, sensitive paths like `.env`/credentials/SSH keys/`.npmrc` are blocked, size limits enforced, interactive confirm).
- **Search & diff** — `ide_search` (ripgrep, read-only), `ide_diff` (git diff per path, read-only).
- **Terminal pool** — `ide_terminal`: create/send/list/output/kill persistent shell sessions.
- **Debugging** — `ide_debug_run` starts a script under `node --inspect-brk`; `ide_debug` controls it (breakpoint/removeBreakpoint/resume/stepOver/stepInto/stepOut/evaluate/locals/status/stop) over CDP.
- **Observability** — `ide_system_metrics` (host/cpu/memory via `node:os`), `ide_cpu_profile` (captures a `.cpuprofile` via the CDP Profiler domain).

**Gaps**: undo/recovery stack, event-driven LSP-on-edit (use rap-lens `/rap-lens`).

## Safety invariants

- **rap-plan-mode**: technically blocks writes (removes edit/write tools via `setActiveTools`; blocks destructive bash via `tool_call`).
- **rap-subagents**: depth limit (3), concurrency caps, abort on signal, stderr redaction, trust gating, no credential propagation.
- **rap-code-review**: read-only — never edits or publishes.
- **rap-lens**: `lens_*` navigation/symbol/search tools are `readOnlyHint`; `lens_ast_grep_replace` and `lens_autofix` are mutating (clearly labeled).
- **rap-debug-mode**: fix stage blocked until reproduction confirmed.
- **rap-agent-ide**: guarded edit validates path safety + blocks sensitive paths + interactive confirm; `ide_search`/`ide_diff`/`ide_system_metrics` are read-only; `ide_terminal`/`ide_debug_*`/`ide_cpu_profile` are mutating (sessions bounded — terminal cap 8, debug sessions killed on stop).

## Tests

```sh
npm test            # 145 unit + integration tests across shared utils + 9 extensions
npm run test:integration   # integration smoke tests (real git)
npx tsc --noEmit    # typecheck (12 pre-existing baseline errors in rap-web-search.ts)
```

Test coverage:
- `_shared` (safety, subprocess, git-diff, bash-allowlist): 18 tests
- rap-plan-mode: 9 · rap-subagents: 10 · rap-simplify: 7 · rap-code-review: 12
- rap-lens: 40 · rap-debug-mode: 11 · rap-agent-ide: 31 · todo: 7

Shared utilities in `extensions/_shared/` are pure (no Pi imports) for unit testability with `node --test`.

## Manual install

```sh
pi install git:github.com/rapelzzz/rap-plus
```

Or pin a ref:

```sh
pi install git:github.com/rapelzzz/rap-plus@main
```

## Manage

```sh
pi list                       # show registered packages
pi update --extensions        # reconcile package checkouts
pi remove git:github.com/rapelzzz/rap-plus
pi config                     # toggle resources / enable the theme
```

## Develop locally

```sh
git clone https://github.com/rapelzzz/rap-plus
cd rap-plus
npm install
pi -e .                       # try the package for one session
```

Requires Node.js 22.19+ (Node 24 recommended — native `.ts` execution via type stripping) and Pi.
