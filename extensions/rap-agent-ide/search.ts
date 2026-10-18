/**
 * Code search (ripgrep wrapper) for rap-agent-ide.
 *
 * Runs `rg` via the shared argument-array subprocess (no shell), parses
 * `rg -n` line output into hits.
 * Pure parsing → unit-testable.
 */

import { runSubprocess } from "../_shared/subprocess.ts";

export interface SearchHit {
	file: string;
	line: number;
	column: number;
	match: string;
}

export interface SearchOptions {
	caseSensitive?: boolean;
	wholeWord?: boolean;
	maxResults?: number;
	glob?: string;
}

/** Parse `rg -n --column` output lines into SearchHit[]. */
export function parseRipgrep(text: string): SearchHit[] {
	const out: SearchHit[] = [];
	for (const line of text.split("\n")) {
		if (!line) continue;
		// format: file:line:column:match   (or file:line:match without --column)
		const m = line.match(/^(.+?):(\d+):(\d+):(.*)$/);
		if (m) {
			out.push({ file: m[1], line: Number.parseInt(m[2], 10), column: Number.parseInt(m[3], 10), match: m[4] });
			continue;
		}
		const m2 = line.match(/^(.+?):(\d+):(.*)$/);
		if (m2) {
			out.push({ file: m2[1], line: Number.parseInt(m2[2], 10), column: 0, match: m2[3] });
		}
	}
	return out;
}

function buildArgs(pattern: string, opts: SearchOptions): string[] {
	const args = ["-n", "--column", "--no-heading", "--color", "never"];
	if (!opts.caseSensitive) args.push("-i");
	if (opts.wholeWord) args.push("-w");
	if (opts.glob) args.push("-g", opts.glob);
	if (opts.maxResults) args.push("-m", String(opts.maxResults));
	args.push("--", pattern);
	return args;
}

/** Run ripgrep and return hits. Returns empty array if rg is unavailable. */
export async function runSearch(
	cwd: string,
	pattern: string,
	opts: SearchOptions,
	signal: AbortSignal | undefined,
): Promise<{ hits: SearchHit[]; ran: boolean; error: string }> {
	const r = await runSubprocess("rg", buildArgs(pattern, opts), {
		cwd,
		signal,
		maxOutputBytes: 200 * 1024,
		redact: false,
	});
	// rg exits 1 when no matches, 2 on error.
	if (r.exitCode === 2) {
		return { hits: [], ran: true, error: r.stderr.trim() || "ripgrep error" };
	}
	if (r.exitCode !== 0 && r.exitCode !== 1) {
		// rg not installed or other failure
		return { hits: [], ran: false, error: r.stderr.trim() || `rg exited ${r.exitCode}` };
	}
	return { hits: parseRipgrep(r.stdout), ran: true, error: "" };
}

/** Format hits into a readable summary. */
export function formatHits(hits: readonly SearchHit[], max = 50): string {
	if (hits.length === 0) return "No matches found.";
	const shown = hits.slice(0, max);
	const lines = shown.map((h) => `${h.file}:${h.line}:${h.column}: ${h.match}`);
	const suffix = hits.length > max ? `\n... (${hits.length - max} more)` : "";
	return `${hits.length} match${hits.length > 1 ? "es" : ""}:\n${lines.join("\n")}${suffix}`;
}
