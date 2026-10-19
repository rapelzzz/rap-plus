/**
 * Terminal pool for rap-agent-ide.
 *
 * Manages persistent non-interactive shell sessions (one `bash` per
 * session) that stay alive
 * across `send` calls, so the model can run sequences of commands in a
 * shared working directory / env. Each `send` waits for a unique sentinel
 * marker (via async polling that yields to the event loop) so the returned
 * output corresponds to that command.
 *
 * Pure helpers (truncateOutput, formatSessionList) are unit-tested.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface TerminalSession {
	id: string;
	pid: number;
	cwd: string;
	alive: boolean;
	createdAt: number;
	lastCommand: string;
}

export interface SendResult {
	id: string;
	stdout: string;
	stderr: string;
	exitCode: number | null;
	timedOut: boolean;
}

const DEFAULT_SHELL = process.env.SHELL || "/bin/bash";
const DEFAULT_MAX_BUFFER = 262144; // 256KB per stream
const DEFAULT_WAIT_MS = 8000;
export const MAX_SESSIONS = 8;

/** Pure: cap output to maxBytes with an ellipsis notice. */
export function truncateOutput(buf: string, maxBytes: number): string {
	if (Buffer.byteLength(buf, "utf8") <= maxBytes) return buf;
	const cut = Buffer.from(buf, "utf8").subarray(0, maxBytes).toString("utf8");
	return cut + `\n…[truncated ${Buffer.byteLength(buf, "utf8") - maxBytes} bytes]`;
}

/** Pure: format the session list for display. */
export function formatSessionList(sessions: readonly TerminalSession[]): string {
	if (sessions.length === 0) return "No terminal sessions.";
	return sessions
		.map((s) => `${s.alive ? "●" : "○"} ${s.id} (pid ${s.pid}, cwd ${s.cwd})${s.lastCommand ? ` last: ${s.lastCommand.slice(0, 60)}` : ""}`)
		.join("\n");
}

