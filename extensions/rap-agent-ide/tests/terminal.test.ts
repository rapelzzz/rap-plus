/**
 * rap-agent-ide terminal.ts — pure helper tests + integration.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TerminalPool, truncateOutput, formatSessionList } from "../terminal.ts";

test("truncateOutput leaves short buffers untouched, caps long ones", () => {
	assert.equal(truncateOutput("abc", 100), "abc");
	const big = "x".repeat(1000);
	const out = truncateOutput(big, 100);
	assert.ok(out.length < big.length);
	assert.match(out, /\[truncated/);
});

test("formatSessionList renders sessions", () => {
	assert.equal(formatSessionList([]), "No terminal sessions.");
	const list = formatSessionList([
		{ id: "term-1", pid: 42, cwd: "/p", alive: true, createdAt: 0, lastCommand: "echo hi" },
	]);
	assert.match(list, /● term-1/);
	assert.match(list, /pid 42/);
	assert.match(list, /echo hi/);
});

test("TerminalPool: create, send, output, kill (integration)", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-ide-term-"));
	const pool = new TerminalPool();
	try {
		const id = pool.create(dir);
		assert.match(id, /^term-/);
		const res = await pool.send(id, "echo hello-world");
		assert.match(res.stdout, /hello-world/);
		assert.equal(res.timedOut, false);
		// persistent: second command sees prior state (env var set earlier)
		await pool.send(id, "export FOO=bar");
		const res2 = await pool.send(id, "echo $FOO");
		assert.match(res2.stdout, /bar/);
		// list reflects the session
		assert.equal(pool.list().length, 1);
		// kill removes it
		assert.equal(pool.kill(id), true);
		assert.equal(pool.list().length, 0);
	} finally {
		pool.killAll();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("TerminalPool: send to unknown/ dead session throws", async () => {
	const pool = new TerminalPool();
	await assert.rejects(() => pool.send("nope", "echo hi"), /no terminal session/);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-ide-term-"));
	try {
		const id = pool.create(dir);
		pool.kill(id);
		await assert.rejects(() => pool.send(id, "echo hi"), /no terminal session/);
	} finally {
		pool.killAll();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("TerminalPool: respects a max session cap", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-ide-term-"));
	const pool = new TerminalPool();
	try {
		for (let i = 0; i < 8; i++) pool.create(dir);
		assert.throws(() => pool.create(dir), /terminal pool full/);
	} finally {
		pool.killAll();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
