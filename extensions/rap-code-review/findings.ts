/**
 * Finding parsing/formatting for rap-code-review.
 *
 * Reuses shared Severity helpers. The model is asked to emit a JSON array of
 * findings; this module parses it robustly (extracts the first JSON array) and
 * falls back to a tolerant line scan. Pure (no Pi imports) → unit-testable.
 */

import { dedupeBy, parseSeverity, severityRank, type Severity } from "../_shared/safety.ts";

export interface Finding {
	severity: Severity;
	file: string;
	line: number;
	message: string;
	suggestion: string;
}

const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "info"];

interface RawFinding {
	severity?: unknown;
	file?: unknown;
	line?: unknown;
	message?: unknown;
	suggestion?: unknown;
}

/** Coerce a raw parsed object into a Finding (defaults info/line 0). */
function coerce(raw: RawFinding): Finding {
	const lineNum = typeof raw.line === "number" ? raw.line : Number.parseInt(String(raw.line ?? "0"), 10);
	return {
		severity: parseSeverity(typeof raw.severity === "string" ? raw.severity : "info"),
		file: typeof raw.file === "string" && raw.file ? raw.file : "(unknown)",
		line: Number.isFinite(lineNum) && lineNum > 0 ? lineNum : 0,
		message: typeof raw.message === "string" ? raw.message : "",
		suggestion: typeof raw.suggestion === "string" ? raw.suggestion : "",
	};
}

/** Extract the first balanced JSON array substring from arbitrary text. */
export function extractJsonArray(text: string): string | null {
	const start = text.indexOf("[");
	if (start === -1) return null;
	let depth = 0;
	let inStr = false;
	let esc = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inStr) {
			if (esc) esc = false;
			else if (ch === "\\") esc = true;
			else if (ch === '"') inStr = false;
			continue;
		}
		if (ch === '"') inStr = true;
		else if (ch === "[") depth++;
		else if (ch === "]") {
			depth--;
			if (depth === 0) return text.slice(start, i + 1);
		}
	}
	return null;
}

/** Parse model output into Finding[] (JSON array first; tolerant fallback). */
export function parseFindings(text: string): Finding[] {
	const json = extractJsonArray(text);
	if (json) {
		try {
			const arr = JSON.parse(json);
			if (Array.isArray(arr)) {
				return arr
					.filter((r): r is RawFinding => r && typeof r === "object")
					.map(coerce)
					.filter((f) => f.message);
			}
		} catch {
			/* fall through */
		}
	}
	// Tolerant fallback: "severity | file:line | message" lines.
	const out: Finding[] = [];
	for (const line of text.split("\n")) {
		const m = line.match(/^\s*(critical|high|medium|info|warn|error)\s*[\|:\-]\s*([^:\s]+):(\d+)\s*[\|:\-]\s*(.+)$/i);
		if (m) {
			out.push({
				severity: parseSeverity(m[1]),
				file: m[2],
				line: Number.parseInt(m[3], 10),
				message: m[4].trim(),
				suggestion: "",
			});
		}
	}
	return out;
}

/** Format findings into a severity-grouped report with counts. */
export function formatFindingsReport(findings: readonly Finding[]): string {
	const deduped = dedupeBy(findings, (f) => `${f.severity}|${f.file}|${f.line}|${f.message}`);
	if (deduped.length === 0) return "No issues found. ✓";
	const counts = { critical: 0, high: 0, medium: 0, info: 0 };
	for (const f of deduped) counts[f.severity]++;
	const header = SEVERITY_ORDER.filter((s) => counts[s] > 0)
		.map((s) => `${counts[s]} ${s.toUpperCase()}`)
		.join(" · ");
	const lines: string[] = [`Code Review — ${header}`, ""];
	for (const sev of SEVERITY_ORDER) {
		const group = deduped.filter((f) => f.severity === sev);
		if (group.length === 0) continue;
		lines.push(`## ${sev.toUpperCase()} (${group.length})`);
		for (const f of group) {
			const loc = f.line > 0 ? `${f.file}:${f.line}` : f.file;
			lines.push(`- ${loc} — ${f.message}`);
			if (f.suggestion) lines.push(`    ↳ ${f.suggestion}`);
		}
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}

/** Sort findings by severity (most severe first), stable within equal severity. */
export function sortBySeverity(findings: readonly Finding[]): Finding[] {
	return [...findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}
