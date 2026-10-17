# Research — Extension Matrix

Status legend: **verified** (canonical repo + README confirmed) · **implemented** (rap-* code exists) · **tested** (tests pass) · **partial** (some features, not all) · **blocked** (env/dep missing) · **unverified** (no canonical source found)

| Reference | Canonical source | License | rap-* name | Verified | Implemented | Tested | Parity |
|---|---|---|---|---|---|---|---|
| pi-simplify | github.com/MattDevy/pi-extensions (packages/pi-simplify) | MIT | rap-simplify | yes | yes | yes | high (behavioral) |
| pi-lens | github.com/apmantza/pi-lens | (see repo) | rap-lens | yes | partial | partial | medium (LSP engine subset) |
| pi-plan-mode | github.com/qmx/pi-plan-mode + Pi bundled example `plan-mode` | MIT-ish | rap-plan-mode | yes | yes | yes | high |
| pi-debug-mode | github.com/liush2yuxjtu/pi-debug-mode | (see repo) | rap-debug-mode | yes | yes | yes | high (workflow) |
| pi-code-review | github.com/MattDevy/pi-extensions (packages/pi-code-review) | MIT | rap-code-review | yes | yes | yes | high (behavioral) |
| pi-subagents | github.com/geminixiang/pi-subagents + Pi bundled example `subagent` | (see repo) | rap-subagents | yes | yes | yes | high |
| pi-agent-ide | github.com/alexshpunt/pi-agent-ide | MIT | rap-agent-ide | yes | partial | partial | medium (subset of IDE tools) |

## Identity notes

- **pi-simplify** and **pi-code-review** share the MattDevy/pi-extensions monorepo; both MIT. READMEs fetched 2026-10-17.
- **pi-plan-mode**: npm `pi-plan-mode` (qmx) is a toggleable read-only mode. Pi's OWN bundled example `examples/extensions/plan-mode` is the most complete reference (tool restriction + bash allowlist + plan extraction + progress widget + persistence) and is used as the primary blueprint for rap-plan-mode.
- **pi-subagents**: npm `pi-subagents` (geminixiang) README returned 404 on `main`. Pi's OWN bundled example `examples/extensions/subagent` is the canonical, complete reference (single/parallel/chain, subprocess isolation, abort, agent discovery, trust gating) and is the primary blueprint for rap-subagents.
- **pi-debug-mode** (liush2yuxjtu): "Cursor-style evidence-first Debug Mode". Workflow = wait for runtime evidence → compare hypotheses → add targeted probes → pause for human reproduction → inspect captured evidence → smallest supported fix → verify.
- **pi-lens** (apmantza): LSP diagnostics/navigation + impact cascade + linters/type-checkers + ast-grep/tree-sitter structural rules + tools (`symbol_search`, `module_report`, `read_symbol`, `lens_diagnostic_mark`) + `/lens-map`. Large surface; rap-lens implements a focused subset (LSP diagnostics + lint/type-check invocation + diagnostic triage) and documents the rest as partial.
- **pi-agent-ide** (alexshpunt, MIT): "agent-native IDE" — guarded editing, search, LSP, terminals, debugging, observability. Large surface; rap-agent-ide implements a focused subset (guarded edit, diff inspection, code search, diagnostic surfacing) and documents the rest as partial.

## Tooling caveat

The task requested Exa / Firecrawl / Context7 / Skillquiver / OpenAI Platform. **None are available in this environment.** Research was performed with:
- Pi's bundled docs (`docs/extensions.md`) and examples (`examples/extensions/*`)
- DuckDuckGo Lite via `curl` (the in-session `web_search` tool was broken — it loaded the renamed `rap-web-search` from the now-deleted `rap-extension` path and could not resolve `playwright`)
- npm registry + GitHub raw READMEs

No feature is claimed on assumption; each is traced to a README or bundled example above.
