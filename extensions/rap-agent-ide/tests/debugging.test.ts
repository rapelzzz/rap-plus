/**
 * rap-agent-ide debugging.ts — DebugSession integration over a real node --inspect-brk.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { DebugSession } from "../debugging.ts";

function writeScript(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-ide-dbg-"));
	const file = path.join(dir, "target.mjs");
	fs.writeFileSync(
		file,
		[
			"export const MAGIC = 1337;",
			"export function compute(x) {",
			"  const doubled = x * 2;",
			"  return doubled + 1;",
			"}",
			"const result = compute(10);",
			"console.log(result);",
		].join("\n") + "\n",
	);
	return file;
}

test("DebugSession starts paused at entry and can evaluate", async () => {
	const file = writeScript();
	try {
		const session = await DebugSession.start(file, { timeoutMs: 8000 });
		const status = await session.status();
		assert.equal(status.paused, true);
		// Evaluate a global expression in the paused frame.
		const ev = await session.evaluate("1 + 41");
		assert.equal(ev.result, "42");
		await session.stop();
	} finally {
		fs.rmSync(path.dirname(file), { recursive: true, force: true });
	}
});

test("DebugSession sets a breakpoint, resumes, pauses there, and inspects locals", async () => {
	const file = writeScript();
	try {
		const session = await DebugSession.start(file, { timeoutMs: 8000 });
		// Break at the `const doubled = x * 2;` line (line 3).
		const bp = await session.setBreakpoint(file, 3);
		assert.ok(bp.breakpointId);
		const after = await session.resume();
		assert.equal(after.paused, true);
		assert.ok(after.callFrames.length > 0);
		// We should be paused inside compute() at line 3.
		assert.equal(after.callFrames[0].line, 3);
		const locals = await session.inspectLocals();
		// `x` is the function parameter; `doubled` may not be assigned yet at the break line.
		assert.ok(locals.some((v) => v.name === "x"));
		await session.removeBreakpoint(bp.breakpointId);
		await session.stop();
	} finally {
		fs.rmSync(path.dirname(file), { recursive: true, force: true });
	}
});

test("DebugSession stepOver advances to the next line", async () => {
	const file = writeScript();
	try {
		const session = await DebugSession.start(file, { timeoutMs: 8000 });
		await session.setBreakpoint(file, 3);
		await session.resume();
		const stepped = await session.stepOver();
		// After stepping over line 3, we land on line 4 (the return).
		assert.equal(stepped.paused, true);
		assert.equal(stepped.callFrames[0].line, 4);
		await session.stop();
	} finally {
		fs.rmSync(path.dirname(file), { recursive: true, force: true });
	}
});

test("DebugSession stop cleans up the target process", async () => {
	const file = writeScript();
	try {
		const session = await DebugSession.start(file, { timeoutMs: 8000 });
		await session.stop();
		const status = await session.status();
		assert.equal(status.paused, false);
	} finally {
		fs.rmSync(path.dirname(file), { recursive: true, force: true });
	}
});

test("DebugSession resume returns promptly when the program runs to completion", async () => {
	const file = writeScript();
	try {
		const session = await DebugSession.start(file, { timeoutMs: 8000 });
		// No breakpoint set: resume lets the program run to completion. The
		// inspector keeps the process alive after completion, so the proc does
		// not exit — resume must still return promptly (well under the 10s step
		// timeout) instead of hanging.
		const start = Date.now();
		const after = await session.resume();
		const elapsed = Date.now() - start;
		assert.equal(after.paused, false);
		assert.ok(elapsed < 5000, `resume should return promptly on completion, took ${elapsed}ms`);
		await session.stop();
	} finally {
		fs.rmSync(path.dirname(file), { recursive: true, force: true });
	}
});

test("DebugSession handles script paths containing spaces", async () => {
	// mkdtemp gives no spaces; create a nested dir whose name has a space.
	const base = fs.mkdtempSync(path.join(os.tmpdir(), "rap-ide-dbg-"));
	const dir = path.join(base, "with space dir");
	fs.mkdirSync(dir);
	const file = path.join(dir, "target.mjs");
	fs.writeFileSync(file, "export const M = 1;\nconsole.log(M);\n");
	try {
		const session = await DebugSession.start(file, { timeoutMs: 8000 });
		const status = await session.status();
		assert.equal(status.paused, true);
		await session.stop();
	} finally {
		fs.rmSync(base, { recursive: true, force: true });
	}
});
