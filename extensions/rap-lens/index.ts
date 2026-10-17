/**
 * rap-lens — focused code-diagnostics subset.
 *
 * Behavioral target: `pi-lens` (apmantza). This ships a FOCUSED SUBSET:
 * dynamic tool/dependency detection, TypeScript type-checking (`tsc --noEmit`),
 * compiler/linter output parsing, diagnostic reporting, and a triage tool
 * (`lens_diagnostic_mark`). The full pi-lens surface (LSP navigation, impact
 * cascade, ast-grep/tree-sitter, symbol_search/module_map/read_symbol,
 * /lens-map, autofix) is NOT implemented — see research/feature-parity.md.
 *
 * Commands/tools:
 *   /lens          — run available diagnostics (tsc) in the project and report.
 *   lens_diagnostic_mark (tool) — mark a finding falsePositive/suppressed/deferred/flagFix.
 */

import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatDiagnostics, runTypeScriptCheck, detectTools } from "./diagnostics.ts";
import { TriageStore, diagnosticKey, type TriageMark } from "./triage.ts";

const TriageMarkSchema = StringEnum(["falsePositive", "suppressed", "deferred", "flagFix"] as const, {
	description: "falsePositive = not a real issue; suppressed = silenced in source; deferred = fix later; flagFix = must fix.",
});

export default function rapLens(pi: ExtensionAPI): void {
	const triage = new TriageStore();

	pi.registerCommand("lens", {
		description: "Run available code diagnostics (TypeScript type-check) and report findings.",
		handler: async (_args, ctx) => {
			const tools = detectTools(ctx.cwd);
			if (!tools.tsc) {
				ctx.ui.notify("rap-lens: no supported tooling detected (need local tsc). Install dependencies first.", "info");
				return;
			}
			const { diagnostics, ran, stderr } = await runTypeScriptCheck(ctx.cwd, ctx.signal);
			if (!ran) {
				ctx.ui.notify("rap-lens: could not run diagnostics.", "error");
				return;
			}
			// Apply triage: drop false-positive/suppressed.
			const active = diagnostics.filter((d) => triage.isActive(diagnosticKey(d.file, d.line, d.message)));
			const report = formatDiagnostics(active);
			const triagedOut = diagnostics.length - active.length;
			const suffix = triagedOut > 0 ? `\n\n(${triagedOut} finding${triagedOut > 1 ? "s" : ""} hidden by triage marks)` : "";
			pi.sendMessage(
				{ customType: "rap-lens-report", content: `**rap-lens**\n\n${report}${suffix}\n${stderr ? `\n(tsc stderr: ${stderr.trim().slice(0, 200)})` : ""}`, display: true },
				{ triggerTurn: false },
			);
		},
	});

	pi.registerTool({
		name: "lens_diagnostic_mark",
		label: "Lens Mark",
		description:
			"Mark a diagnostic finding as falsePositive, suppressed, deferred, or flagFix. Marked false-positive/suppressed findings are hidden from /lens reports.",
		parameters: Type.Object({
			file: Type.String({ description: "File path of the finding" }),
			line: Type.Number({ description: "Line number of the finding" }),
			message: Type.String({ description: "The finding message (or its prefix) to identify it" }),
			mark: TriageMarkSchema,
			reason: Type.Optional(Type.String({ description: "Why this mark was applied" })),
		}),
		annotations: { readOnlyHint: true },
		exposure: "model-only",

		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const key = diagnosticKey(params.file, params.line, params.message);
			triage.mark(params.mark as TriageMark, key, params.reason ?? "");
			return {
				content: [
					{
						type: "text",
						text: `Marked ${params.file}:${params.line} as ${params.mark}${params.reason ? ` (${params.reason})` : ""}. Use /lens to see remaining findings.`,
					},
				],
				details: undefined,
			};
		},
	});
}
