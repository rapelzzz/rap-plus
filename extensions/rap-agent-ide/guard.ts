/**
 * Guarded-edit policy for rap-agent-ide.
 *
 * "Guarded editing" — edits are validated against a safety policy before
 * being applied: path must resolve
 * within the project root, sensitive paths are blocked, size limits enforced,
 * and destructive content (emptying/overwriting large files) is flagged.
 *
 * Pure (node builtins + shared safety) → unit-testable.
 */

import * as path from "node:path";
import { isPathSafe, resolveWithin } from "../_shared/safety.ts";

export interface GuardResult {
	ok: boolean;
	reason?: string;
	absPath?: string;
}

/** Validate the shape of guarded write/edit arguments before any file is touched. */
export function validateEditInputShape(input: {
	old_text?: string;
	new_text?: string;
	content?: string;
}): string | null {
	const hasOldText = input.old_text !== undefined;
	const hasNewText = input.new_text !== undefined;
	if (hasOldText !== hasNewText || (hasOldText && input.content !== undefined)) {
		return "provide both old_text and new_text for edit mode, or content alone for write mode.";
	}
	if (hasOldText && input.old_text === "") {
		return "old_text must not be empty.";
	}
	if (!hasOldText && input.content === undefined) {
		return "content is required for write mode; no file was changed.";
	}
	return null;
}

/** Paths that must never be edited by a guarded tool. */
const SENSITIVE_PATTERNS = [
	/(^|\/)\.git(\/|$)/i,
	/\/\.env(\..*)?$/i,
	/\/\.ssh\//i,
	/\/\.aws\//i,
	/\/credentials(\..*)?$/i,
	/\/\.npmrc$/i,
	/\/\.pypirc$/i,
	/\/\.gitconfig$/i,
	/\/id_(rsa|ed25519|ecdsa)(\.pub)?$/i,
	/\/\.(htaccess|htpasswd)$/i,
];

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB cap on write content
const MAX_EDIT_BYTES = 512 * 1024; // 512 KB cap on a single edit

/** Validate an edit/write target against the safety policy. */
export function validateEditTarget(cwd: string, filePath: string, content: string): GuardResult {
	if (!isPathSafe(cwd, filePath)) {
		return { ok: false, reason: `Refusing to edit outside project root: ${filePath}` };
	}
	const abs = resolveWithin(cwd, filePath);
	const normalizedAbs = abs.replace(/\\/g, "/");
	for (const re of SENSITIVE_PATTERNS) {
		if (re.test(normalizedAbs)) {
			return { ok: false, reason: `Refusing to edit sensitive path: ${abs}` };
		}
	}
	const bytes = Buffer.byteLength(content, "utf8");
	if (bytes > MAX_FILE_BYTES) {
		return { ok: false, reason: `Content too large (${bytes} bytes > ${MAX_FILE_BYTES} cap)` };
	}
	return { ok: true, absPath: abs };
}

/** Validate an in-place edit (old_text → new_text) against size limits. */
export function validateEdit(cwd: string, filePath: string, oldText: string, newText: string): GuardResult {
	const base = validateEditTarget(cwd, filePath, newText);
	if (!base.ok) return base;
	const bytes = Buffer.byteLength(newText, "utf8");
	if (bytes > MAX_EDIT_BYTES) {
		return { ok: false, reason: `Edit too large (${bytes} bytes > ${MAX_EDIT_BYTES} cap)` };
	}
	return base;
}

/** Whether a path looks like a sensitive file (for read-side blocking too). */
export function isSensitivePath(cwd: string, filePath: string): boolean {
	if (!isPathSafe(cwd, filePath)) return true;
	const abs = resolveWithin(cwd, filePath).replace(/\\/g, "/");
	return SENSITIVE_PATTERNS.some((re) => re.test(abs));
}

/** Relative path display (from cwd) for an absolute path, or the abs path. */
export function relFrom(cwd: string, abs: string): string {
	const rel = path.relative(cwd, abs);
	return rel && !rel.startsWith("..") ? rel : abs;
}
