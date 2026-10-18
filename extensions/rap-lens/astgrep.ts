/**
 * ast-grep structural search/replace wrapper for rap-lens.
 *
 * Detects the ast-grep
 * binary dynamically (local node_modules, then PATH), with a guard that
 * rejects the system `sg` (newgrp) command which is NOT ast-grep. Runs
 * structural search (`--json=compact`) and in-place rewrite (`--update-all`).
 *
 * Pure helpers (parse/format) are exported for unit testing.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runSubprocess, runText } from "../_shared/subprocess.ts";

export interface AstGrepMatch {
	file: string;
	line: number; // 1-based
	column: number; // 1-based
	endLine: number;
	endColumn: number;
	text: string;
	language: string;
}

/** Pure: parse ast-grep `--json=compact` stdout into matches (1-based line/col). */
export function parseAstGrepJson(stdout: string): AstGrepMatch[] {
	const trimmed = stdout.trim();
	if (!trimmed) return [];
	let arr: unknown;
	try {
		arr = JSON.parse(trimmed);
	} catch {
		return [];
	}
	if (!Array.isArray(arr)) return [];
	const out: AstGrepMatch[] = [];
	for (const raw of arr) {
		const m = raw as {
			text?: string;
			file?: string;
			language?: string;
			range?: { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } };
		};
		if (!m || !m.range) continue;
		out.push({
			file: m.file ?? "",
			line: (m.range.start?.line ?? 0) + 1,
			column: (m.range.start?.column ?? 0) + 1,
			endLine: (m.range.end?.line ?? 0) + 1,
			endColumn: (m.range.end?.column ?? 0) + 1,
			text: m.text ?? "",
			language: m.language ?? "",
		});
	}
	return out;
}

/** Pure: format matches into a readable list. */
export function formatAstGrepMatches(matches: readonly AstGrepMatch[], cwd: string): string {
	if (matches.length === 0) return "No structural matches.";
	return matches
		.map((m) => {
			const rel = path.relative(cwd, m.file) || m.file;
			return `${rel}:${m.line}:${m.column}  ${m.text}`;
		})
		.join("\n");
}

/**
 * Detect the ast-grep binary. Resolution order:
 *   1. <cwd>/node_modules/.bin/ast-grep (local dev dep)
 *   2. `ast-grep` on PATH (version output must contain "ast-grep")
 *   3. `sg` on PATH — ONLY if its version output contains "ast-grep"
 *      (the system /usr/bin/sg is newgrp, which is NOT ast-grep)
 * Returns null when ast-grep is unavailable.
 */
export async function detectAstGrep(cwd: string): Promise<string | null> {
	const local = path.join(cwd, "node_modules", ".bin", "ast-grep");
	if (fs.existsSync(local)) {
		if (await isAstGrep(local)) return local;
	}
	if (await isAstGrep("ast-grep")) return "ast-grep";
	if (await isAstGrep("sg")) return "sg";
	return null;
}

async function isAstGrep(bin: string): Promise<boolean> {
	try {
		const out = await runText(bin, ["--version"], { timeoutMs: 5000, maxOutputBytes: 4096 });
		return out.toLowerCase().includes("ast-grep");
	} catch {
		return false;
	}
}

/** Structural search. `paths` are file/dir arguments; `lang` optional (e.g. typescript). */
export async function astGrepSearch(
	bin: string,
	pattern: string,
	paths: readonly string[],
	opts: { cwd?: string; lang?: string; signal?: AbortSignal } = {},
): Promise<AstGrepMatch[]> {
	const args = ["run", "-p", pattern];
	if (opts.lang) args.push("--lang", opts.lang);
	args.push("--json=compact");
	for (const p of paths) args.push(p);
	const r = await runSubprocess(bin, args, {
		cwd: opts.cwd,
		signal: opts.signal,
		timeoutMs: 30000,
		maxOutputBytes: 102400,
	});
	// ast-grep exits 0 with matches; non-zero on no-match or error. JSON is the source of truth.
	return parseAstGrepJson(r.stdout);
}

/** Structural in-place rewrite. Returns the number of files changed. */
export async function astGrepReplace(
	bin: string,
	pattern: string,
	replacement: string,
	paths: readonly string[],
	opts: { cwd?: string; lang?: string; signal?: AbortSignal } = {},
): Promise<{ changed: number }> {
	const args = ["run", "-p", pattern, "-r", replacement];
	if (opts.lang) args.push("--lang", opts.lang);
	args.push("--update-all");
	for (const p of paths) args.push(p);
	const r = await runSubprocess(bin, args, {
		cwd: opts.cwd,
		signal: opts.signal,
		timeoutMs: 30000,
		maxOutputBytes: 4096,
	});
	// Parse "Applied N changes" from stderr (ast-grep writes progress to stderr).
	const m = r.stderr.match(/Applied\s+(\d+)\s+changes?/i) || r.stdout.match(/Applied\s+(\d+)\s+changes?/i);
	const changed = m ? Number(m[1]) : 0;
	return { changed };
}
