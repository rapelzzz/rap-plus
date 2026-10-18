/**
 * Autofix for rap-lens.
 *
 * Combines three repair strategies,
 * each with dynamic dependency detection so the tool degrades gracefully:
 *
 *   1. TypeScript codefixes — apply the LanguageService's suggested fixes
 *      (e.g. add missing imports, missing `await`, unreachability) in place.
 *   2. eslint --fix — style/lint auto-repair (only when eslint is present).
 *   3. prettier --write — formatting (only when prettier is present).
 *
 * Pure helpers (applyTextChanges, formatAutofixResults) are unit-tested.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { runSubprocess } from "../_shared/subprocess.ts";
import { TsLanguageService } from "./lsp.ts";

export interface TextChange {
	start: number;
	length: number;
	newText: string;
}

export interface AutofixResult {
	tool: string;
	fixesApplied: number;
	filesChanged: string[];
	notes?: string;
}

/**
 * Pure: apply a set of text changes to a source string. Changes are applied
 * right-to-left (sorted by descending start offset) so earlier spans stay
 * valid. Out-of-range changes are skipped.
 */
export function applyTextChanges(
	source: string,
	changes: readonly TextChange[],
): { result: string; applied: number } {
	const sorted = [...changes].sort((a, b) => b.start - a.start);
	let result = source;
	let applied = 0;
	for (const ch of sorted) {
		if (ch.start < 0 || ch.start + ch.length > result.length) continue;
		result = result.slice(0, ch.start) + ch.newText + result.slice(ch.start + ch.length);
		applied++;
	}
	return { result, applied };
}

/** Pure: format a set of autofix results into a summary. */
export function formatAutofixResults(results: readonly AutofixResult[]): string {
	if (results.length === 0) return "No autofix tools ran.";
	const lines = results.map((r) => {
		const files = r.filesChanged.length > 0 ? ` (${r.filesChanged.length} file${r.filesChanged.length > 1 ? "s" : ""})` : "";
		const note = r.notes ? ` — ${r.notes}` : "";
		return `${r.tool}: ${r.fixesApplied} fix${r.fixesApplied === 1 ? "" : "es"} applied${files}${note}`;
	});
	return lines.join("\n");
}

/** Apply all available TypeScript codefixes to a file, writing the result to disk. */
export function applyTsCodeFixes(svc: TsLanguageService, file: string, cwd: string): AutofixResult {
	const abs = path.resolve(cwd, file);
	const { source } = svc.resolveSnapshot(file);
	if (!source) {
		return { tool: "typescript", fixesApplied: 0, filesChanged: [], notes: "file not found" };
	}
	const service = svc.getService();
	const diags = [...service.getSuggestionDiagnostics(abs), ...service.getSemanticDiagnostics(abs)];
	const formatOptions = ts.getDefaultFormatCodeSettings();
	const preferences: ts.UserPreferences = {};
	const allChanges: TextChange[] = [];
	const seen = new Set<string>();
	let fixesApplied = 0;
	for (const d of diags) {
		if (d.start === undefined || d.length === undefined || d.code === undefined) continue;
		const fixes = service.getCodeFixesAtPosition(abs, d.start, d.start + d.length, [d.code], formatOptions, preferences);
		for (const f of fixes) {
			if (seen.has(f.description)) continue;
			seen.add(f.description);
			for (const fc of f.changes) {
				if (fc.fileName === abs) {
					for (const tc of fc.textChanges) {
						allChanges.push({ start: tc.span.start, length: tc.span.length, newText: tc.newText });
					}
				}
			}
			fixesApplied++;
		}
	}
	if (allChanges.length === 0) {
		return { tool: "typescript", fixesApplied: 0, filesChanged: [], notes: "no applicable codefixes" };
	}
	const { result, applied } = applyTextChanges(source, allChanges);
	if (applied > 0) {
		fs.writeFileSync(abs, result);
	}
	return {
		tool: "typescript",
		fixesApplied,
		filesChanged: applied > 0 ? [file] : [],
		notes: applied > 0 ? undefined : "changes were out of range",
	};
}

/** Detect a formatter/linter binary: local node_modules, then PATH. */
export async function detectFormatter(cwd: string, name: string): Promise<string | null> {
	const local = path.join(cwd, "node_modules", ".bin", name);
	if (fs.existsSync(local)) return local;
	try {
		const r = await runSubprocess(name, ["--version"], { timeoutMs: 5000, maxOutputBytes: 4096 });
		if (r.exitCode === 0) return name;
	} catch {
		// not on PATH
	}
	return null;
}

/** Run `eslint --fix` on the given paths. */
export async function runEslintFix(
	cwd: string,
	paths: readonly string[],
	signal?: AbortSignal,
): Promise<AutofixResult> {
	const bin = await detectFormatter(cwd, "eslint");
	if (!bin) {
		return { tool: "eslint", fixesApplied: 0, filesChanged: [], notes: "eslint not installed" };
	}
	const r = await runSubprocess(bin, ["--fix", ...paths], {
		cwd,
		signal,
		timeoutMs: 30000,
		maxOutputBytes: 20480,
	});
	// eslint exits 0 when all fixable issues resolved; non-zero means remaining errors.
	const remaining = r.stderr.trim() || r.stdout.trim();
	return {
		tool: "eslint",
		fixesApplied: r.exitCode === 0 ? paths.length : 0,
		filesChanged: r.exitCode === 0 ? [...paths] : [],
		notes: remaining ? `remaining issues (exit ${r.exitCode})` : undefined,
	};
}

/** Run `prettier --write` on the given paths. */
export async function runPrettierWrite(
	cwd: string,
	paths: readonly string[],
	signal?: AbortSignal,
): Promise<AutofixResult> {
	const bin = await detectFormatter(cwd, "prettier");
	if (!bin) {
		return { tool: "prettier", fixesApplied: 0, filesChanged: [], notes: "prettier not installed" };
	}
	const r = await runSubprocess(bin, ["--write", ...paths], {
		cwd,
		signal,
		timeoutMs: 30000,
		maxOutputBytes: 20480,
	});
	const changed: string[] = [];
	for (const line of r.stdout.split("\n")) {
		const m = line.match(/^(.+?)\s+\d+ms$/);
		if (m) changed.push(m[1].trim());
	}
	return {
		tool: "prettier",
		fixesApplied: changed.length,
		filesChanged: changed,
		notes: r.exitCode === 0 ? undefined : `exit ${r.exitCode}`,
	};
}
