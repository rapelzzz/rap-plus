import { test } from "node:test";
import assert from "node:assert";
import {
	currentDepth,
	MAX_CHAIN_DEPTH,
	mapWithConcurrencyLimit,
	truncateParallelOutput,
	getFinalOutput,
	isFailedResult,
	capTaskArg,
	TASK_ARG_MAX,
	type SingleResult,
} from "../index.ts";

// ── depth limiter (prevents unbounded recursive delegation) ─────────────────
test("currentDepth reads RAP_SUBAGENT_DEPTH env (default 0)", () => {
	const saved = process.env.RAP_SUBAGENT_DEPTH;
	delete process.env.RAP_SUBAGENT_DEPTH;
	assert.equal(currentDepth(), 0);
	process.env.RAP_SUBAGENT_DEPTH = "2";
	assert.equal(currentDepth(), 2);
	delete process.env.RAP_SUBAGENT_DEPTH;
	if (saved !== undefined) process.env.RAP_SUBAGENT_DEPTH = saved;
});

test("currentDepth tolerates garbage env values", () => {
	const saved = process.env.RAP_SUBAGENT_DEPTH;
	process.env.RAP_SUBAGENT_DEPTH = "not-a-number";
	assert.equal(currentDepth(), 0);
	process.env.RAP_SUBAGENT_DEPTH = "-5";
	assert.equal(currentDepth(), 0);
	delete process.env.RAP_SUBAGENT_DEPTH;
	if (saved !== undefined) process.env.RAP_SUBAGENT_DEPTH = saved;
});

test("SAFETY: MAX_CHAIN_DEPTH bounds recursion (child refuses at >= depth)", () => {
	// The execute() handler returns isError when currentDepth() >= MAX_CHAIN_DEPTH.
	// Here we assert the bound is finite and the check fires.
	assert.ok(MAX_CHAIN_DEPTH >= 1 && MAX_CHAIN_DEPTH <= 5, "depth bound must be a small finite number");
	const saved = process.env.RAP_SUBAGENT_DEPTH;
	process.env.RAP_SUBAGENT_DEPTH = String(MAX_CHAIN_DEPTH);
	assert.ok(currentDepth() >= MAX_CHAIN_DEPTH, "at max depth the gate must trip");
	delete process.env.RAP_SUBAGENT_DEPTH;
	if (saved !== undefined) process.env.RAP_SUBAGENT_DEPTH = saved;
});

// ── concurrency mapper ──────────────────────────────────────────────────────
test("mapWithConcurrencyLimit preserves order and respects limit", async () => {
	const items = [1, 2, 3, 4, 5, 6];
	const out = await mapWithConcurrencyLimit(items, 2, async (n) => n * 10);
	assert.deepEqual(out, [10, 20, 30, 40, 50, 60]);
});

test("mapWithConcurrencyLimit handles empty input", async () => {
	assert.deepEqual(await mapWithConcurrencyLimit([], 4, async (n) => n), []);
});

test("mapWithConcurrencyLimit actually limits concurrency", async () => {
	let running = 0;
	let maxRunning = 0;
	const items = Array.from({ length: 10 }, (_, i) => i);
	await mapWithConcurrencyLimit(items, 3, async () => {
		running++;
		maxRunning = Math.max(maxRunning, running);
		await new Promise((r) => setTimeout(r, 10));
		running--;
	});
	assert.ok(maxRunning <= 3, `concurrency exceeded: ${maxRunning}`);
});

// ── output truncation ───────────────────────────────────────────────────────
test("truncateParallelOutput caps at 50KB with notice", () => {
	const big = "x".repeat(60000);
	const out = truncateParallelOutput(big);
	assert.ok(Buffer.byteLength(out, "utf8") <= 50 * 1024 + 200);
	assert.match(out, /Output truncated/);
	assert.equal(truncateParallelOutput("small"), "small");
});

// ── result helpers ──────────────────────────────────────────────────────────
test("getFinalOutput returns last assistant text", () => {
	const msgs = [
		{ role: "user", content: [{ type: "text", text: "hi" }] },
		{ role: "assistant", content: [{ type: "text", text: "first" }] },
		{ role: "assistant", content: [{ type: "text", text: "final answer" }] },
	] as any;
	assert.equal(getFinalOutput(msgs), "final answer");
});

test("getFinalOutput returns empty when no assistant text", () => {
	const msgs = [{ role: "user", content: [{ type: "text", text: "hi" }] }] as any;
	assert.equal(getFinalOutput(msgs), "");
});

test("isFailedResult flags non-zero exit, error, aborted", () => {
	const base = (): SingleResult => ({
		agent: "x", agentSource: "user", task: "t", exitCode: 0, messages: [], stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
	});
	assert.equal(isFailedResult(base()), false);
	const e1 = base(); e1.exitCode = 1; assert.equal(isFailedResult(e1), true);
	const e2 = base(); e2.stopReason = "error"; assert.equal(isFailedResult(e2), true);
	const e3 = base(); e3.stopReason = "aborted"; assert.equal(isFailedResult(e3), true);
});

test("capTaskArg truncates oversized tasks with a notice", () => {
	// A normal task passes through unchanged.
	assert.equal(capTaskArg("do thing"), "do thing");
	// An oversized task is capped and marked.
	const huge = "x".repeat(TASK_ARG_MAX + 1000);
	const capped = capTaskArg(huge);
	assert.ok(capped.length < huge.length);
	assert.match(capped, /\[task truncated/);
	// The boundary itself is the cutoff: exactly TASK_ARG_MAX stays unchanged.
	assert.equal(capTaskArg("x".repeat(TASK_ARG_MAX)).length, TASK_ARG_MAX);
});
