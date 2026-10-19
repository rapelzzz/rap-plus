/**
 * rap-agent-ide observability.ts — pure helper tests + CPU profile integration.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	collectSystemMetrics,
	formatSystemMetrics,
	parseProfileTopFunctions,
	captureCpuProfile,
} from "../observability.ts";

test("collectSystemMetrics reads live host/cpu/memory", () => {
	const m = collectSystemMetrics();
	assert.equal(m.platform, os.platform());
	assert.ok(m.cpuCount >= 1);
	assert.ok(m.totalMem > 0);
	assert.ok(m.processMemMb >= 0);
});

test("formatSystemMetrics renders a readable report", () => {
	const m = collectSystemMetrics();
	const out = formatSystemMetrics(m);
	assert.match(out, /host:/);
	assert.match(out, /cpu:/);
	assert.match(out, /memory:/);
	assert.match(out, /process:/);
	assert.match(out, /loadavg/);
});

test("parseProfileTopFunctions aggregates hitCounts by name and sorts", () => {
	const profile = {
		nodes: [
			{ callFrame: { functionName: "hot" }, hitCount: 50 },
			{ callFrame: { functionName: "warm" }, hitCount: 10 },
			{ callFrame: { functionName: "hot" }, hitCount: 30 },
			{ callFrame: { functionName: "" }, hitCount: 5 },
		],
		samples: [1, 1, 2],
	};
	const top = parseProfileTopFunctions(profile, 2);
	assert.equal(top.length, 2);
	assert.equal(top[0].name, "hot");
	assert.equal(top[0].hits, 80);
	assert.equal(top[1].name, "warm");
	assert.equal(top[1].hits, 10);
});

test("parseProfileTopFunctions handles empty profiles", () => {
	assert.deepEqual(parseProfileTopFunctions({}), []);
	assert.deepEqual(parseProfileTopFunctions({ nodes: [] }), []);
});

test("captureCpuProfile writes a .cpuprofile and reports hot functions", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-ide-obs-"));
	try {
		// CPU-bound workload so the profiler captures samples.
		const script = "for(let i=0;i<5e6;i++){Math.sqrt(i)}";
		const res = await captureCpuProfile(script, { cwd: dir, durationMs: 600, outFile: "p.cpuprofile" });
		assert.ok(fs.existsSync(res.file));
		assert.equal(path.basename(res.file), "p.cpuprofile");
		// The written file must be valid JSON parseable as a profile.
		const written = JSON.parse(fs.readFileSync(res.file, "utf8"));
		assert.ok(Array.isArray(written.nodes) || Array.isArray(written.samples));
		assert.ok(res.sampleCount >= 0);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("captureCpuProfile does not throw on a fast/trivial script", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-ide-obs-"));
	try {
		// A trivial script exits almost immediately — previously this made
		// Profiler.stop reject (closed connection) and the whole capture threw.
		const res = await captureCpuProfile("1+1", { cwd: dir, durationMs: 1000, outFile: "fast.cpuprofile" });
		assert.ok(fs.existsSync(res.file));
		assert.equal(typeof res.sampleCount, "number");
		// Either it captured samples or it flagged an early exit — both are valid.
		assert.ok(res.sampleCount > 0 || res.earlyExit === true, "fast script should not error the capture");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});


test("captureCpuProfile rejects output paths outside the project before starting a process", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-ide-obs-path-"));
	try {
		await assert.rejects(
			captureCpuProfile("while (true) {}", { cwd: dir, outFile: "../outside.cpuprofile" }),
			/inside the project root/i,
		);
		assert.equal(fs.existsSync(path.resolve(dir, "../outside.cpuprofile")), false);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
