/**
 * rap-debug-mode — evidence-first debugging methodology enforcement.
 *
 * When enabled via `/rap-debug`, the evidence-first methodology is injected
 * into the session context (once),
 * and a `debug_checkpoint` tool records progress and gates the "fix" stage
 * behind a confirmed reproduction (safety invariant: no fixing before repro).
 *
 * Commands/tools:
 *   /rap-debug     — toggle debug-mode on/off (injects methodology when on).
 *   debug_checkpoint (tool) — report evidence/hypothesis/probe/repro/fix/verify.
 */

import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyCheckpoint, freshDebugState, formatDebugStatus, METHODOLOGY, type DebugState } from "./workflow.ts";

const StageSchema = StringEnum(
	["investigate", "hypothesize", "probe", "reproduce", "fix", "verify"] as const,
	{ description: "Workflow stage this checkpoint advances to." },
);

export default function rapDebugMode(pi: ExtensionAPI): void {
	let active = false;
	let state: DebugState = freshDebugState();

	pi.registerCommand("rap-debug", {
		description: "Toggle evidence-first debug mode on/off.",
		handler: async (_args, ctx) => {
			active = !active;
			if (active) {
				state = freshDebugState();
				// Inject the methodology into the transcript once (display:false, no turn).
				pi.sendMessage(
					{ customType: "rap-debug-mode-methodology", content: METHODOLOGY, display: false },
					{ triggerTurn: false },
				);
				ctx.ui.notify("Debug mode ON: evidence-first methodology enforced. Use debug_checkpoint to record progress.", "info");
			} else {
				ctx.ui.notify("Debug mode OFF.", "info");
			}
		},
	});

	pi.registerTool({
		name: "debug_checkpoint",
		label: "Debug Checkpoint",
		description:
			"Record evidence-first debugging progress. Reproduction/verification flags require written evidence details but are self-reported and not independently verified by this tool.",
		parameters: Type.Object({
			stage: Type.Optional(StageSchema),
			evidence: Type.Optional(Type.String({ description: "Runtime evidence observed (log/error/stack/assert)" })),
			hypothesis: Type.Optional(Type.String({ description: "A falsifiable hypothesis derived from evidence" })),
			probe: Type.Optional(Type.String({ description: "A probe run to test a hypothesis (log/assert/repro step)" })),
			reproConfirmed: Type.Optional(Type.Boolean({ description: "Self-reported deterministic reproduction status; include reproEvidence when true. The tool cannot verify execution." })),
			reproEvidence: Type.Optional(Type.String({ description: "Exact reproduction steps and observed result; required when reproConfirmed is true." })),
			fix: Type.Optional(Type.String({ description: "Description of the smallest fix applied" })),
			verified: Type.Optional(Type.Boolean({ description: "Self-reported post-fix verification status; include verificationEvidence when true. The tool cannot verify execution." })),
			verificationEvidence: Type.Optional(Type.String({ description: "Verification command/procedure and observed result; required when verified is true." })),
		}),
		// This tool persists extension state, so it is not read-only.
		annotations: { readOnlyHint: false },
		exposure: "model-only",

		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!active) {
				return {
					content: [{ type: "text", text: "Debug mode is OFF. Run /debug to enable evidence-first methodology." }],
					details: undefined,
				};
			}
			const result = applyCheckpoint(state, params);
			if (result.ok) {
				state = result.state;
				ctx?.ui?.notify?.(formatDebugStatus(state), "info");
			}
			const prefix = result.ok ? "✓ Checkpoint recorded." : `✗ Rejected: ${result.reason}`;
			return {
				content: [{ type: "text", text: `${prefix}\n${result.guidance}\n\n${formatDebugStatus(state)}` }],
				details: undefined,
			};
		},
	});
}
