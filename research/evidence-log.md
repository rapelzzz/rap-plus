# Evidence Log

Auditable trail: what was verified, how, and when. Times are session-local.

## Baseline (before any new work)

- Repo: `~/.pi/agent/extensions/rap-plus` (renamed from `rap-extension`).
- Git HEAD: `1b743d0 rename command /rap-night -> /rap-plus`. Working tree clean.
- Node v24.21.0; TypeScript 5.9.3 (local `node_modules/.bin/tsc`).
- `package.json`: name `rap-plus`, 3 extensions (`rap-web-search.ts`, `rap-bluemon/index.ts`, `todo/index.ts`), deps `playwright`, peerDeps pi-* + typebox, devDep typescript.
- `tsconfig.json`: ES2022/ESNext, strict, noEmit, `lib: ["ES2022"]` (no `dom`), paths point at system pi packages.
- **Baseline typecheck FAILS with 12 pre-existing errors**, all in `extensions/rap-web-search.ts`:
  `error TS2584: Cannot find name 'document'` (×7) and `TS7006`/`TS18046` (`el` implicitly any / unknown).
  Cause: file uses Playwright browser `document` DOM API but tsconfig `lib` lacks `"dom"`. **Pre-existing, not caused by this work.** Recorded so it is not counted as a regression.
- 3 existing extensions load via `pi.extensions` entry points (verified by reading `todo/index.ts`, `rap-bluemon/index.ts`).

## Reference research (2026-10-17)

Tooling: Pi bundled docs + examples, DuckDuckGo Lite via `curl`, npm registry, GitHub raw READMEs.
(Exa/Firecrawl/Context7/Skillquiver/OpenAI Platform **not available** — see extension-matrix.md.)

| Reference | Source fetched | Evidence |
|---|---|---|
| pi-simplify | raw.githubusercontent.com/MattDevy/pi-extensions/main/packages/pi-simplify/README.md | README captured: `/simplify`, git-diff, --staged/--ref/files, one-file-at-a-time, run tests. MIT. |
| pi-code-review | raw.githubusercontent.com/MattDevy/pi-extensions/main/packages/pi-code-review/README.md | README captured: auto-checklist injection, tool_execution_end/turn_end/before_agent_start, severity CRITICAL/HIGH/MEDIUM/INFO, Haiku + fallback. MIT. |
| pi-plan-mode | npm registry `pi-plan-mode` + README | qmx repo; toggle read-only, blocks write/edit, smart bash, git protection, persistence, override memory. Pi bundled `examples/extensions/plan-mode` read in full (index.ts+utils.ts+README). |
| pi-subagents | npm registry `pi-subagents`; geminixiang README 404 on `main` | Pi bundled `examples/extensions/subagent` read in full (index.ts+agents.ts+README) = canonical complete reference. |
| pi-debug-mode | npm registry `pi-debug-mode` + README | liush2yuxjtu repo; evidence-first: hypotheses, probes, reproduction checkpoint, evidence, smallest fix, verify. |
| pi-lens | npm registry `pi-lens` + README | apmantza repo; LSP+linters+type-checkers+ast-grep/tree-sitter+symbol_search/module_report/read_symbol/lens_diagnostic_mark+/lens-map. Large surface. |
| pi-agent-ide | npm registry `pi-agent-ide` + README | alexshpunt repo, MIT; guarded editing, search, LSP, terminals, debugging, observability. Large surface. |

## Pi API contract (verified from docs/extensions.md)

- Extension = default factory `(pi: ExtensionAPI) => void` (may be async).
- `pi.registerTool({name, description, parameters(TypeBox), execute, renderCall?, renderResult?, exposure?, annotations?, outputSchema?})`.
- Tool result: `{content:[{type:"text",text}], details, isError?, terminate?, usage?}`.
- `pi.registerCommand(name, {description, handler:async(args,ctx)=>})`.
- `pi.registerShortcut(Key, {description, handler})`, `pi.registerFlag(name, {type,default})`.
- `pi.on(event, handler)` returns unsub; events: session_start, session_shutdown, before_agent_start, tool_call (can `{block,reason}`), tool_result, tool_execution_end, turn_end, agent_end, context, agent_before_settle.
- `pi.setActiveTools(names)`, `pi.getActiveTools()`, `pi.getAllTools()`.
- `pi.appendEntry(type, data)` durable state; `ctx.sessionManager.getEntries()` / `getBranch()`.
- `pi.sendMessage(msg, opts)`, `pi.sendUserMessage(text, opts)`.
- `ctx.executeTool(name, args, {signal,onUpdate})` nested; `ctx.modelRegistry.streamSimple()` provider-neutral nested model calls.
- `ctx.ui.{notify,confirm,select,editor,setStatus,setWidget,custom,theme}`; `ctx.hasUI`, `ctx.mode`, `ctx.signal`, `ctx.cwd`, `ctx.isProjectTrusted()`.
- Tool exposure: direct/model-only/codemode/deferred/hidden. `annotations`: readOnlyHint/destructiveHint/idempotentHint/openWorldHint.
- `withFileMutationQueue(path, fn)` for read-modify-write.

## Implementation + verification log

Appended per-extension as work proceeds (see git history + test runs below).
