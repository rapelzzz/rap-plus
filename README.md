<p align="center">
  <img src="assets/rap-plus-logo.png" alt="rap-plus logo" width="180">
</p>

<h1 align="center">rap-plus</h1>

<p align="center">
  A polished <a href="https://pi.dev">Pi</a> package — ten extensions, a vivid cobalt-blue theme, and a full agent-IDE toolset built for the RAP workflow.
</p>

<p align="center">
  <a href="https://github.com/rapelzzz/rap-plus"><img alt="Pi package" src="https://img.shields.io/badge/Pi-extension-1F6FEB"></a>
  <a href="#requirements"><img alt="Node.js" src="https://img.shields.io/badge/node-%E2%89%A522.19-339933?logo=node.js&logoColor=white"></a>
  <a href="#tests"><img alt="tests" src="https://img.shields.io/badge/tests-161%20passing-brightgreen"></a>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue">
  <img alt="last commit" src="https://img.shields.io/github/last-commit/rapelzzz/rap-plus">
</p>

---

rap-plus extends Pi with planning, delegation, code intelligence, evidence-first debugging, and guarded IDE tooling — wrapped in a signature `rap-bluemon` theme that recolors the Pi startup logo automatically. Every extension loads on `pi` launch with zero per-extension setup.

## Highlights

- **10 extensions + 1 theme**, all registered automatically on install
- **Vivid cobalt-blue theme** (`rap-bluemon`) with automatic Pi-logo recolor — runs at install via `postinstall` and self-heals at runtime after `pi update`
- **Safety-first design** — read-only planning mode, reproduction-gated fixes, guarded edits, depth-limited subagents, read-only review
- **161 passing tests** across shared utilities and all 10 extensions
- **One-line install** — `curl | sh` or `pi install git:...`, no manual steps

## Quick start

```sh
curl -fsSL https://raw.githubusercontent.com/rapelzzz/rap-plus/main/install.sh | sh
```

This installs Pi (if missing), registers the `rap-plus` package, and recolors the startup logo — all in one step. Then just run `pi`; the extensions load automatically.

Already have Pi? Install directly:

```sh
pi install git:github.com/rapelzzz/rap-plus          # latest on main
pi install git:github.com/rapelzzz/rap-plus@main     # pin a ref
```

## What's inside

| Extension | Path | Description |
|---|---|---|
| rap-bluemon | `extensions/rap-bluemon` | Neon studio UI: status bar, rain panel, usage analytics, trend chart |
| todo | `extensions/todo` | RAP Todo panel, `/rap-todo` commands, `rap_todo` tool, per-project persistence |
| rap-web-search | `extensions/rap-web-search.ts` | Headless Playwright + DuckDuckGo `web_search` tool |
| rap-plan-mode | `extensions/rap-plan-mode` | Read-only planning mode; blocks writes & destructive bash |
| rap-subagents | `extensions/rap-subagents` | Delegation: single / parallel / chain; depth limit; cancellation |
| rap-simplify | `extensions/rap-simplify` | Review & simplify git-diff changed code; regression-safe |
| rap-code-review | `extensions/rap-code-review` | Auto-review checklist + `/rap-review` with severity findings |
| rap-lens | `extensions/rap-lens` | Diagnostics, LSP nav, symbol search, ast-grep, autofix, `/rap-lens-map` |
| rap-debug-mode | `extensions/rap-debug-mode` | Evidence-first debug workflow; repro-gated fixes |
| rap-agent-ide | `extensions/rap-agent-ide` | Guarded editing, search, diff, terminals, CDP debugging, observability |
| theme | `themes/rap-bluemon.json` | Vivid cobalt-blue dark theme |

## Theme & logo

`rap-bluemon` is a vivid cobalt-blue dark theme — primary blue `#4f9eff`, blueBright `#79c0ff`, on a `#0d1117` canvas, with a 7-step blue powerline gradient as the status-bar signature. All extensions render through `theme.fg(...)` tokens and pick up the palette automatically.

The Pi startup logo (`▀▀█` / "Pi" wordmark) uses hardcoded brand colors and is not themeable, so rap-plus recolors it for you: the `postinstall` hook patches the global Pi bundle at install time, and the rap-bluemon extension re-patches it at runtime whenever a `pi update` restores the original bundle. No manual command — the logo stays blue across Pi updates.

## Extensions

### rap-plan-mode — `/rap-plan`, `/rap-todos`
Toggleable read-only planning mode. When active, edit/write tools are removed from the active set and destructive bash commands are blocked via the `tool_call` event. Shows a plan widget with `[DONE:n]` progress, persists plans, and supports `Ctrl+Alt+P` and the `--plan` flag.

