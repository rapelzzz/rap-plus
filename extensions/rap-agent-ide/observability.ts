/**
 * Observability for rap-agent-ide.
 *
 * Two surfaces:
 *   1. System metrics — host/cpu/memory via `node:os` + `process`.
 *   2. CPU profile — capture a `.cpuprofile` (Chrome DevTools format) by
 *      driving a Node target under `--inspect` with the CDP `Profiler` domain,
 *      then summarize the hottest functions.
 *
 * Pure helpers (formatSystemMetrics, parseProfileTopFunctions) are unit-tested.
 */

import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { CdpClient, parseInspectUrl } from "./cdp.ts";

export interface SystemMetrics {
	platform: string;
	arch: string;
	hostname: string;
	nodeVersion: string;
	uptime: number;
	loadavg: number[];
	cpuCount: number;
	cpuModel: string;
	totalMem: number;
	freeMem: number;
	processMemMb: number;
	processUptime: number;
}

/** Collect live system + process metrics. */
export function collectSystemMetrics(): SystemMetrics {
	const cpus = os.cpus();
	return {
		platform: os.platform(),
		arch: os.arch(),
		hostname: os.hostname(),
		nodeVersion: process.version,
		uptime: os.uptime(),
		loadavg: os.loadavg(),
		cpuCount: cpus.length,
		cpuModel: cpus[0]?.model ?? "unknown",
		totalMem: os.totalmem(),
		freeMem: os.freemem(),
		processMemMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
		processUptime: Math.round(process.uptime()),
	};
}

/** Pure: format metrics into a readable report. */
export function formatSystemMetrics(m: SystemMetrics): string {
	const usedMem = m.totalMem - m.freeMem;
	const memPct = m.totalMem > 0 ? Math.round((usedMem / m.totalMem) * 100) : 0;
	const load = m.loadavg.map((n) => n.toFixed(2)).join(" ");
	return [
		`host: ${m.hostname} (${m.platform}/${m.arch}, node ${m.nodeVersion})`,
		`uptime: ${m.uptime}s · loadavg: [${load}]`,
		`cpu: ${m.cpuCount}× ${m.cpuModel}`,
		`memory: ${formatMb(usedMem)} used / ${formatMb(m.totalMem)} total (${memPct}%) · ${formatMb(m.freeMem)} free`,
		`process: ${m.processMemMb}MB rss · up ${m.processUptime}s`,
	].join("\n");
}

function formatMb(bytes: number): string {
	return `${Math.round(bytes / 1024 / 1024)}MB`;
}

export interface HotFunction {
	name: string;
	hits: number;
}

interface CpuProfile {
	nodes?: Array<{ callFrame?: { functionName?: string; url?: string }; hitCount?: number }>;
	samples?: number[];
	startTime?: number;
	endTime?: number;
}

/** Pure: aggregate profile node hitCounts into the hottest functions. */
export function parseProfileTopFunctions(profile: CpuProfile, limit = 10): HotFunction[] {
	const nodes = profile.nodes ?? [];
	const byName = new Map<string, number>();
	for (const n of nodes) {
		const name = n.callFrame?.functionName || "(anonymous)";
		const hits = n.hitCount ?? 0;
		byName.set(name, (byName.get(name) ?? 0) + hits);
	}
	return [...byName.entries()]
		.map(([name, hits]) => ({ name, hits }))
		.sort((a, b) => b.hits - a.hits)
		.slice(0, limit);
}

export interface CpuProfileResult {
	file: string;
	durationMs: number;
	sampleCount: number;
	topFunctions: HotFunction[];
	/** True when the script exited before the profiler could be stopped (e.g. a
	 * trivial/fast script). The profile is still written but may have no samples. */
	earlyExit?: boolean;
}

/** Capture a CPU profile of `script` for `durationMs`, writing a `.cpuprofile`. */
export async function captureCpuProfile(
	script: string,
	opts: { cwd?: string; durationMs?: number; outFile?: string; timeoutMs?: number } = {},
): Promise<CpuProfileResult> {
	const durationMs = opts.durationMs ?? 2000;
	const proc = spawn(process.execPath, ["--inspect-brk=0", "-e", script], {
		cwd: opts.cwd,
		stdio: ["pipe", "pipe", "pipe"],
	});
	const stderr: string[] = [];
	let exited = false;
	proc.stderr.on("data", (c: Buffer) => stderr.push(c.toString("utf8")));
	proc.on("exit", () => { exited = true; });	try {
		const wsUrl = await waitForBanner(proc, stderr, opts.timeoutMs ?? 8000);
		await new Promise((r) => setTimeout(r, 150));
		const client = await CdpClient.connect(wsUrl, { timeoutMs: 5000 });
		try {
			await client.send("Profiler.enable", {});
			await client.send("Profiler.start", {});
			await client.send("Runtime.runIfWaitingForDebugger", {});
			// Wait the requested duration, but bail early if the script exits. A
			// fast script completes before the full duration and would otherwise
			// leave Profiler.stop talking to a closed connection.
			const start = Date.now();
			while (Date.now() - start < durationMs && !exited) {
				await new Promise((r) => setTimeout(r, Math.min(50, durationMs)));
			}
			let profile: CpuProfile = {};
			let earlyExit = false;
			try {
				const stopRes = (await client.send("Profiler.stop", {}, { timeoutMs: 2000 })) as { profile?: CpuProfile };
				profile = stopRes.profile ?? {};
			} catch {
				// Script exited before the profiler could be stopped; no samples.
				earlyExit = true;
			}
			const sampleCount = profile.samples?.length ?? 0;
			const top = parseProfileTopFunctions(profile);
			const outFile = path.resolve(opts.cwd ?? process.cwd(), opts.outFile ?? "rap-cpu-profile.cpuprofile");
			fs.writeFileSync(outFile, JSON.stringify(profile));
			return { file: outFile, durationMs, sampleCount, topFunctions: top, earlyExit };
		} finally {
			client.close();
		}
	} finally {
		try {
			proc.kill("SIGKILL");
		} catch {
			// ignore
		}
	}
}

function waitForBanner(proc: ChildProcessWithoutNullStreams, stderr: string[], timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("CPU profile target did not expose inspector: " + stderr.join(""))), timeoutMs);
		const check = () => {
			const url = parseInspectUrl(stderr.join(""));
			if (url) {
				clearTimeout(timer);
				resolve(url);
			} else if (proc.killed) {
				clearTimeout(timer);
				reject(new Error("target exited before inspector banner"));
			} else {
				setTimeout(check, 50);
			}
		};
		check();
	});
}
