/**
 * rap-agent-ide — guarded IDE-style assistance (focused subset).
 *
 * Behavioral target: `pi-agent-ide` (alexshpunt, MIT). Ships a FOCUSED SUBSET:
 * guarded editing (safety-validated write with interactive confirm), code
 * search (ripgrep), and diff inspection (git diff per path). The full surface
 * (terminals, debugging, observability, LSP) is NOT implemented — see
 * research/feature-parity.md.
 *
 * Tools (all model-only):
 *   ide_search        — ripgrep code search (read-only).
 *   ide_diff          — git diff for a path (read-only).
 *   ide_edit_guarded  — write/edit a file with safety validation + confirm.
 */

import { Type } from "typebox";
import * as fs from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isSensitivePath, relFrom, validateEdit, validateEditTarget } from "./guard.ts";
import { formatHits, runSearch } from "./search.ts";
import { runSubprocess } from "../_shared/subprocess.ts";

export default function rapAgentIde(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "ide_search",
		label: "IDE Search",
		description: "Search project code with ripgrep (regex). Returns file:line:column:match hits. Read-only.",
		parameters: Type.Object({
			pattern: Type.String({ description: "Regex pattern to search for" }),
			case_sensitive: Type.Optional(Type.Boolean({ description: "Case-sensitive match (default false)" })),
			whole_word: Type.Optional(Type.Boolean({ description: "Match whole words only (default false)" })),
			glob: Type.Optional(Type.String({ description: "Glob filter, e.g. '*.ts'" })),
			max_results: Type.Optional(Type.Number({ description: "Max hits to return" })),
		}),
		annotations: { readOnlyHint: true },
		exposure: "model-only",

		async execute(_id, params, signal, _onUpdate, ctx) {
			const { hits, ran, error } = await runSearch(
				ctx.cwd,
				params.pattern,
				{
					caseSensitive: params.case_sensitive,
					wholeWord: params.whole_word,
					glob: params.glob,
					maxResults: params.max_results,
				},
				signal,
			);
			if (!ran) {
				return { content: [{ type: "text", text: `Search unavailable: ${error || "ripgrep not found"}` }], details: undefined };
			}
			return { content: [{ type: "text", text: formatHits(hits) }], details: undefined };
		},
	});

	pi.registerTool({
		name: "ide_diff",
		label: "IDE Diff",
		description: "Show the git diff for a given file path (working tree vs HEAD). Read-only.",
		parameters: Type.Object({
			file_path: Type.String({ description: "File path to diff" }),
			staged: Type.Optional(Type.Boolean({ description: "Diff staged changes (default false)" })),
		}),
		annotations: { readOnlyHint: true },
		exposure: "model-only",

		async execute(_id, params, signal, _onUpdate, ctx) {
			if (isSensitivePath(ctx.cwd, params.file_path)) {
				return { content: [{ type: "text", text: "Refusing to diff a sensitive path." }], details: undefined };
			}
			const r = await runSubprocess(
				"git",
				["diff", ...(params.staged ? ["--staged"] : []), "--", params.file_path],
				{ cwd: ctx.cwd, signal, maxOutputBytes: 100 * 1024, redact: false },
			);
			const diff = r.stdout.trim();
			return {
				content: [{ type: "text", text: diff ? diff : `No changes for ${params.file_path}.` }],
				details: undefined,
			};
		},
	});

	pi.registerTool({
		name: "ide_edit_guarded",
		label: "IDE Guarded Edit",
		description:
			"Write or edit a file with safety validation: path must be within the project root, sensitive paths (.env, credentials, SSH keys) are blocked, size limits enforced, and the user is asked to confirm before applying. Use this for safer edits.",
		parameters: Type.Object({
			file_path: Type.String({ description: "File path to write/edit" }),
			content: Type.Optional(Type.String({ description: "Full new file content (write mode)" })),
			old_text: Type.Optional(Type.String({ description: "Existing text to replace (edit mode)" })),
			new_text: Type.Optional(Type.String({ description: "Replacement text (edit mode)" })),
		}),
		annotations: { readOnlyHint: false },
		exposure: "model-only",

		async execute(_id, params, signal, _onUpdate, ctx) {
			// Edit mode if old_text/new_text provided; else write mode.
			const isEdit = params.old_text !== undefined && params.new_text !== undefined;
			let guard;
			if (isEdit) {
				guard = validateEdit(ctx.cwd, params.file_path, params.old_text ?? "", params.new_text ?? "");
			} else {
				guard = validateEditTarget(ctx.cwd, params.file_path, params.content ?? "");
			}
			if (!guard.ok) {
				return { content: [{ type: "text", text: `Blocked: ${guard.reason}` }], details: undefined };
			}
			const abs = guard.absPath!;

			// Interactive confirmation gate (when UI available).
			if (ctx.ui?.confirm) {
				const verb = isEdit ? "edit" : "write";
				const ok = await ctx.ui.confirm(
					"rap-agent-ide",
					`${verb} ${relFrom(ctx.cwd, abs)}?`,
				);
				if (!ok) {
					return { content: [{ type: "text", text: "Edit cancelled by user." }], details: undefined };
				}
			}

			try {
				if (isEdit) {
					const existing = await fs.readFile(abs, "utf8");
					if (!existing.includes(params.old_text!)) {
						return {
							content: [{ type: "text", text: "old_text not found in file; edit aborted (no changes)." }],
							details: undefined,
						};
					}
					const updated = existing.replace(params.old_text!, params.new_text!);
					await fs.writeFile(abs, updated, "utf8");
					return {
						content: [{ type: "text", text: `Edited ${relFrom(ctx.cwd, abs)} (${Buffer.byteLength(params.new_text!, "utf8")} bytes inserted).` }],
						details: undefined,
					};
				} else {
					await fs.writeFile(abs, params.content ?? "", "utf8");
					return {
						content: [{ type: "text", text: `Wrote ${relFrom(ctx.cwd, abs)} (${Buffer.byteLength(params.content ?? "", "utf8")} bytes).` }],
						details: undefined,
					};
				}
			} catch (err) {
				return {
					content: [{ type: "text", text: `Edit failed: ${err instanceof Error ? err.message : String(err)}` }],
					details: undefined,
					isError: true,
				};
			}
		},
	});
}
