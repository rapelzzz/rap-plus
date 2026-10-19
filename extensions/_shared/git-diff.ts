/**
 * Shared git-diff parsing for rap-simplify & rap-code-review.
 *
 * Parses unified `git diff` output into changed files + new-file line ranges,
 * and parses the common `--staged / --ref=<branch> / files` option form used by
 * both `/rap-simplify` and `/rap-review`. Pure (no Pi imports) → unit-testable.
 */

export interface Hunk {
	/** 1-based start line in the NEW (post-change) file. */
	newStart: number;
	/** Number of lines in the NEW file covered by this hunk. */
	newLen: number;
}

export interface ChangedFile {
	path: string;
	hunks: Hunk[];
}

export interface DiffArgs {
	staged: boolean;
	ref: string | undefined;
	files: string[];
}

/**
 * Parse unified `git diff` output into changed files + new-file hunk ranges.
 * Robust to binary diffs and renames (skips entries it cannot map to a path).
 */
export function parseGitDiff(diff: string): ChangedFile[] {
	const files: ChangedFile[] = [];
	let current: ChangedFile | null = null;
	for (const line of diff.split("\n")) {
		const plusMatch = line.match(/^\+\+\+ b\/(.+)$/);
		if (plusMatch) {
			if (current) files.push(current);
			current = { path: plusMatch[1], hunks: [] };
			continue;
		}
		if (!current) continue;
		const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
		if (hunkMatch) {
			const newStart = Number.parseInt(hunkMatch[1], 10);
			const newLen = hunkMatch[2] !== undefined ? Number.parseInt(hunkMatch[2], 10) : 1;
			if (Number.isFinite(newStart)) {
				current.hunks.push({ newStart, newLen: Number.isFinite(newLen) ? newLen : 1 });
			}
		}
	}
	if (current) files.push(current);
	return files.filter((f) => f.path && f.path !== "/dev/null");
}

/** Accept only branch-like refs; option-looking strings must never reach git as a revision. */
export function isSafeDiffRef(ref: string): boolean {
	if (!ref || ref.startsWith("-") || ref.startsWith("/") || ref.endsWith("/") || ref.endsWith(".") || ref.endsWith(".lock")) return false;
	if (ref.includes("..") || ref.includes("@{") || ref.includes("//") || ref.includes("\\\\") || ref.includes(":")) return false;
	if (ref.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".") || part.endsWith(".lock"))) return false;
	return /^[A-Za-z0-9._/-]+$/.test(ref);
}

/** Parse the `--staged / --ref=<branch> / files` option form. */
export function parseDiffArgs(argv: string[]): DiffArgs {
	const args: DiffArgs = { staged: false, ref: undefined, files: [] };
	for (const tok of argv) {
		if (tok === "--staged" || tok === "--cached") args.staged = true;
		else if (tok.startsWith("--ref=")) {
			const ref = tok.slice("--ref=".length);
			if (!isSafeDiffRef(ref)) throw new Error("Invalid --ref branch name; use a valid branch name without option prefixes.");
			args.ref = ref;
		} else if (tok.startsWith("--")) {
			// Unknown options are ignored rather than forwarded to git.
		} else args.files.push(tok);
	}
	return args;
}

/** Build the `git diff` argument list for the given options (tight ranges via -U0). */
export function buildDiffArgs(args: DiffArgs): string[] {
	const out: string[] = ["--no-ext-diff", "--no-color", "-U0"];
	if (args.staged) out.push("--cached");
	if (args.ref) {
		if (!isSafeDiffRef(args.ref)) throw new Error("Invalid --ref branch name.");
		out.push(args.ref);
	}
	if (args.files.length > 0) {
		out.push("--");
		out.push(...args.files);
	}
	return out;
}

/** Format changed files + ranges into a human-readable summary. */
export function formatChangedFiles(files: ChangedFile[]): string {
	if (files.length === 0) return "(no changes detected)";
	return files
		.map((f) => {
			const ranges = f.hunks
				.map((h) => (h.newLen > 1 ? `L${h.newStart}-${h.newStart + h.newLen - 1}` : `L${h.newStart}`))
				.join(", ");
			return `- ${f.path} (${ranges})`;
		})
		.join("\n");
}
