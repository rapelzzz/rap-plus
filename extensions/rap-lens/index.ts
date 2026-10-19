/**
 * rap-lens — code diagnostics, LSP navigation, structural search & autofix.
 *
 * Ships the full surface:
 *   - TypeScript type-checking (`tsc --noEmit`) + multi-compiler/linter parsing
 *   - Triage tool (`lens_diagnostic_mark`)
 *   - LSP navigation: goto-definition, find-references, hover
 *   - Symbol discovery: symbol_search, module_report, read_symbol
 *   - Structural search/replace via ast-grep (`lens_ast_grep`)
 *   - Autofix: TS codefixes + eslint --fix + prettier --write
 *   - `/rap-lens-map` HTML module-map generator
 *
 * Commands/tools:
 *   /rap-lens          — run available diagnostics (tsc) and report.
 *   /rap-lens-map      — generate an HTML module map of the project.
 *   lens_diagnostic_mark        (tool) — triage a finding.
 *   lens_goto_definition        (tool, RO) — LSP goto definition.
 *   lens_find_references        (tool, RO) — LSP find references.
 *   lens_hover                  (tool, RO) — LSP hover/type info.
 *   lens_symbol_search          (tool, RO) — search symbols by name.
 *   lens_module_report          (tool, RO) — outline a file's symbols.
 *   lens_read_symbol            (tool, RO) — read a symbol's source.
 *   lens_ast_grep               (tool, RO) — structural search.
 *   lens_ast_grep_replace       (tool)     — structural in-place rewrite.
 *   lens_autofix                (tool)     — apply TS/eslint/prettier fixes.
 */

import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatDiagnostics, runTypeScriptCheck, detectTools } from "./diagnostics.ts";
import { TriageStore, diagnosticKey, type TriageMark } from "./triage.ts";
import { TsLanguageService, formatNavLocations } from "./lsp.ts";
import { symbolSearch, formatSymbolHits, moduleReport, readSymbol } from "./symbols.ts";
import { detectAstGrep, astGrepSearch, astGrepReplace, formatAstGrepMatches } from "./astgrep.ts";
import { applyTsCodeFixes, runEslintFix, runPrettierWrite, formatAutofixResults } from "./autofix.ts";
import { writeLensMap } from "./lensmap.ts";
import { isPathSafe } from "../_shared/safety.ts";
import * as path from "node:path";

const TriageMarkSchema = StringEnum(["falsePositive", "suppressed", "deferred", "flagFix"] as const, {
	description: "falsePositive = not a real issue; suppressed = silenced in source; deferred = fix later; flagFix = must fix.",
});

