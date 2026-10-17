/**
 * Evidence-first debugging workflow state machine for rap-debug-mode.
 *
 * Behavioral target: `pi-debug-mode` (liush2yuxjtu) — enforce a disciplined,
 * evidence-first debugging methodology:
 *   1. investigate  — gather runtime evidence (logs, errors, stack traces).
 *   2. hypothesize  — form falsifiable hypotheses from evidence.
 *   3. probe        — run targeted probes (logs, repro steps, asserts).
 *   4. reproduce    — confirm a deterministic reproduction before fixing.
 *   5. fix          — apply the SMALLEST fix addressing the root cause.
 *   6. verify       — re-run the reproduction to confirm the fix; revert if not.
 *
 * Pure (no Pi imports) → unit-testable. The checkpoint tool gates the "fix"
 * stage behind a confirmed reproduction (safety invariant).
 */

export type DebugStage = "investigate" | "hypothesize" | "probe" | "reproduce" | "fix" | "verify";

export interface DebugState {
	stage: DebugStage;
	hasEvidence: boolean;
	hypotheses: string[];
	probesRun: string[];
	reproConfirmed: boolean;
	fixDescription: string;
	verified: boolean;
}

export function freshDebugState(): DebugState {
	return {
		stage: "investigate",
		hasEvidence: false,
		hypotheses: [],
		probesRun: [],
		reproConfirmed: false,
		fixDescription: "",
		verified: false,
	};
}

export const STAGE_ORDER: readonly DebugStage[] = ["investigate", "hypothesize", "probe", "reproduce", "fix", "verify"];

export function stageIndex(s: DebugStage): number {
	return STAGE_ORDER.indexOf(s);
}

/**
 * Whether the workflow permits advancing to `next`.
 * Enforces evidence-first ordering:
 *   - hypothesize requires evidence
 *   - probe requires ≥1 hypothesis
 *   - reproduce requires ≥1 probe
 *   - fix requires confirmed reproduction
 *   - verify requires a fix described
 */
export function canAdvanceTo(state: DebugState, next: DebugStage): { ok: boolean; reason?: string } {
	if (stageIndex(next) <= stageIndex(state.stage) && next !== state.stage) {
		return { ok: true }; // revisiting an earlier stage is allowed (e.g. back to investigate)
	}
	switch (next) {
		case "investigate":
			return { ok: true };
		case "hypothesize":
			if (!state.hasEvidence) return { ok: false, reason: "Form hypotheses only after gathering runtime evidence." };
			return { ok: true };
		case "probe":
			if (state.hypotheses.length === 0) return { ok: false, reason: "Run probes only after stating at least one hypothesis." };
			return { ok: true };
		case "reproduce":
			if (state.probesRun.length === 0) return { ok: false, reason: "Confirm reproduction only after running ≥1 probe." };
			return { ok: true };
		case "fix":
			if (!state.reproConfirmed) return { ok: false, reason: "Do not fix until reproduction is confirmed deterministically." };
			return { ok: true };
		case "verify":
			if (!state.fixDescription) return { ok: false, reason: "Verify only after applying and describing a fix." };
			return { ok: true };
	}
}

/** Apply a checkpoint update, validating ordering. Returns the resulting state + guidance. */
export interface CheckpointInput {
	stage?: DebugStage;
	evidence?: string;
	hypothesis?: string;
	probe?: string;
	reproConfirmed?: boolean;
	fix?: string;
	verified?: boolean;
}

export function applyCheckpoint(state: DebugState, input: CheckpointInput): { state: DebugState; ok: boolean; reason?: string; guidance: string } {
	let next: DebugState = { ...state, hypotheses: [...state.hypotheses], probesRun: [...state.probesRun] };

	if (input.evidence) next.hasEvidence = true;
	if (input.hypothesis) next.hypotheses.push(input.hypothesis);
	if (input.probe) next.probesRun.push(input.probe);
	if (typeof input.reproConfirmed === "boolean") next.reproConfirmed = input.reproConfirmed;
	if (input.fix) next.fixDescription = input.fix;
	if (typeof input.verified === "boolean") next.verified = input.verified;

	const target = input.stage ?? next.stage;
	if (input.stage) {
		const check = canAdvanceTo(next, input.stage);
		if (!check.ok) {
			return { state, ok: false, reason: check.reason, guidance: check.reason ?? "Checkpoint rejected." };
		}
		next.stage = input.stage;
	}

	return { state: next, ok: true, guidance: guidanceFor(next) };
}

export function guidanceFor(state: DebugState): string {
	const next: DebugStage | undefined = STAGE_ORDER[stageIndex(state.stage) + 1];
	switch (state.stage) {
		case "investigate":
			return state.hasEvidence
				? "Evidence gathered. State ≥1 falsifiable hypothesis (stage: hypothesize)."
				: "Gather runtime evidence first: logs, stack traces, error messages, failing assertions. Do not guess.";
		case "hypothesize":
			return state.hypotheses.length > 0
				? "Run a targeted probe to test each hypothesis (stage: probe)."
				: "State ≥1 falsifiable hypothesis derived from evidence.";
		case "probe":
			return state.probesRun.length > 0
				? "Confirm a deterministic reproduction (stage: reproduce)."
				: "Run a probe (log, assert, repro step) to test a hypothesis.";
		case "reproduce":
			return state.reproConfirmed
				? "Reproduction confirmed. Apply the SMALLEST fix addressing the root cause (stage: fix)."
				: "Confirm a deterministic reproduction before fixing.";
		case "fix":
			return state.fixDescription
				? "Re-run the reproduction to verify the fix (stage: verify). Revert if it does not resolve the issue."
				: "Apply the smallest fix addressing the root cause and describe it.";
		case "verify":
			return state.verified
				? "Verified. Debugging complete."
				: "Re-run the reproduction. Mark verified only if it passes.";
	}
}

export const METHODOLOGY = `## Evidence-first debugging methodology (rap-debug-mode)

Follow this order strictly. Do not skip stages or fix before confirming reproduction.

1. **investigate** — Gather runtime evidence: logs, stack traces, error messages, failing assertions. Do not guess the cause.
2. **hypothesize** — Form falsifiable hypotheses derived from evidence.
3. **probe** — Run targeted probes (add logs, asserts, repro steps) to test hypotheses.
4. **reproduce** — Confirm a deterministic reproduction. Do not proceed to fix until reproduced.
5. **fix** — Apply the SMALLEST fix addressing the root cause. Avoid speculative refactors.
6. **verify** — Re-run the reproduction. Mark verified only if it passes; revert the fix if it does not.

Use the \`debug_checkpoint\` tool to record evidence, hypotheses, probes, reproduction confirmation, the fix, and verification. The tool blocks the fix stage until reproduction is confirmed.`;

export function formatDebugStatus(state: DebugState): string {
	const idx = stageIndex(state.stage);
	const bar = STAGE_ORDER.map((s, i) => (i < idx ? "✓" : i === idx ? "▶" : "○")).join(" ");
	return `debug ▸ ${bar}  [${state.stage}]${state.reproConfirmed ? "  repro✓" : ""}${state.verified ? "  verified✓" : ""}`;
}
