import { test } from "node:test";
import assert from "node:assert";
import {
	applyCheckpoint,
	canAdvanceTo,
	freshDebugState,
	formatDebugStatus,
	STAGE_ORDER,
	METHODOLOGY,
	stageIndex,
} from "../workflow.ts";

// ── ordering / gating ───────────────────────────────────────────────────────
test("fresh state starts at investigate with no evidence", () => {
	const s = freshDebugState();
	assert.equal(s.stage, "investigate");
	assert.equal(s.hasEvidence, false);
	assert.equal(s.hypotheses.length, 0);
});

test("cannot hypothesize without evidence", () => {
	const s = freshDebugState();
	const r = canAdvanceTo(s, "hypothesize");
	assert.equal(r.ok, false);
	assert.match(r.reason!, /evidence/i);
});

test("cannot fix without confirmed reproduction", () => {
	const s = { ...freshDebugState(), hasEvidence: true, hypotheses: ["h"], probesRun: ["p"], reproConfirmed: false };
	const r = canAdvanceTo(s, "fix");
	assert.equal(r.ok, false);
	assert.match(r.reason!, /reproduction/i);
});

test("can fix with confirmed reproduction", () => {
	const s = { ...freshDebugState(), hasEvidence: true, hypotheses: ["h"], probesRun: ["p"], reproConfirmed: true };
	assert.equal(canAdvanceTo(s, "fix").ok, true);
});

test("cannot verify without a fix described", () => {
	const s = { ...freshDebugState(), reproConfirmed: true, fixDescription: "" };
	assert.equal(canAdvanceTo(s, "verify").ok, false);
});

test("stageIndex matches STAGE_ORDER", () => {
	assert.equal(stageIndex("investigate"), 0);
	assert.equal(stageIndex("verify"), 5);
});

// ── applyCheckpoint ─────────────────────────────────────────────────────────
test("applyCheckpoint accumulates evidence/hypothesis/probe and advances", () => {
	let s = freshDebugState();
	s = applyCheckpoint(s, { evidence: "TypeError at line 42" }).state;
	assert.equal(s.hasEvidence, true);
	s = applyCheckpoint(s, { stage: "hypothesize", hypothesis: "null deref" }).state;
	assert.equal(s.stage, "hypothesize");
	assert.equal(s.hypotheses.length, 1);
	s = applyCheckpoint(s, { stage: "probe", probe: "added log" }).state;
	assert.equal(s.probesRun.length, 1);
	s = applyCheckpoint(s, { stage: "reproduce", reproConfirmed: true, reproEvidence: "same minimal repro failed twice before the fix" }).state;
	assert.equal(s.reproConfirmed, true);
	s = applyCheckpoint(s, { stage: "fix", fix: "guard null" }).state;
	assert.equal(s.fixDescription, "guard null");
	const v = applyCheckpoint(s, { stage: "verify", verified: true, verificationEvidence: "npm test completed successfully after the fix" });
	assert.equal(v.state.verified, true);
	assert.equal(v.state.stage, "verify");
});

test("applyCheckpoint requires recorded evidence before setting self-reported confirmation flags", () => {
	const repro = applyCheckpoint(freshDebugState(), { reproConfirmed: true });
	assert.equal(repro.ok, false);
	assert.match(repro.reason!, /evidence/i);
	const verified = applyCheckpoint(freshDebugState(), { verified: true });
	assert.equal(verified.ok, false);
	assert.match(verified.reason!, /verification[- ]evidence/i);
});

test("applyCheckpoint rejects fix when repro not confirmed", () => {
	let s = freshDebugState();
	s = applyCheckpoint(s, { evidence: "e" }).state;
	s = applyCheckpoint(s, { stage: "hypothesize", hypothesis: "h" }).state;
	s = applyCheckpoint(s, { stage: "probe", probe: "p" }).state;
	s = applyCheckpoint(s, { stage: "reproduce", reproConfirmed: false }).state;
	const r = applyCheckpoint(s, { stage: "fix", fix: "x" });
	assert.equal(r.ok, false);
	assert.match(r.reason!, /reproduction/i);
	assert.equal(r.state.stage, "reproduce"); // unchanged
});

test("applyCheckpoint returns guidance text", () => {
	const r = applyCheckpoint(freshDebugState(), {});
	assert.match(r.guidance, /evidence/i);
});

// ── formatting ──────────────────────────────────────────────────────────────
test("formatDebugStatus shows current stage", () => {
	const s = { ...freshDebugState(), stage: "fix" as const, reproConfirmed: true };
	const text = formatDebugStatus(s);
	assert.match(text, /\[fix\]/);
	assert.match(text, /repro✓/);
});

test("METHODOLOGY mentions all six stages", () => {
	for (const stage of STAGE_ORDER) {
		assert.match(METHODOLOGY, new RegExp(stage), `METHODOLOGY missing ${stage}`);
	}
});

test("applyCheckpoint keeps additive input even when stage is rejected", () => {
	// Gathering evidence is always valid; the stage advance to 'fix' is rejected
	// because repro isn't confirmed, but the evidence must survive in the state.
	let s = freshDebugState();
	const r = applyCheckpoint(s, { evidence: "stack trace from prod", stage: "fix", fix: "guard" });
	assert.equal(r.ok, false);
	assert.match(r.reason!, /reproduction/i);
	assert.equal(r.state.stage, "investigate"); // stage not advanced
	// Additive inputs are retained (the bug previously discarded them).
	assert.equal(r.state.hasEvidence, true);
	assert.equal(r.state.fixDescription, "guard");
});
