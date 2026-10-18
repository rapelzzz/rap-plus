/**
 * rap-agent-ide cdp.ts — pure helper tests + real CDP integration.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

import { parseInspectUrl, discoverCdpUrl, CdpClient } from "../cdp.ts";

test("parseInspectUrl extracts the ws:// URL from an inspect banner", () => {
	const stderr =
		"Debugger listening on ws://127.0.0.1:9229/8f1c2d3e-uuid\n" +
		"For help, see: https://nodejs.org/en/docs/inspector\n";
	assert.equal(parseInspectUrl(stderr), "ws://127.0.0.1:9229/8f1c2d3e-uuid");
});

test("parseInspectUrl returns null when no ws URL is present", () => {
	assert.equal(parseInspectUrl("just some output\nno url here"), null);
});

// --- integration: spawn node --inspect-brk and talk CDP -------------------

async function spawnInspect(script: string): Promise<{ wsUrl: string; proc: ReturnType<typeof spawn> }> {
	const proc = spawn(process.execPath, ["--inspect-brk=0", "-e", script], {
		stdio: ["pipe", "pipe", "pipe"],
	});
	const stderr: string[] = [];
	proc.stderr.on("data", (c: Buffer) => stderr.push(c.toString("utf8")));
	// Wait for the inspector banner with the full ws:// URL (incl. UUID path).
	const wsUrl = await new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("no inspect banner; stderr: " + stderr.join(""))), 8000);
		const check = () => {
			const url = parseInspectUrl(stderr.join(""));
			if (url) {
				clearTimeout(timer);
				resolve(url);
			} else {
				setTimeout(check, 50);
			}
		};
		check();
	});
	// Give the inspector a moment to accept connections.
	await new Promise((r) => setTimeout(r, 200));
	return { wsUrl, proc };
}

test("CdpClient connects, evaluates an expression, and returns the result", async () => {
	// A script that pauses on break and waits for input (so the process stays alive).
	const { wsUrl, proc } = await spawnInspect("setTimeout(() => {}, 100000)");
	try {
		const client = await CdpClient.connect(wsUrl, { timeoutMs: 5000 });
		assert.ok(client.isOpen);
		await client.send("Runtime.enable", {});
		const res = (await client.send("Runtime.evaluate", { expression: "6 * 7", returnByValue: true })) as {
			result?: { value?: number };
		};
		assert.equal(res.result?.value, 42);
		client.close();
	} finally {
		proc.kill("SIGKILL");
	}
});

test("CdpClient rejects on a closed/invalid endpoint", async () => {
	await assert.rejects(
		() => CdpClient.connect("ws://127.0.0.1:1", { timeoutMs: 1500 }),
		// Node's WebSocket surfaces connect failure or timeout.
		/CDP|WebSocket|connect|ECONN|timed/i,
	);
});
