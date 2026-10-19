/**
 * Subprocess runner with timeout, cancellation, output cap, and secret redaction.
 *
 * Uses argument-array execution (never shell string concatenation with
 * untrusted input) per the safety requirements.
 *
 * Pure-ish (only node: builtins) → testable with `node --test`.
 */

import { spawn } from "node:child_process";
import { redactSecrets, truncateToBytes } from "./safety.ts";

export interface RunOptions {
	cwd?: string;
	env?: Record<string, string>;
	/** Abort signal for cancellation. SIGTERM then SIGKILL after graceMs. */
	signal?: AbortSignal;
	/** Hard timeout in ms. Rejects with TimeoutError if exceeded. */
	timeoutMs?: number;
	/** Grace period between SIGTERM and SIGKILL on abort/timeout (default 5000). */
	graceMs?: number;
	/** Max combined stdout+stderr bytes (default 51200 = 50KB). */
	maxOutputBytes?: number;
	/** Redact secrets in captured output (default true). */
	redact?: boolean;
	/** stdin to write (default none). */
	stdin?: string;
}

export interface RunResult {
	command: string;
	args: readonly string[];
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	signal: NodeJS.Signals | null;
	wallMs: number;
}

export class TimeoutError extends Error {
	readonly command: string;
	constructor(command: string, ms: number) {
		super(`Command timed out after ${ms}ms: ${command}`);
		this.name = "TimeoutError";
		this.command = command;
	}
}

/**
 * Run `command args[]` (no shell). Captures output with caps + redaction,
 * supports cancellation and timeout. Resolves with a RunResult even on non-zero
 * exit (unless it was aborted/timed out, in which case it rejects).
 */
export function runSubprocess(
	command: string,
	args: readonly string[],
	options: RunOptions = {},
): Promise<RunResult> {
	const {
		cwd,
		env,
		signal,
		timeoutMs,
		graceMs = 5000,
		maxOutputBytes = 51200,
		redact = true,
		stdin,
	} = options;

	return new Promise((resolve, reject) => {
		const start = Date.now();
		const proc = spawn(command, args as string[], {
			cwd,
			env: env ? { ...process.env, ...env } : process.env,
			shell: false,
			stdio: [stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;
		let exited = false; // set when the process has actually exited (distinct from proc.killed)
		let graceTimer: NodeJS.Timeout | undefined;
		const perStreamCap = Math.floor(maxOutputBytes / 2);
		// Capture a small bounded lookahead beyond the user-visible cap so a
		// credential that straddles the output boundary can still be redacted
		// before truncation. Returned output remains capped at maxOutputBytes.
		const capturePerStreamCap = perStreamCap + 8192;

		const clean = (s: string) => redact ? redactSecrets(s) : s;

		// Redact after capture so secrets split across process chunks are still
		// found; bound raw capture independently to prevent unbounded memory use.
		const appendCapped = (buf: string, chunk: Buffer): string => {
			const currentBytes = Buffer.byteLength(buf, "utf8");
			if (currentBytes >= capturePerStreamCap) return buf;
			const remaining = capturePerStreamCap - currentBytes;
			return buf + chunk.subarray(0, remaining).toString("utf8");
		};
		const onOut = (chunk: Buffer) => { stdout = appendCapped(stdout, chunk); };
		const onErr = (chunk: Buffer) => { stderr = appendCapped(stderr, chunk); };
		proc.stdout?.on("data", onOut);
		proc.stderr?.on("data", onErr);

		if (stdin !== undefined && proc.stdin) {
			proc.stdin.end(stdin);
		}

		const finish = (exitCode: number, sig: NodeJS.Signals | null) => {
			if (settled) return;
			settled = true;
			exited = true;
			clear();
			const wallMs = Date.now() - start;
			// A signal-killed process (close gives code=null→0, sig set) must not
			// report exit 0; use -1 so callers don't mistake a kill for success.
			const reportedExit = sig != null ? -1 : exitCode;
			const result: RunResult = {
				command,
				args,
				exitCode: reportedExit,
				stdout: truncateToBytes(clean(stdout), perStreamCap),
				stderr: truncateToBytes(clean(stderr), perStreamCap),
				timedOut,
				signal: sig,
				wallMs,
			};
			if (timedOut) {
				reject(new TimeoutError(command, timeoutMs ?? 0));
			} else if (signal?.aborted) {
				reject(new Error(`Command aborted: ${command}`));
			} else {
				resolve(result);
			}
		};

		let timer: NodeJS.Timeout | undefined;
		const clearTimer = () => {
			if (timer) {
				clearTimeout(timer);
				timer = undefined;
			}
		};

		const killWithGrace = () => {
			if (exited) return;
			try {
				proc.kill("SIGTERM");
			} catch {
				/* process may have just exited */
			}
			if (graceTimer) clearTimeout(graceTimer);
			graceTimer = setTimeout(() => {
				// proc.killed reflects whether kill() was requested, not actual exit.
				if (!exited) {
					try { proc.kill("SIGKILL"); } catch { /* already gone */ }
				}
			}, graceMs);
			graceTimer.unref();
		};

		const onAbort = () => {
			killWithGrace();
		};

		const clear = () => {
			clearTimer();
			if (graceTimer) clearTimeout(graceTimer);
			signal?.removeEventListener("abort", onAbort);
		};

		if (signal) {
			if (signal.aborted) {
				killWithGrace();
			} else {
				signal.addEventListener("abort", onAbort, { once: true });
			}
		}
		if (timeoutMs) {
			timer = setTimeout(() => {
				timedOut = true;
				killWithGrace();
			}, timeoutMs);
		}

		proc.on("close", (code, sig) => finish(code ?? 0, sig ?? null));
		proc.on("error", (err) => {
			if (settled) return;
			settled = true;
			clear();
			reject(err);
		});
	});
}

/** Convenience: run a command, return trimmed stdout. Throws on non-zero exit. */
export async function runText(command: string, args: readonly string[], options: RunOptions = {}): Promise<string> {
	const r = await runSubprocess(command, args, options);
	if (r.exitCode !== 0) {
		throw new Error(`${command} exited ${r.exitCode}: ${r.stderr.trim() || r.stdout.trim()}`);
	}
	return r.stdout.trim();
}
