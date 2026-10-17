/**
 * Shared safety utilities for rap-* extensions.
 *
 * Pure (no Pi imports) so it is unit-testable with `node --test` and type
 * stripping. Path validation, secret redaction, and severity helpers.
 */

import { resolve, relative, sep, isAbsolute } from "node:path";

/** Review/severity ordering from most to least severe. */
export const SEVERITY_LEVELS = ["critical", "high", "medium", "info"] as const;
export type Severity = (typeof SEVERITY_LEVELS)[number];

/** Parse a free-form severity string into a canonical Severity (case-insensitive). */
export function parseSeverity(value: string | undefined | null): Severity {
	if (!value) return "info";
	const v = value.trim().toLowerCase();
	if (v.startsWith("crit")) return "critical";
	if (v.startsWith("high") || v === "error") return "high";
	if (v.startsWith("med") || v === "warn" || v === "warning") return "medium";
	return "info";
}

/** Rank a severity (higher = more severe). Useful for sorting/dedup. */
export function severityRank(s: Severity): number {
	return (SEVERITY_LEVELS.length - 1) - SEVERITY_LEVELS.indexOf(s);
}

/**
 * Resolve `target` against `cwd` and verify the result stays inside `cwd`.
 * Blocks directory traversal (`..`) and absolute escapes outside the root.
 * Returns the absolute, normalized path or throws.
 */
export function resolveWithin(cwd: string, target: string): string {
	if (!target || typeof target !== "string") {
		throw new Error("Path must be a non-empty string");
	}
	const abs = resolve(cwd, target);
	const rel = relative(cwd, abs);
	// A relative path of ".." or starting with ".." escapes cwd. On Windows a
	// different drive letter makes `rel` absolute and not start with "..".
	if (rel === ".." || rel.startsWith(`..${sep}`) || (rel && isAbsolute(rel) && rel !== abs)) {
		throw new Error(`Path escapes project root: ${target}`);
	}
	return abs;
}

/** True when `target` resolves inside `cwd` (non-throwing variant of resolveWithin). */
export function isPathSafe(cwd: string, target: string): boolean {
	try {
		resolveWithin(cwd, target);
		return true;
	} catch {
		return false;
	}
}

// Heuristic secret patterns. Intentionally conservative; extensions should also
// avoid logging credential-bearing values in the first place.
const SECRET_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
	{ re: /(sk-ant-[A-Za-z0-9_-]{20,})/g, label: "[REDACTED:anthropic]" },
	{ re: /(sk-[A-Za-z0-9]{20,})/g, label: "[REDACTED:openai]" },
	{ re: /(ghp_[A-Za-z0-9]{30,})/g, label: "[REDACTED:github_pat]" },
	{ re: /(github_pat_[A-Za-z0-9_]{20,})/g, label: "[REDACTED:github_pat]" },
	{ re: /(AKIA[0-9A-Z]{16})/g, label: "[REDACTED:aws_keyid]" },
	{ re: /(-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----)/g, label: "[REDACTED:private_key]" },
	{ re: /([A-Za-z0-9_-]*password[A-Za-z0-9_-]*\s*[:=]\s*)("[^"]{4,}"|'[^']{4,}'|[^\s"'&]{8,})/gi, label: "$1[REDACTED:password]" },
];

/**
 * Redact common credential patterns from a string. Returns the redacted text.
 * Used before logging tool output or subprocess stderr.
 */
export function redactSecrets(input: string): string {
	let out = input;
	for (const { re, label } of SECRET_PATTERNS) {
		if (label.includes("$1")) {
			out = out.replace(re, label);
		} else {
			out = out.replace(re, label);
		}
	}
	return out;
}

/** Cap a string to `maxBytes` (UTF-8). If truncated, appends a notice and
 * reserves space for it so the result never exceeds `maxBytes`. */
export function truncateToBytes(input: string, maxBytes: number): string {
	const byteLength = Buffer.byteLength(input, "utf8");
	if (byteLength <= maxBytes) return input;
	const notice = `\n\n[truncated: ${byteLength - maxBytes} bytes omitted]`;
	const noticeBytes = Buffer.byteLength(notice, "utf8");
	let budget = Math.max(0, maxBytes - noticeBytes);
	let truncated = input.slice(0, budget);
	while (Buffer.byteLength(truncated, "utf8") > budget) truncated = truncated.slice(0, -1);
	return `${truncated}${notice}`;
}

/** Deduplicate findings by a stable key function (keeps first occurrence). */
export function dedupeBy<T>(items: readonly T[], keyFn: (item: T) => string): T[] {
	const seen = new Set<string>();
	const out: T[] = [];
	for (const item of items) {
		const k = keyFn(item);
		if (!seen.has(k)) {
			seen.add(k);
			out.push(item);
		}
	}
	return out;
}