### rap-subagents — `subagent` tool
Delegate tasks to other Pi agents with isolated context windows. One tool, three modes: single (`{ agent, task }`), parallel (`{ tasks: [...] }`, max 8 / 4 concurrent), and chain (`{ chain: [...] }`, max depth 3). Agent discovery from `~/.pi/agent/agents` and the nearest `.pi/agents`. Safety: depth-limit env propagation (`RAP_SUBAGENT_DEPTH`), stderr redaction, trust gating for project agents, abort via `SIGTERM`→`SIGKILL`.

### rap-simplify — `/rap-simplify`
Detects files changed via `git diff`, builds a scoped simplification review instruction, and sends it to the session agent. Shared git-diff parsing lives in `extensions/_shared/git-diff.ts`. Regression-safe — no silent edits.

### rap-code-review — `/rap-review`
Two surfaces:
1. **Automatic** — after each turn where the agent edits files, a language-aware review checklist (TypeScript/Python/Go/Rust/Java/PHP/JS) is injected into the next turn.
2. **On-demand `/rap-review`** — computes changed files + line ranges via `git diff`, reads the changed code, and calls the session model for structured, severity-tagged findings (CRITICAL/HIGH/MEDIUM/INFO), parsed from JSON with a prompt-based fallback when no model is configured. Read-only.

### rap-lens — `/rap-lens`, `/rap-lens-map`
Full diagnostics + code-intelligence suite. Dynamic tool/dependency detection, TypeScript type-check (`tsc --noEmit`), compiler/linter output parsing (tsc, rustc/gcc, ruff/flake8), and a triage tool (`lens_diagnostic_mark`: falsePositive/suppressed/deferred/flagFix). LSP navigation via the TypeScript LanguageService: `lens_goto_definition`, `lens_find_references`, `lens_hover`. Symbol discovery: `lens_symbol_search`, `lens_module_report`, `lens_read_symbol` (regex fallback). Structural search/replace via ast-grep: `lens_ast_grep` (read-only) + `lens_ast_grep_replace` (mutating; rejects the system `sg`/newgrp). Autofix: `lens_autofix` (TS codefixes + `eslint --fix` + `prettier --write`). `/rap-lens-map` writes a self-contained HTML module map.

### rap-debug-mode — `/rap-debug`, `debug_checkpoint`
Evidence-first debugging methodology. When enabled, injects a six-stage workflow (investigate → hypothesize → probe → reproduce → fix → verify). The `debug_checkpoint` tool records progress and **gates the fix stage behind a confirmed reproduction** — no fixing before repro. Includes smallest-fix and verify-with-repro disciplines.

### rap-agent-ide — `ide_*` tools
Guarded IDE assistance:
- **Guarded editing** — `ide_edit_guarded`: write/edit with safety validation (path must resolve within the project root; sensitive paths like `.env`, credentials, SSH keys, `.npmrc` are blocked; size limits enforced; interactive confirm).
- **Search & diff** — `ide_search` (ripgrep, read-only), `ide_diff` (git diff per path, read-only).
- **Terminal pool** — `ide_terminal`: create/send/list/output/kill persistent shell sessions.
- **Debugging** — `ide_debug_run` starts a script under `node --inspect-brk`; `ide_debug` controls it (breakpoint/resume/step/evaluate/locals/stop) over CDP.
- **Observability** — `ide_system_metrics` (host/cpu/memory via `node:os`), `ide_cpu_profile` (captures a `.cpuprofile` via the CDP Profiler domain).

## Safety invariants

- **rap-plan-mode** — blocks writes (removes edit/write tools via `setActiveTools`) and destructive bash (via `tool_call`).
- **rap-subagents** — depth limit (3), concurrency caps, abort on signal, stderr redaction, trust gating, no credential propagation.
- **rap-code-review** — read-only; never edits or publishes.
- **rap-lens** — `lens_*` navigation/symbol/search tools are `readOnlyHint`; `lens_ast_grep_replace` and `lens_autofix` are mutating and clearly labeled.
- **rap-debug-mode** — fix stage blocked until reproduction is confirmed.
- **rap-agent-ide** — guarded edit validates path safety and blocks sensitive paths with interactive confirm; `ide_search`/`ide_diff`/`ide_system_metrics` are read-only; terminal sessions are capped (8), debug sessions killed on stop.

## Requirements

- **Node.js 22.19+** (Node 24 recommended — native `.ts` execution via type stripping)
- **Pi** — installed automatically by the one-liner if missing

## Tests

```sh
npm test            # 161 passing tests
npm run test:integration   # integration smoke tests (real git)
npx tsc --noEmit    # typecheck (12 pre-existing baseline errors in rap-web-search.ts DOM types)
```

161 passing tests across shared utilities and all 10 extensions. Shared utilities in `extensions/_shared/` are pure (no Pi imports) for unit testability with `node --test`.

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

## License

[MIT](LICENSE) © rapelzzz
