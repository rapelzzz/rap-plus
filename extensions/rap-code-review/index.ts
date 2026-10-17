/**
 * rap-code-review — automated, language-aware code review.
 *
 * Behavioral parity target: `pi-code-review` (MattDevy, MIT).
 *
 * 1) Automatic review (zero-cost): after each turn where the agent edits files,
 *    a language-aware review checklist is injected into the next turn so the
 *    agent self-reviews before proceeding. Edit tracking via the `tool_result`
 *    event (write/edit), batched at `turn_end`, injected at `before_agent_start`.
 *
 * 2) On-demand `/review`: computes changed files+line ranges via `git diff`,
 *    reads the changed code, and calls the session model
 *    (`ctx.modelRegistry.complete`) for structured, severity-tagged findings
 *    (CRITICAL/HIGH/MEDIUM/INFO). Falls back to a prompt-based review via the
 *    session agent when no model is configured or the call fails.
 *
 * Safety: this extension is read-only. It never edits or publishes anything.
 */

import * as fs from "node:fs/promises";
import type { UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveWithin, truncateToBytes } from "../_shared/safety.ts";
import { runSubprocess } from "../_shared/subprocess.ts";
import { buildDiffArgs, formatChangedFiles, parseDiffArgs, parseGitDiff } from "../_shared/git-diff.ts";
import { formatChecklist } from "./checklist.ts";
import { formatFindingsReport, parseFindings, sortBySeverity } from "./findings.ts";

const MAX_FILE_BYTES = 100 * 1024;
const REVIEW_SYSTEM_PROMPT = `You are a senior code reviewer. Review the provided changed code and report issues.

Output ONLY a JSON array of findings. Each finding:
{"severity":"critical|high|medium|info","file":"path","line":<number>,"message":"what's wrong","suggestion":"how to fix"}

Severity guide:
- critical: security vulnerability, data loss, crash, credential leak
- high: bug, broken error handling, race condition, incorrect logic
- medium: maintainability, missing type safety, poor naming, dead code
- info: style, minor improvement, optional

If there are no issues, output []. Do not include prose outside the JSON array.`;

async function readChangedFiles(cwd: string, files: ReturnType<typeof parseGitDiff>): Promise<string> {
	const parts: string[] = [];
	for (const f of files) {
		try {
			const abs = resolveWithin(cwd, f.path);
			const buf = await fs.readFile(abs, "utf8");
			const ranges = f.hunks
				.map((h) => (h.newLen > 1 ? `L${h.newStart}-${h.newStart + h.newLen - 1}` : `L${h.newStart}`))
				.join(", ");
			parts.push(`### ${f.path} (changed: ${ranges})\n\`\`\`\n${truncateToBytes(buf, MAX_FILE_BYTES)}\n\`\`\``);
		} catch {
			parts.push(`### ${f.path} (could not read)`);
		}
	}
	return parts.join("\n\n");
}

export default function rapCodeReview(pi: ExtensionAPI): void {
	const editedThisTurn = new Set<string>();
	let lastEdited: string[] = [];

	// Edit tracking: collect files written/edited this turn (successful only).
	pi.on("tool_result", async (event) => {
		if (event.isError) return;
		if (event.toolName === "write" || event.toolName === "edit") {
			const p = event.input.file_path ?? event.input.path;
			if (typeof p === "string" && p) editedThisTurn.add(p);
		}
	});

	// Batch at turn end.
	pi.on("turn_end", async () => {
		if (editedThisTurn.size > 0) {
			lastEdited = [...editedThisTurn];
			editedThisTurn.clear();
		}
	});

	// Inject checklist before the next user-driven turn.
	pi.on("before_agent_start", async (event) => {
		if (event.messageType !== "user") return;
		if (lastEdited.length === 0) return;
		const checklist = formatChecklist(lastEdited);
		lastEdited = [];
		if (!checklist) return;
		return { message: { customType: "rap-code-review-checklist", content: checklist, display: false } };
	});

	pi.registerCommand("review", {
		description: "Review changed code with severity-tagged findings. Options: --staged, --ref=<branch>, or file paths.",
		handler: async (args, ctx) => {
			const argv = args.trim().split(/\s+/).filter(Boolean);
			const opts = parseDiffArgs(argv);

			const result = await runSubprocess("git", ["diff", ...buildDiffArgs(opts)], {
				cwd: ctx.cwd,
				signal: ctx.signal,
				maxOutputBytes: 200 * 1024,
				redact: false,
			});
			if (result.exitCode !== 0) {
				ctx.ui.notify(`git diff failed (exit ${result.exitCode}):\n${result.stderr.trim()}`, "error");
				return;
			}

			const files = parseGitDiff(result.stdout);
			if (files.length === 0) {
				ctx.ui.notify(opts.staged ? "No staged changes to review." : "No uncommitted changes to review.", "info");
				return;
			}

			const codeBlock = await readChangedFiles(ctx.cwd, files);
			const reviewPrompt = `Review the following changed code.

Changed files and line ranges:
${formatChangedFiles(files)}

${codeBlock}`;

			// Structured path: call the session model directly.
			if (ctx.model) {
				try {
					const userMessage: UserMessage = {
						role: "user",
						content: [{ type: "text", text: reviewPrompt }],
						timestamp: Date.now(),
					};
					const response = await ctx.modelRegistry.complete(
						ctx.model,
						{ systemPrompt: REVIEW_SYSTEM_PROMPT, messages: [userMessage] },
						{ signal: ctx.signal },
					);
					const text = response.content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map((c) => c.text)
						.join("\n");
					const findings = sortBySeverity(parseFindings(text));
					const report = formatFindingsReport(findings);
					pi.sendMessage(
						{ customType: "rap-code-review-report", content: `**Code Review**\n\n${report}`, display: true },
						{ triggerTurn: false },
					);
					return;
				} catch (err) {
					// Fall through to prompt-based review.
					ctx.ui.notify("Structured review failed; falling back to session-agent review.", "info");
				}
			}

			// Fallback: prompt-based review via the session agent.
			const fallback = `Review the following changed code. Report findings grouped by severity (CRITICAL / HIGH / MEDIUM / INFO), each with file:line and a concrete suggestion. Do not edit files — only report.

Changed files and line ranges:
${formatChangedFiles(files)}

${codeBlock}`;
			pi.sendUserMessage(fallback);
		},
	});
}