export default function rapLens(pi: ExtensionAPI): void {
	const triage = new TriageStore();

	// Per-project LanguageService cache (creation scans the project, ~1s).
	let svcCache: { cwd: string; svc: TsLanguageService | null } | null = null;
	function getService(cwd: string): TsLanguageService | null {
		if (!svcCache || svcCache.cwd !== cwd) {
			svcCache = { cwd, svc: TsLanguageService.create(cwd) };
		}
		return svcCache.svc;
	}

	// Per-project ast-grep binary cache.
	let sgCache: { cwd: string; bin: string | null } | null = null;
	async function getAstGrep(cwd: string): Promise<string | null> {
		if (!sgCache || sgCache.cwd !== cwd) {
			sgCache = { cwd, bin: await detectAstGrep(cwd) };
		}
		return sgCache.bin;
	}

	pi.registerCommand("rap-lens", {
		description: "Run available code diagnostics (TypeScript type-check) and report findings.",
		handler: async (_args, ctx) => {
			const tools = detectTools(ctx.cwd);
			if (!tools.tsc) {
				ctx.ui.notify("rap-lens: no supported tooling detected (need local tsc). Install dependencies first.", "info");
				return;
			}
			const { diagnostics, ran, stderr } = await runTypeScriptCheck(ctx.cwd, ctx.signal);
			if (!ran) {
				ctx.ui.notify("rap-lens: could not run diagnostics.", "error");
				return;
			}
			triage.attachFilePath(path.join(ctx.cwd, ".rap-lens-triage.json"));
			const active = diagnostics.filter((d) => triage.isActive(diagnosticKey(d.file, d.line, d.message)));
			const report = formatDiagnostics(active);
			const triagedOut = diagnostics.length - active.length;
			const suffix = triagedOut > 0 ? `\n\n(${triagedOut} finding${triagedOut > 1 ? "s" : ""} hidden by triage marks)` : "";
			pi.sendMessage(
				{ customType: "rap-lens-report", content: `**rap-lens**\n\n${report}${suffix}\n${stderr ? `\n(tsc stderr: ${stderr.trim().slice(0, 200)})` : ""}`, display: true },
				{ triggerTurn: false },
			);
		},
	});

	pi.registerCommand("rap-lens-map", {
		description: "Generate a self-contained HTML module map of the project (writes lens-map.html).",
		handler: async (args, ctx) => {
			const outFile = args.trim() || "lens-map.html";
			const svc = getService(ctx.cwd);
			const abs = writeLensMap(svc, ctx.cwd, outFile);
			ctx.ui.notify(`rap-lens: module map written to ${path.relative(ctx.cwd, abs)}`, "info");
		},
	});

	// --- LSP navigation tools (read-only) ---

	pi.registerTool({
		name: "lens_goto_definition",
		label: "Lens Goto Definition",
		description: "LSP goto-definition for a TypeScript/JavaScript symbol. Returns the definition file:line:col.",
		parameters: Type.Object({
			file: Type.String({ description: "File containing the symbol (relative or absolute)" }),
			line: Type.Number({ description: "1-based line number of the symbol" }),
			column: Type.Number({ description: "1-based column number of the symbol" }),
		}),
		annotations: { readOnlyHint: true },
		exposure: "model-only",
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const svc = getService(ctx.cwd);
			if (!svc) return textResult("rap-lens: TypeScript LanguageService unavailable (typescript not installed).");
			const defs = svc.getDefinition(params.file, params.line, params.column);
			return textResult(formatNavLocations(defs, ctx.cwd));
		},
	});

	pi.registerTool({
		name: "lens_find_references",
		label: "Lens Find References",
		description: "LSP find-references for a TypeScript/JavaScript symbol across the project.",
		parameters: Type.Object({
			file: Type.String({ description: "File containing the symbol" }),
			line: Type.Number({ description: "1-based line number" }),
			column: Type.Number({ description: "1-based column number" }),
		}),
		annotations: { readOnlyHint: true },
		exposure: "model-only",
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const svc = getService(ctx.cwd);
			if (!svc) return textResult("rap-lens: TypeScript LanguageService unavailable.");
			const refs = svc.getReferences(params.file, params.line, params.column);
			return textResult(`${refs.length} reference(s)\n${formatNavLocations(refs, ctx.cwd)}`);
		},
	});

	pi.registerTool({
		name: "lens_hover",
		label: "Lens Hover",
		description: "LSP hover/type info for a TypeScript/JavaScript symbol at a position.",
		parameters: Type.Object({
			file: Type.String(),
			line: Type.Number(),
			column: Type.Number(),
		}),
		annotations: { readOnlyHint: true },
		exposure: "model-only",
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const svc = getService(ctx.cwd);
			if (!svc) return textResult("rap-lens: TypeScript LanguageService unavailable.");
			const info = svc.getQuickInfo(params.file, params.line, params.column);
			return textResult(info ?? "No type info at this position.");
		},
	});

	// --- symbol discovery tools (read-only) ---

	pi.registerTool({
		name: "lens_symbol_search",
		label: "Lens Symbol Search",
		description: "Search symbols by name across the project (functions, classes, types). Uses the TS LanguageService; falls back to regex.",
		parameters: Type.Object({
			query: Type.String({ description: "Symbol name (or substring) to search for" }),
		}),
		annotations: { readOnlyHint: true },
		exposure: "model-only",
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const svc = getService(ctx.cwd);
			const hits = symbolSearch(svc, params.query, ctx.cwd);
			return textResult(formatSymbolHits(hits, ctx.cwd));
		},
	});

	pi.registerTool({
		name: "lens_module_report",
		label: "Lens Module Report",
		description: "Outline the top-level symbols of a file (classes, functions, types) with line numbers.",
		parameters: Type.Object({
			file: Type.String({ description: "File to outline" }),
		}),
		annotations: { readOnlyHint: true },
		exposure: "model-only",
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const svc = getService(ctx.cwd);
			return textResult(moduleReport(svc, params.file, ctx.cwd));
		},
	});

	pi.registerTool({
		name: "lens_read_symbol",
		label: "Lens Read Symbol",
		description: "Read a symbol's name, type, and source text at a position.",
		parameters: Type.Object({
			file: Type.String(),
			line: Type.Number(),
			column: Type.Number(),
		}),
		annotations: { readOnlyHint: true },
		exposure: "model-only",
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const svc = getService(ctx.cwd);
			const sym = readSymbol(svc, params.file, params.line, params.column, ctx.cwd);
			if (!sym) return textResult("No symbol at this position (or LanguageService unavailable).");
			return textResult(`name: ${sym.name}\ntype: ${sym.type}\nsource: ${sym.source}`);
		},
	});

	// --- ast-grep structural search/replace ---

	pi.registerTool({
		name: "lens_ast_grep",
		label: "Lens ast-grep Search",
		description: "Structural code search via ast-grep. Pattern uses ast-grep syntax with metavariables, e.g. `console.log($ARGS)`.",
		parameters: Type.Object({
			pattern: Type.String({ description: "ast-grep pattern, e.g. `console.log($ARGS)`" }),
			paths: Type.Array(Type.String(), { description: "Files/dirs to search (relative to cwd)" }),
			language: Type.Optional(Type.String({ description: "Optional language hint, e.g. typescript" })),
		}),
		annotations: { readOnlyHint: true },
		exposure: "model-only",
		async execute(_id, params, signal, _onUpdate, ctx) {
			const bin = await getAstGrep(ctx.cwd);
			if (!bin) return textResult("rap-lens: ast-grep not installed. Run `npm install --no-save @ast-grep/cli`.");
			if (params.paths.length === 0) return textResult("No paths provided.");
			const pathErr = validatePaths(ctx.cwd, params.paths);
			if (pathErr) return textResult(pathErr);
			try {
				const matches = await astGrepSearch(bin, params.pattern, params.paths, {
					cwd: ctx.cwd,
					lang: params.language,
					signal,
				});
				const hint = matches.length === 0 ? "\n(0 matches — also double-check pattern syntax; ast-grep silently rejects some invalid patterns)" : "";
				return textResult(`${matches.length} match(es)\n${formatAstGrepMatches(matches, ctx.cwd)}${hint}`);
			} catch (e) {
				return textResult(`rap-lens ast-grep search failed: ${(e as Error).message}`);
			}
		},
	});

	pi.registerTool({
		name: "lens_ast_grep_replace",
		label: "Lens ast-grep Replace",
		description: "Structural in-place rewrite via ast-grep. MUTATING. Use named metavariables in both pattern and replacement, e.g. pattern `console.log($ARGS)`, replacement `console.warn($ARGS)`.",
		parameters: Type.Object({
			pattern: Type.String({ description: "ast-grep pattern" }),
			replacement: Type.String({ description: "Rewrite template using the same metavariables" }),
			paths: Type.Array(Type.String(), { description: "Files/dirs to rewrite (relative to cwd)" }),
			language: Type.Optional(Type.String()),
		}),
		annotations: { readOnlyHint: false },
		exposure: "model-only",
		async execute(_id, params, signal, _onUpdate, ctx) {
			const bin = await getAstGrep(ctx.cwd);
			if (!bin) return textResult("rap-lens: ast-grep not installed.");
			if (params.paths.length === 0) return textResult("No paths provided.");
			const pathErr = validatePaths(ctx.cwd, params.paths);
			if (pathErr) return textResult(pathErr);
			try {
				const res = await astGrepReplace(bin, params.pattern, params.replacement, params.paths, {
					cwd: ctx.cwd,
					lang: params.language,
					signal,
				});
				return textResult(`ast-grep replace: ${res.changed} file(s) changed.`);
			} catch (e) {
				return textResult(`rap-lens ast-grep replace failed: ${(e as Error).message}`);
			}
		},
	});

	// --- autofix (mutating) ---

	pi.registerTool({
		name: "lens_autofix",
		label: "Lens Autofix",
		description: "Apply automatic fixes to a file: TypeScript codefixes (e.g. missing imports), then eslint --fix, then prettier --write. MUTATING. Each tool runs only if installed.",
		parameters: Type.Object({
			file: Type.String({ description: "File to fix (relative to cwd)" }),
		}),
		annotations: { readOnlyHint: false },
		exposure: "model-only",
		async execute(_id, params, signal, _onUpdate, ctx) {
			const pathErr = validatePaths(ctx.cwd, [params.file]);
			if (pathErr) return textResult(pathErr);
			try {
				const svc = getService(ctx.cwd);
				const results = [];
				if (svc) {
					results.push(applyTsCodeFixes(svc, params.file, ctx.cwd));
				} else {
					results.push({ tool: "typescript", fixesApplied: 0, filesChanged: [], notes: "LanguageService unavailable" });
				}
				results.push(await runEslintFix(ctx.cwd, [params.file], signal));
				results.push(await runPrettierWrite(ctx.cwd, [params.file], signal));
				return textResult(formatAutofixResults(results));
			} catch (e) {
				return textResult(`rap-lens autofix failed: ${(e as Error).message}`);
			}
		},
	});

	pi.registerTool({
		name: "lens_diagnostic_mark",
		label: "Lens Mark",
		description:
			"Mark a diagnostic finding as falsePositive, suppressed, deferred, or flagFix. Marked false-positive/suppressed findings are hidden from /lens reports.",
		parameters: Type.Object({
			file: Type.String({ description: "File path of the finding" }),
			line: Type.Number({ description: "Line number of the finding" }),
			message: Type.String({ description: "The finding message (or its prefix) to identify it" }),
			mark: TriageMarkSchema,
			reason: Type.Optional(Type.String({ description: "Why this mark was applied" })),
		}),
		annotations: { readOnlyHint: false },
		exposure: "model-only",
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const key = diagnosticKey(params.file, params.line, params.message);
			triage.attachFilePath(path.join(ctx.cwd, ".rap-lens-triage.json"));
			triage.mark(params.mark as TriageMark, key, params.reason ?? "");
			return textResult(`Marked ${params.file}:${params.line} as ${params.mark}${params.reason ? ` (${params.reason})` : ""}. Use /rap-lens to see remaining findings.`);
		},
	});
}

function textResult(text: string): {
	content: { type: "text"; text: string }[];
	details: undefined;
} {
	return { content: [{ type: "text", text }], details: undefined };
}

/** Validate that every path resolves inside the project root. Returns an error string or null. */
export function validatePaths(cwd: string, paths: readonly string[]): string | null {
	for (const p of paths) {
		if (!isPathSafe(cwd, p)) {
			return `Refusing: path escapes project root: ${p}`;
		}
	}
	return null;
}
