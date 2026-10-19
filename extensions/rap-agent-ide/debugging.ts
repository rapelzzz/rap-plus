/**
 * Debugging for rap-agent-ide.
 *
 * Drives a Node target under `--inspect-brk` via the CDP client: start
 * (paused at entry), set/remove
 * breakpoints, resume & step, evaluate expressions in the paused frame, and
 * report the paused call stack + local variables.
 *
 * State machine: a session is either PAUSED (hit entry/breakpoint/step) or
 * RUNNING. Resume/step resolve when the next pause arrives (or a timeout if
 * the program runs to completion).
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pathToFileURL } from "node:url";
import { CdpClient, parseInspectUrl } from "./cdp.ts";

export interface ScopeVar {
	name: string;
	value: string;
	type: string;
}

export interface CallFrameInfo {
	functionName: string;
	file: string;
	line: number;
	column: number;
	vars: ScopeVar[];
}

export interface PausedState {
	paused: boolean;
	reason: string;
	callFrames: CallFrameInfo[];
}

const NOT_PAUSED: PausedState = { paused: false, reason: "running", callFrames: [] };
const STEP_TIMEOUT_MS = 10000;
/** Timeout for resume: a pause is usually hit within milliseconds. A program
 * that runs to completion keeps the process alive (the inspector connection
 * prevents exit), so we must not block for the full step timeout. */
const RESUME_TIMEOUT_MS = 3000;
const MAX_VARS = 20;

interface PausedEventParams {
	reason: string;
	callFrames: Array<{
		callFrameId: string;
		functionName: string;
		location: { scriptId: string; lineNumber: number; columnNumber: number; url?: string };
		scopeChain: Array<{ type: string; object: { objectId?: string } }>;
	}>;
}

export class DebugSession {
	readonly id: string;
	private proc: ChildProcessWithoutNullStreams | null = null;
	private client: CdpClient | null = null;
	private scriptUrlToId = new Map<string, string>();
	private state: PausedState = NOT_PAUSED;
	private exited = false;
	private topCallFrameId: string | null = null;
	private topLocalScopeObjectId: string | null = null;
	private resolvePause: ((s: PausedState) => void) | null = null;

	private constructor(id: string) {
		this.id = id;
	}

	/** Spawn `node --inspect-brk` on `script`, connect, enable domains, await entry pause. */
	static async start(script: string, opts: { args?: string[]; cwd?: string; timeoutMs?: number } = {}): Promise<DebugSession> {
		const id = `dbg-${Date.now()}`;
		const session = new DebugSession(id);
		// `script` is a single file path — never split on whitespace, or paths
		// containing spaces break. Extra CLI args are passed via opts.args.
		const args = ["--inspect-brk=0", script, ...(opts.args ?? [])];
		const proc = spawn(process.execPath, args, {
			cwd: opts.cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});
		session.proc = proc;
		const stderr: string[] = [];
		proc.stderr.on("data", (c: Buffer) => stderr.push(c.toString("utf8")));
		// Detect program completion so waitForPause doesn't block for the full
		// timeout after the last breakpoint/resume runs the program to exit.
		proc.on("exit", (code, sig) => {
			session.exited = true;
			session.state = { ...NOT_PAUSED, reason: sig ? `exited (signal ${sig})` : `exited (code ${code ?? 0})` };
			if (session.resolvePause) {
				const r = session.resolvePause;
				session.resolvePause = null;
				r(NOT_PAUSED);
			}
		});

		try {
			// Wait for the inspector banner. Track both timers and child exit so
			// startup failure never leaves a poll timer or debug process running.
			const wsUrl = await new Promise<string>((resolve, reject) => {
				let timeout: NodeJS.Timeout | undefined;
				let poll: NodeJS.Timeout | undefined;
				let settled = false;
				const cleanup = () => {
					if (timeout) clearTimeout(timeout);
					if (poll) clearTimeout(poll);
					proc.removeListener("exit", onExit);
				};
				const fail = (error: Error) => {
					if (settled) return;
					settled = true;
					cleanup();
					reject(error);
				};
				const onExit = () => fail(new Error("debug target exited before inspector banner: " + stderr.join("")));
				const check = () => {
					if (settled) return;
					const url = parseInspectUrl(stderr.join(""));
					if (url) {
						settled = true;
						cleanup();
						resolve(url);
					} else if (session.exited || proc.exitCode !== null || proc.signalCode !== null) {
						fail(new Error("debug target exited before inspector banner: " + stderr.join("")));
					} else {
						poll = setTimeout(check, 50);
					}
				};
				timeout = setTimeout(() => fail(new Error("debug target did not expose inspector: " + stderr.join(""))), opts.timeoutMs ?? 8000);
				proc.once("exit", onExit);
				check();
			});
			await new Promise((r) => setTimeout(r, 150));

			const client = await CdpClient.connect(wsUrl, { timeoutMs: 5000 });
			session.client = client;
			client.on("Debugger.paused", (params) => session.handlePaused(params as PausedEventParams));
			client.on("Debugger.scriptParsed", (params: unknown) => {
				const p = params as { scriptId: string; url?: string };
				if (p.url) session.scriptUrlToId.set(p.url, p.scriptId);
			});
			await client.send("Runtime.enable", {});
			await client.send("Debugger.enable", {});
			await client.send("Runtime.runIfWaitingForDebugger", {});
			const paused = await session.waitForPause(opts.timeoutMs ?? 8000);
			if (!paused.paused) throw new Error(`debug target did not pause at entry: ${paused.reason}`);
			return session;
		} catch (error) {
			await session.stop();
			throw error;
		}
	}

