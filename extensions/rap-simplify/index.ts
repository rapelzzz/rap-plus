/**
 * rap-simplify — review & simplify recently changed code.
 *
 * The `/rap-simplify` command detects changed files and line ranges via
 * `git diff` and instructs
 * the agent to review only those changed lines for clarity, consistency, and
 * maintainability — preserving functionality, applying project standards,
 * constraining edits to the changed ranges, one file at a time, then running
 * tests and summarizing.
 *
 * Safety: this extension never edits files itself; it only computes the diff
 * and issues a scoped instruction. Edits are made by the agent within the
 * reported line ranges. Newly added files are reviewed in full.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runSubprocess } from "../_shared/subprocess.ts";
import { buildDiffArgs, formatChangedFiles, parseGitDiff, parseSimplifyArgs } from "./utils.ts";

export default function rapSimplify(pi: ExtensionAPI): void {
	pi.registerCommand("rap-simplify", {
		description: "Simplify recently changed code (git diff). Options: --staged, --ref=<branch>, or file paths.",
		handler: async (args, ctx) => {
			const argv = args.trim().split(/\s+/).filter(Boolean);
			const opts = parseSimplifyArgs(argv);

			const diffArgs = ["diff", ...buildDiffArgs(opts)];
			const result = await runSubprocess("git", diffArgs, {
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
				ctx.ui.notify(opts.staged ? "No staged changes to simplify." : "No uncommitted changes to simplify.", "info");
				return;
			}

			const scope = opts.staged
				? "staged changes"
				: opts.ref
					? `changes vs '${opts.ref}'`
					: opts.files.length > 0
						? `files: ${opts.files.join(", ")}`
						: "uncommitted changes";

			const instruction = `Review and simplify ${scope}.

Changed files and line ranges:
${formatChangedFiles(files)}

Principles:
- Preserve functionality: never change what the code does.
- Apply project standards (CLAUDE.md / AGENTS.md conventions).
- Enhance clarity: reduce complexity, eliminate redundancy, improve naming.
- Maintain balance: avoid over-simplification.

You may read surrounding code for context, but edits MUST stay within the changed line ranges above. Newly added files may be reviewed in full.

Apply improvements one file at a time. After editing, run the project test suite to verify nothing breaks. Then summarize the changes you made.`;

			pi.sendUserMessage(instruction);
		},
	});
}
