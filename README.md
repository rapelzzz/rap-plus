# rap-plus

A [Pi](https://pi.dev) package — ten extensions, a theme, and tooling for the RAP workflow.

> Install with one line:
>
> ```sh
> curl -fsSL https://raw.githubusercontent.com/rapelzzz/rap-plus/main/install.sh | sh
> ```

That installs Pi (if missing) and registers the `rap-plus` package. Start Pi and the extensions load automatically.

## What's inside

| Extension | Path | Description | Parity |
|---|---|---|---|
| rap-bluemon | `extensions/rap-bluemon` | Neon studio UI: status bar, rain panel, usage analytics, trend chart | original |
| todo | `extensions/todo` | RAP Todo panel, `/todo` commands, `rap_todo` tool, per-project persistence | original |
| rap-web-search | `extensions/rap-web-search.ts` | Headless Playwright + DuckDuckGo `web_search` tool | original |
| rap-plan-mode | `extensions/rap-plan-mode` | Read-only planning mode; blocks writes/destructive bash | ✓ full |
| rap-subagents | `extensions/rap-subagents` | Delegation: single/parallel/chain; depth limit; cancellation | ✓ full |
| rap-simplify | `extensions/rap-simplify` | Review & simplify git-diff changed code; regression-safe | ✓ full |
| rap-code-review | `extensions/rap-code-review` | Auto-review checklist + `/review` with severity findings | ✓ full |
| rap-lens | `extensions/rap-lens` | Diagnostics: tsc type-check, linter parsing, triage marks | ◐ partial |
| rap-debug-mode | `extensions/rap-debug-mode` | Evidence-first debug workflow; repro-gated fixes | ✓ full |
| rap-agent-ide | `extensions/rap-agent-ide` | Guarded editing, code search (ripgrep), diff inspection | ◐ partial |
| theme | `themes/rap-bluemon.json` | Dark "bluemon" theme | — |

Parity column: **✓ full** = behaviorally matches the reference extension; **◐ partial** = focused subset shipped (see [research/feature-parity.md](research/feature-parity.md)); **original** = not derived from a reference.

## Commands & tools

### rap-plan-mode (`/plan`)
Toggleable read-only planning mode. When active, edit/write tools are removed from the active set and destructive bash commands are blocked via the `tool_call` event. Shows a plan widget with `[DONE:n]` progress, persists plans, and supports `Ctrl+Alt+P` + the `--plan` flag. Faithful adaptation of Pi's bundled `examples/extensions/plan-mode`.

### rap-subagents (`/subagent`, `/subagents`)
Delegate tasks to other Pi agents. Modes: single, parallel (max 8 tasks / 4 concurrent), and chain (max depth 3). Agent discovery from `~/.pi/agent/agents` and nearest `.pi/agents`. Safety: depth-limit env propagation (`RAP_SUBAGENT_DEPTH`), stderr redaction, trust gating for project agents, abort via `SIGTERM`→`SIGKILL`. Adapted from Pi's bundled `examples/extensions/subagent`.

### rap-simplify (`/simplify`)
Detects files changed via `git diff`, constructs a scoped simplification review instruction, and sends it to the session agent via `pi.sendUserMessage`. Shared git-diff parsing in `extensions/_shared/git-diff.ts`.

### rap-code-review (`/review`)
Two surfaces:
1. **Automatic**: after each turn where the agent edits files, a language-aware review checklist (TypeScript/Python/Go/Rust/Java/PHP/JS) is injected into the next turn via `before_agent_start`.
2. **On-demand `/review`**: computes changed files + line ranges via `git diff`, reads the changed code, and calls the session model (`ctx.modelRegistry.complete`) for structured, severity-tagged findings (CRITICAL/HIGH/MEDIUM/INFO), parsed from JSON. Falls back to a prompt-based review when no model is configured. Read-only.

### rap-lens (`/lens`, `lens_diagnostic_mark`)
Focused diagnostics subset: dynamic tool/dependency detection, TypeScript type-check (`tsc --noEmit`), compiler/linter output parsing (tsc, rustc/gcc, ruff/flake8), diagnostic reporting, and a triage tool (`lens_diagnostic_mark`: falsePositive/suppressed/deferred/flagFix). **Not implemented**: LSP navigation, impact cascade, ast-grep/tree-sitter, symbol_search/module_map/read_symbol, `/lens-map`, autofix.

### rap-debug-mode (`/debug`, `debug_checkpoint`)
Evidence-first debugging methodology. When enabled, injects a six-stage workflow (investigate → hypothesize → probe → reproduce → fix → verify). The `debug_checkpoint` tool records progress and **gates the fix stage behind a confirmed reproduction** (safety invariant: no fixing before repro). Includes the smallest-fix and verify-with-repro disciplines.

### rap-agent-ide (`ide_search`, `ide_diff`, `ide_edit_guarded`)
Guarded IDE-style assistance:
- `ide_search` — ripgrep code search (read-only).
- `ide_diff` — git diff for a path (read-only).
- `ide_edit_guarded` — write/edit with safety validation: path must resolve within the project root, sensitive paths (`.env`, credentials, SSH keys, `.npmrc`) are blocked, size limits enforced, and the user is asked to confirm before applying.

**Not implemented**: terminals, debugging, observability, LSP.

## Safety invariants

- **rap-plan-mode**: technically blocks writes (removes edit/write tools via `setActiveTools`; blocks destructive bash via `tool_call`).
- **rap-subagents**: depth limit (3), concurrency caps, abort on signal, stderr redaction, trust gating, no credential propagation.
- **rap-code-review**: read-only — never edits or publishes.
- **rap-lens**: read-only diagnostics; `lens_diagnostic_mark` is `readOnlyHint`.
- **rap-debug-mode**: fix stage blocked until reproduction confirmed.
- **rap-agent-ide**: guarded edit validates path safety + blocks sensitive paths + interactive confirm; `ide_search`/`ide_diff` are read-only.

## Tests

```sh
npm test            # 91 unit tests across shared utils + 7 new extensions
npm run test:integration   # integration smoke tests (real git)
npx tsc --noEmit    # typecheck (12 pre-existing baseline errors in rap-web-search.ts)
```

Test coverage:
- `_shared` (safety, subprocess, git-diff, bash-allowlist): 18 tests
- rap-plan-mode: 9 · rap-subagents: 10 · rap-simplify: 7 · rap-code-review: 12
- rap-lens: 11 · rap-debug-mode: 11 · rap-agent-ide: 13

Shared utilities in `extensions/_shared/` are pure (no Pi imports) for unit testability with `node --test`.

## Research & parity

- [research/extension-matrix.md](research/extension-matrix.md) — verified/unverified status of all 7 reference extensions.
- [research/feature-parity.md](research/feature-parity.md) — per-feature comparison (✓/~/✗) with notes.
- [research/evidence-log.md](research/evidence-log.md) — auditable trail of what was verified, how, and when.

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