	private handlePaused(params: PausedEventParams): void {
		const frames: CallFrameInfo[] = params.callFrames.slice(0, 5).map((f) => ({
			functionName: f.functionName || "<anonymous>",
			file: f.location.url || `<scriptId:${f.location.scriptId}>`,
			line: f.location.lineNumber + 1,
			column: f.location.columnNumber + 1,
			vars: [],
		}));
		this.topCallFrameId = params.callFrames[0]?.callFrameId ?? null;
		const localScope = params.callFrames[0]?.scopeChain.find((s) => s.type === "local");
		this.topLocalScopeObjectId = localScope?.object.objectId ?? null;
		this.state = { paused: true, reason: params.reason, callFrames: frames };
		if (this.resolvePause) {
			const r = this.resolvePause;
			this.resolvePause = null;
			r(this.state);
		}
	}

	private waitForPause(timeoutMs: number): Promise<PausedState> {
		// Race guard: if the pause event arrived before we started waiting (e.g.
		// the entry pause fired during Debugger.enable), resolve immediately.
		if (this.state.paused) return Promise.resolve(this.state);
		// Program already exited: don't wait for a pause that will never come.
		if (this.exited) return Promise.resolve(NOT_PAUSED);
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.resolvePause = null;
				resolve(NOT_PAUSED);
			}, timeoutMs);
			this.resolvePause = (s) => {
				clearTimeout(timer);
				resolve(s);
			};
		});
	}

	/** Set a breakpoint at a file:line. Returns the breakpoint id. */
	async setBreakpoint(file: string, line: number): Promise<{ breakpointId: string }> {
		if (!this.client) throw new Error("debug session not started");
		const url = pathToFileURL(file).href;
		const res = (await this.client.send("Debugger.setBreakpointByUrl", {
			lineNumber: line - 1,
			url,
		})) as { breakpointId: string };
		return { breakpointId: res.breakpointId };
	}

	/** Remove a breakpoint by id. */
	async removeBreakpoint(breakpointId: string): Promise<void> {
		if (!this.client) throw new Error("debug session not started");
		await this.client.send("Debugger.removeBreakpoint", { breakpointId });
	}

	/** Resume execution; resolve when the next pause arrives (or timeout). */
	async resume(): Promise<PausedState> {
		if (!this.client || !this.state.paused) return NOT_PAUSED;
		this.state = NOT_PAUSED;
		this.topCallFrameId = null;
		await this.client.send("Debugger.resume", {});
		return this.waitForPause(RESUME_TIMEOUT_MS);
	}

	/** Step over the current statement. */
	async stepOver(): Promise<PausedState> {
		return this.step("stepOver");
	}

	/** Step into the current statement. */
	async stepInto(): Promise<PausedState> {
		return this.step("stepInto");
	}

	/** Step out of the current function. */
	async stepOut(): Promise<PausedState> {
		return this.step("stepOut");
	}

	private async step(method: "stepOver" | "stepInto" | "stepOut"): Promise<PausedState> {
		if (!this.client || !this.state.paused) return NOT_PAUSED;
		this.state = NOT_PAUSED;
		this.topCallFrameId = null;
		await this.client.send(`Debugger.${method}`, {});
		return this.waitForPause(STEP_TIMEOUT_MS);
	}

	/** Evaluate an expression in the paused frame (or global if not paused). */
	async evaluate(expression: string): Promise<{ result: string; type: string }> {
		if (!this.client) throw new Error("debug session not started");
		if (this.state.paused && this.topCallFrameId) {
			const res = (await this.client.send("Debugger.evaluateOnCallFrame", {
				callFrameId: this.topCallFrameId,
				expression,
				returnByValue: true,
			})) as { result?: { type?: string; value?: unknown; description?: string } };
			const r = res.result;
			return { result: String(r?.value ?? r?.description ?? ""), type: r?.type ?? "unknown" };
		}
		const res = (await this.client.send("Runtime.evaluate", { expression, returnByValue: true })) as {
			result?: { type?: string; value?: unknown; description?: string };
		};
		const r = res.result;
		return { result: String(r?.value ?? r?.description ?? ""), type: r?.type ?? "unknown" };
	}

	/** Fetch local variables for the top frame via Runtime.getProperties. */
	async inspectLocals(): Promise<ScopeVar[]> {
		if (!this.client || !this.state.paused || !this.topLocalScopeObjectId) return [];
		const res = (await this.client.send("Runtime.getProperties", {
			objectId: this.topLocalScopeObjectId,
			ownProperties: true,
		})) as { result?: Array<{ name: string; value?: { type?: string; value?: unknown; description?: string } }> };
		const props = res.result ?? [];
		const vars: ScopeVar[] = props.slice(0, MAX_VARS).map((p) => ({
			name: p.name,
			type: p.value?.type ?? "unknown",
			value: String(p.value?.value ?? p.value?.description ?? ""),
		}));
		if (this.state.callFrames[0]) this.state.callFrames[0].vars = vars;
		return vars;
	}

	/** Current paused state (cached from the last pause event). */
	async status(): Promise<PausedState> {
		return this.state;
	}

	/** Stop the debug target and close the client. */
	async stop(): Promise<void> {
		if (this.client) {
			try {
				await this.client.send("Debugger.disable", {});
			} catch {
				// ignore
			}
			this.client.close();
			this.client = null;
		}
		if (this.proc) {
			try {
				this.proc.kill("SIGKILL");
			} catch {
				// ignore
			}
			this.proc = null;
		}
		this.state = NOT_PAUSED;
	}
}
