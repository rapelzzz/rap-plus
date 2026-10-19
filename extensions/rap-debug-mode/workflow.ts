/**
 * Evidence-first debugging workflow state machine for rap-debug-mode.
 *
 * Enforces a disciplined, evidence-first debugging methodology:
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
	reproEvidence: string;
	fixDescription: string;
	verified: boolean;
	verificationEvidence: string;
}

export function freshDebugState(): DebugState {
	return {
		stage: "investigate",
		hasEvidence: false,
		hypotheses: [],
		probesRun: [],
		reproConfirmed: false,
		reproEvidence: "",
		fixDescription: "",
		verified: false,
		verificationEvidence: "",
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
	reproEvidence?: string;
	fix?: string;
	verified?: boolean;
	verificationEvidence?: string;
}

export function applyCheckpoint(state: DebugState, input: CheckpointInput): { state: DebugState; ok: boolean; reason?: string; guidance: string } {
	let next: DebugState = { ...state, hypotheses: [...state.hypotheses], probesRun: [...state.probesRun] };

	if (input.evidence) next.hasEvidence = true;
	if (input.hypothesis) next.hypotheses.push(input.hypothesis);
	if (input.probe) next.probesRun.push(input.probe);
	if (input.reproEvidence?.trim()) next.reproEvidence = input.reproEvidence.trim();
	if (input.verificationEvidence?.trim()) next.verificationEvidence = input.verificationEvidence.trim();
	if (input.reproConfirmed === true && !next.reproEvidence) {
		return { state: next, ok: false, reason: "Reproduction confirmation requires a written reproduction-evidence record.", guidance: "Record the exact reproduction steps and observed result; this tool cannot independently verify execution." };
	}
	if (input.verified === true && !next.verificationEvidence) {
		return { state: next, ok: false, reason: "Verification requires a written verification-evidence record.", guidance: "Record the exact verification command or procedure and observed result; this tool cannot independently verify execution." };
	}
	if (typeof input.reproConfirmed === "boolean") next.reproConfirmed = input.reproConfirmed;
	if (input.reproConfirmed === false) next.reproEvidence = "";
	if (input.fix) next.fixDescription = input.fix;
	if (typeof input.verified === "boolean") next.verified = input.verified;
	if (input.verified === false) next.verificationEvidence = "";

	const target = input.stage ?? next.stage;
	if (input.stage) {
		const check = canAdvanceTo(next, input.stage);
		if (!check.ok) {
			// Stage transition rejected, but the additive inputs (evidence,
			// hypothesis, probe) are still valid standalone data — keep them in
			// the state so the model doesn't lose work. Only the stage advance is
			// refused (next.stage is still the previous stage here).
			return { state: next, ok: false, reason: check.reason, guidance: check.reason ?? "Checkpoint rejected." };
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
				? "Reproduction is recorded as confirmed by the agent (not independently verified). Apply the SMALLEST fix addressing the root cause (stage: fix)."
				: "Confirm a deterministic reproduction before fixing.";
		case "fix":
			return state.fixDescription
				? "Re-run the reproduction to verify the fix (stage: verify). Revert if it does not resolve the issue."
				: "Apply the smallest fix addressing the root cause and describe it.";
		case "verify":
			return state.verified
				? "Verification is recorded by the agent (not independently verified). Review the cited command/procedure output before treating the issue as resolved."
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