interface SessionState {
	id: string;
	proc: ChildProcessWithoutNullStreams;
	cwd: string;
	stdout: string;
	stderr: string;
	alive: boolean;
	exitCode: number | null;
	createdAt: number;
	lastCommand: string;
	maxBuffer: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class TerminalPool {
	private readonly sessions = new Map<string, SessionState>();
	private counter = 0;
	private readonly shell: string;
	private readonly maxBuffer: number;

	constructor(opts: { shell?: string; maxBuffer?: number } = {}) {
		this.shell = opts.shell ?? DEFAULT_SHELL;
		this.maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
	}

	/** Create a persistent shell session. Returns the session id. */
	create(cwd: string, env: Record<string, string> = {}): string {
		// Reclaim slots held by dead sessions so the pool never refuses a new
		// session just because MAX_SESSIONS dead ones are still in the map.
		this.pruneDead();
		if (this.sessions.size >= MAX_SESSIONS) {
			throw new Error(`terminal pool full (max ${MAX_SESSIONS} sessions)`);
		}
		const id = `term-${++this.counter}`;
		const proc = spawn(this.shell, [], {
			cwd,
			env: { ...process.env, ...env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		const maxBuffer = this.maxBuffer;
		const state: SessionState = {
			id,
			proc,
			cwd,
			stdout: "",
			stderr: "",
			alive: true,
			exitCode: null,
			createdAt: Date.now(),
			lastCommand: "",
			maxBuffer,
		};
		const appendCapped = (buf: string, chunk: Buffer): string => truncateOutput(buf + chunk.toString("utf8"), maxBuffer);
		proc.stdout.on("data", (chunk: Buffer) => { state.stdout = appendCapped(state.stdout, chunk); });
		proc.stderr.on("data", (chunk: Buffer) => { state.stderr = appendCapped(state.stderr, chunk); });
		// Child processes can exit between the alive check and stdin.write(). On
		// POSIX, the resulting EPIPE is emitted asynchronously by the Writable;
		// a surrounding try/catch cannot catch it. Observe stream errors so a
		// dead shell never raises an uncaught exception in the host process.
		proc.stdin.on("error", (error: NodeJS.ErrnoException) => {
			state.alive = false;
			if (error.code !== "EPIPE") {
				state.stderr = appendCapped(state.stderr, Buffer.from(`terminal stdin error: ${error.message}\\n`));
			}
		});
		proc.on("exit", (code) => {
			state.alive = false;
			state.exitCode = code;
		});
		this.sessions.set(id, state);
		return id;
	}

	/**
	 * Send `command` to session `id`. Appends a unique sentinel and waits for it
	 * (up to waitMs, polling async so the event loop can drain stream data),
	 * returning the output produced by this command. The session stays alive.
	 */
	async send(id: string, command: string, opts: { waitMs?: number } = {}): Promise<SendResult> {
		const s = this.sessions.get(id);
		if (!s) throw new Error(`no terminal session: ${id}`);
		if (!s.alive) throw new Error(`terminal ${id} is not alive`);
		const waitMs = opts.waitMs ?? DEFAULT_WAIT_MS;
		const marker = `__RAP_TERM_END_${this.counter}_${Date.now()}__`;
		const beforeOut = s.stdout.length;
		const beforeErr = s.stderr.length;
		s.lastCommand = command;
		// Writing to a shell that has just exited can fail synchronously or
		// asynchronously. The persistent stdin error listener above handles the
		// asynchronous EPIPE path; this guard handles already-closed streams.
		if (!s.proc.stdin.writable || s.proc.stdin.destroyed) {
			s.alive = false;
			return {
				id,
				stdout: s.stdout.slice(beforeOut),
				stderr: s.stderr.slice(beforeErr),
				exitCode: s.exitCode,
				timedOut: true,
			};
		}
		try {
			s.proc.stdin.write(command + "\n");
			s.proc.stdin.write(`printf '%s\\n' '${marker}'\n`);
		} catch {
			s.alive = false;
			return {
				id,
				stdout: s.stdout.slice(beforeOut),
				stderr: s.stderr.slice(beforeErr),
				exitCode: s.exitCode,
				timedOut: true,
			};
		}
		const deadline = Date.now() + waitMs;
		let sawMarker = false;
		while (Date.now() < deadline) {
			if (s.stdout.includes(marker)) {
				sawMarker = true;
				break;
			}
			await sleep(15);
		}
		let out: string;
		let err: string;
		if (s.stdout.length >= beforeOut) {
			out = s.stdout.slice(beforeOut);
			err = s.stderr.slice(beforeErr);
		} else {
			// The buffer was capped (oldest content dropped) during the command, so
			// `beforeOut` now points into discarded content and slice() would return
			// empty. Best-effort: take the kept tail up to the marker.
			out = s.stdout;
			err = s.stderr;
		}
		const markerIdx = out.indexOf(marker);
		if (markerIdx >= 0) {
			out = out.slice(0, markerIdx).replace(/\n$/, "");
		}
		return {
			id,
			stdout: out,
			stderr: err,
			exitCode: s.exitCode,
			timedOut: !sawMarker,
		};
	}

	/** Remove dead sessions from the map, freeing their slots. */
	private pruneDead(): void {
		for (const [id, s] of this.sessions) {
			if (!s.alive) this.sessions.delete(id);
		}
	}

	/** Read the full accumulated output without consuming. */
	output(id: string): { stdout: string; stderr: string; alive: boolean } {
		const s = this.sessions.get(id);
		if (!s) throw new Error(`no terminal session: ${id}`);
		return { stdout: s.stdout, stderr: s.stderr, alive: s.alive };
	}

	/** Kill a session. Returns true if it existed and was removed. */
	kill(id: string): boolean {
		const s = this.sessions.get(id);
		if (!s) return false;
		if (s.alive) {
			try {
				s.proc.stdin.end();
			} catch {
				// ignore
			}
			s.proc.kill("SIGTERM");
		}
		s.alive = false;
		this.sessions.delete(id);
		return true;
	}

	/** List all live + recently-dead sessions. */
	list(): TerminalSession[] {
		return [...this.sessions.values()].map((s) => ({
			id: s.id,
			pid: s.proc.pid ?? -1,
			cwd: s.cwd,
			alive: s.alive,
			createdAt: s.createdAt,
			lastCommand: s.lastCommand,
		}));
	}

	/** Kill every session. Returns the count killed. */
	killAll(): number {
		let n = 0;
		for (const id of [...this.sessions.keys()]) {
			if (this.kill(id)) n++;
		}
		return n;
	}
}
