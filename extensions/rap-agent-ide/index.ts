/**
 * rap-agent-ide — guarded IDE-style assistance.
 *
 * Full surface:
 *   - Guarded editing (safety validation + interactive confirm)
 *   - Code search (ripgrep) + git diff inspection
 *   - Terminal pool (persistent shell sessions)
 *   - Debugging (node --inspect-brk via CDP: breakpoints, step, evaluate)
 *   - Observability (system metrics + CPU profile)
 *
 * Tools (all model-only):
 *   ide_search        — ripgrep code search (read-only).
 *   ide_diff          — git diff for a path (read-only).
 *   ide_edit_guarded  — write/edit a file with safety validation + confirm.
 *   ide_terminal      — persistent shell sessions: create/send/list/output/kill.
 *   ide_debug_run     — start a script under the debugger (paused at entry).
 *   ide_debug         — control a debug session: breakpoint/resume/step/evaluate/stop.
 *   ide_system_metrics — host/cpu/memory metrics (read-only).
 *   ide_cpu_profile   — capture a .cpuprofile of a script.
 */

import { Type } from "typebox";
import * as fs from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isSensitivePath, relFrom, validateEdit, validateEditInputShape, validateEditTarget } from "./guard.ts";
import { formatHits, runSearch } from "./search.ts";
import { runSubprocess } from "../_shared/subprocess.ts";
import { TerminalPool, formatSessionList } from "./terminal.ts";
import { DebugSession } from "./debugging.ts";
import { collectSystemMetrics, formatSystemMetrics, captureCpuProfile } from "./observability.ts";

export default function rapAgentIde(pi: ExtensionAPI): void {
	const terminals = new TerminalPool();
	const debugSessions = new Map<string, DebugSession>();

	// Interactive processes must never outlive the session runtime that owns them.
	pi.on("session_shutdown", async () => {
		terminals.killAll();
		await Promise.all([...debugSessions.values()].map(async (session) => {
			try { await session.stop(); } catch { /* cleanup is best-effort and idempotent */ }
		}));
		debugSessions.clear();
	});

	pi.registerTool({
		name: "ide_search",
		label: "IDE Search",
		description: "Search project code with ripgrep (regex). Returns file:line:column:match hits. Read-only.",
		parameters: Type.Object({
			pattern: Type.String({ description: "Regex pattern to search for" }),
			case_sensitive: Type.Optional(Type.Boolean({ description: "Case-sensitive match (default false)" })),
			whole_word: Type.Optional(Type.Boolean({ description: "Match whole words only (default false)" })),
			glob: Type.Optional(Type.String({ description: "Glob filter, e.g. '*.ts'" })),
			max_results: Type.Optional(Type.Number({ description: "Max hits to return" })),
		}),
		annotations: { readOnlyHint: true },
		exposure: "model-only",
		async execute(_id, params, signal, _onUpdate, ctx) {
			const { hits, ran, error } = await runSearch(ctx.cwd, params.pattern, {
				caseSensitive: params.case_sensitive,
				wholeWord: params.whole_word,
				glob: params.glob,
				maxResults: params.max_results,
			}, signal);
			if (!ran) return { content: [{ type: "text", text: `Search unavailable: ${error || "ripgrep not found"}` }], details: undefined };
			return { content: [{ type: "text", text: formatHits(hits) }], details: undefined };
		},
	});

	pi.registerTool({
		name: "ide_diff",
		label: "IDE Diff",
		description: "Show the git diff for a given file path (working tree vs HEAD). Read-only.",
		parameters: Type.Object({
			file_path: Type.String({ description: "File path to diff" }),
			staged: Type.Optional(Type.Boolean({ description: "Diff staged changes (default false)" })),
		}),
		annotations: { readOnlyHint: true },
		exposure: "model-only",
		async execute(_id, params, signal, _onUpdate, ctx) {
			if (isSensitivePath(ctx.cwd, params.file_path)) {
				return { content: [{ type: "text", text: "Refusing to diff a sensitive path." }], details: undefined };
			}
			const r = await runSubprocess("git", ["diff", ...(params.staged ? ["--staged"] : []), "--", params.file_path], {
				cwd: ctx.cwd, signal, maxOutputBytes: 100 * 1024, redact: false,
			});
			const diff = r.stdout.trim();
			return { content: [{ type: "text", text: diff ? diff : `No changes for ${params.file_path}.` }], details: undefined };
		},
	});

	pi.registerTool({
		name: "ide_edit_guarded",
		label: "IDE Guarded Edit",
		description:
			"Write or edit a file with safety validation: path must be within the project root, sensitive paths (.env, credentials, SSH keys) are blocked, size limits enforced, and the user is asked to confirm before applying.",
		parameters: Type.Object({
			file_path: Type.String({ description: "File path to write/edit" }),
			content: Type.Optional(Type.String({ description: "Full new file content (write mode)" })),
			old_text: Type.Optional(Type.String({ description: "Existing text to replace (edit mode)" })),
			new_text: Type.Optional(Type.String({ description: "Replacement text (edit mode)" })),
		}),
		annotations: { readOnlyHint: false },
		exposure: "model-only",
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const inputShapeError = validateEditInputShape(params);
			if (inputShapeError) {
				return { content: [{ type: "text", text: `Blocked: ${inputShapeError}` }], details: undefined, isError: true };
			}
			const hasOldText = params.old_text !== undefined;
			const hasNewText = params.new_text !== undefined;
			const isEdit = hasOldText && hasNewText;
			const guard = isEdit
				? validateEdit(ctx.cwd, params.file_path, params.old_text!, params.new_text!)
				: validateEditTarget(ctx.cwd, params.file_path, params.content ?? "");
			if (!guard.ok) return { content: [{ type: "text", text: `Blocked: ${guard.reason}` }], details: undefined };
			const abs = guard.absPath!;
			// Approval is mandatory. Headless/no-UI execution fails closed.
			if (!ctx.hasUI || !ctx.ui?.confirm) {
				return { content: [{ type: "text", text: "Blocked: interactive confirmation is unavailable; no file was changed." }], details: undefined, isError: true };
			}
			const verb = isEdit ? "edit" : "write";
			const ok = await ctx.ui.confirm("rap-agent-ide", `${verb} ${relFrom(ctx.cwd, abs)}?`);
			if (!ok) return { content: [{ type: "text", text: "Edit cancelled by user." }], details: undefined };
			try {
				if (isEdit) {
					const existing = await fs.readFile(abs, "utf8");
					const occurrences = existing.split(params.old_text!).length - 1;
					if (occurrences !== 1) {
						return { content: [{ type: "text", text: occurrences === 0
							? "old_text not found in file; edit aborted (no changes)."
							: `old_text matched ${occurrences} times; provide a unique anchor (no changes made).` }], details: undefined };
					}
					await fs.writeFile(abs, existing.replace(params.old_text!, params.new_text!), "utf8");
					return { content: [{ type: "text", text: `Edited ${relFrom(ctx.cwd, abs)}.` }], details: undefined };
				}
				await fs.writeFile(abs, params.content ?? "", "utf8");
				return { content: [{ type: "text", text: `Wrote ${relFrom(ctx.cwd, abs)} (${Buffer.byteLength(params.content ?? "", "utf8")} bytes).` }], details: undefined };
			} catch (err) {
				return { content: [{ type: "text", text: `Edit failed: ${err instanceof Error ? err.message : String(err)}` }], details: undefined, isError: true };
			}
		},
	});

	// --- terminal pool ---

	pi.registerTool({
		name: "ide_terminal",
		label: "IDE Terminal",
		description: "Persistent shell sessions. action: create (returns id), send (run a command, returns its output), list, output (full buffer), kill.",
		parameters: Type.Object({
			action: Type.String({ description: "create | send | list | output | kill" }),
			id: Type.Optional(Type.String({ description: "Session id (for send/output/kill)" })),
			command: Type.Optional(Type.String({ description: "Command to run (for send)" })),
			cwd: Type.Optional(Type.String({ description: "Working directory (for create); defaults to project root" })),
		}),
		annotations: { readOnlyHint: false },
		exposure: "model-only",
		async execute(_id, params, _signal, _onUpdate, ctx) {
			try {
				switch (params.action) {
					case "create": {
						const id = terminals.create(params.cwd || ctx.cwd);
						return { content: [{ type: "text", text: `Created terminal ${id}` }], details: undefined };
					}
					case "send": {
						if (!params.id || !params.command) return { content: [{ type: "text", text: "send requires id and command" }], details: undefined };
						const res = await terminals.send(params.id, params.command);
						return { content: [{ type: "text", text: `exit:${res.exitCode}\n${res.stdout}${res.stderr ? `\n[stderr]\n${res.stderr}` : ""}` }], details: undefined };
					}
					case "list": {
						return { content: [{ type: "text", text: formatSessionList(terminals.list()) }], details: undefined };
					}
					case "output": {
						if (!params.id) return { content: [{ type: "text", text: "output requires id" }], details: undefined };
						const o = terminals.output(params.id);
						return { content: [{ type: "text", text: `alive:${o.alive}\n${o.stdout}` }], details: undefined };
					}
					case "kill": {
						if (!params.id) return { content: [{ type: "text", text: "kill requires id" }], details: undefined };
						return { content: [{ type: "text", text: terminals.kill(params.id) ? `Killed ${params.id}` : `No such session ${params.id}` }], details: undefined };
					}
					default:
						return { content: [{ type: "text", text: `Unknown action: ${params.action}` }], details: undefined };
				}
			} catch (err) {
				return { content: [{ type: "text", text: `terminal error: ${err instanceof Error ? err.message : String(err)}` }], details: undefined, isError: true };
			}
		},
	});

	// --- debugging ---

	pi.registerTool({
		name: "ide_debug_run",
		label: "IDE Debug Run",
		description: "Start a script under the Node debugger (--inspect-brk). Pauses at entry. Returns a session id and the paused call stack. Use ide_debug to control it.",
		parameters: Type.Object({
			script: Type.String({ description: "Script file to debug (absolute or relative to cwd)" }),
			args: Type.Optional(Type.Array(Type.String(), { description: "Extra args to pass after the script" })),
		}),
		annotations: { readOnlyHint: false },
		exposure: "model-only",
		async execute(_id, params, _signal, _onUpdate, ctx) {
			try {
				const session = await DebugSession.start(params.script, { args: params.args, cwd: ctx.cwd });
				debugSessions.set(session.id, session);
				const status = await session.status();
				return { content: [{ type: "text", text: `Debug session ${session.id}\n${formatPaused(status)}` }], details: undefined };
			} catch (err) {
				return { content: [{ type: "text", text: `debug start failed: ${err instanceof Error ? err.message : String(err)}` }], details: undefined, isError: true };
			}
		},
	});

	pi.registerTool({
		name: "ide_debug",
		label: "IDE Debug Control",
		description: "Control a debug session. action: breakpoint (file+line), removeBreakpoint (breakpointId), resume, stepOver, stepInto, stepOut, evaluate (expression), locals, status, stop.",
		parameters: Type.Object({
			id: Type.String({ description: "Debug session id" }),
			action: Type.String({ description: "breakpoint | removeBreakpoint | resume | stepOver | stepInto | stepOut | evaluate | locals | status | stop" }),
			file: Type.Optional(Type.String({ description: "File for breakpoint" })),
			line: Type.Optional(Type.Number({ description: "1-based line for breakpoint" })),
			breakpointId: Type.Optional(Type.String({ description: "Breakpoint id to remove" })),
			expression: Type.Optional(Type.String({ description: "Expression to evaluate" })),
		}),
		annotations: { readOnlyHint: false },
		exposure: "model-only",
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const session = debugSessions.get(params.id);
			if (!session) return { content: [{ type: "text", text: `No debug session: ${params.id}` }], details: undefined };
			try {
				switch (params.action) {
					case "breakpoint": {
						if (!params.file || !params.line) return { content: [{ type: "text", text: "breakpoint requires file and line" }], details: undefined };
						const bp = await session.setBreakpoint(params.file, params.line);
						return { content: [{ type: "text", text: `Breakpoint set: ${bp.breakpointId}` }], details: undefined };
					}
					case "removeBreakpoint": {
						if (!params.breakpointId) return { content: [{ type: "text", text: "removeBreakpoint requires breakpointId" }], details: undefined };
						await session.removeBreakpoint(params.breakpointId);
						return { content: [{ type: "text", text: `Removed ${params.breakpointId}` }], details: undefined };
					}
					case "resume": {
						return { content: [{ type: "text", text: formatPaused(await session.resume()) }], details: undefined };
					}
					case "stepOver": {
						return { content: [{ type: "text", text: formatPaused(await session.stepOver()) }], details: undefined };
					}
					case "stepInto": {
						return { content: [{ type: "text", text: formatPaused(await session.stepInto()) }], details: undefined };
					}
					case "stepOut": {
						return { content: [{ type: "text", text: formatPaused(await session.stepOut()) }], details: undefined };
					}
					case "evaluate": {
						if (!params.expression) return { content: [{ type: "text", text: "evaluate requires expression" }], details: undefined };
						const ev = await session.evaluate(params.expression);
						return { content: [{ type: "text", text: `${ev.result} (${ev.type})` }], details: undefined };
					}
					case "locals": {
						const vars = await session.inspectLocals();
						return { content: [{ type: "text", text: vars.map((v) => `${v.name}: ${v.value} (${v.type})`).join("\n") || "no locals" }], details: undefined };
					}
					case "status": {
						return { content: [{ type: "text", text: formatPaused(await session.status()) }], details: undefined };
					}
					case "stop": {
						await session.stop();
						debugSessions.delete(params.id);
						return { content: [{ type: "text", text: `Stopped ${params.id}` }], details: undefined };
					}
					default:
						return { content: [{ type: "text", text: `Unknown action: ${params.action}` }], details: undefined };
				}
			} catch (err) {
				return { content: [{ type: "text", text: `debug error: ${err instanceof Error ? err.message : String(err)}` }], details: undefined, isError: true };
			}
		},
	});

	// --- observability ---

	pi.registerTool({
		name: "ide_system_metrics",
		label: "IDE System Metrics",
		description: "Report host/cpu/memory and process metrics (node:os). Read-only.",
		parameters: Type.Object({}),
		annotations: { readOnlyHint: true },
		exposure: "model-only",
		async execute() {
			return { content: [{ type: "text", text: formatSystemMetrics(collectSystemMetrics()) }], details: undefined };
		},
	});

	pi.registerTool({
		name: "ide_cpu_profile",
		label: "IDE CPU Profile",
		description: "Capture a CPU profile of an inline script for a duration, writing a .cpuprofile (Chrome DevTools format) and listing the hottest functions.",
		parameters: Type.Object({
			script: Type.String({ description: "Inline JS to profile (e.g. a workload)" }),
			duration_ms: Type.Optional(Type.Number({ description: "Profile duration in ms (default 2000)" })),
			out_file: Type.Optional(Type.String({ description: "Output .cpuprofile filename (default rap-cpu-profile.cpuprofile)" })),
		}),
		annotations: { readOnlyHint: false },
		exposure: "model-only",
		async execute(_id, params, _signal, _onUpdate, ctx) {
			try {
				const res = await captureCpuProfile(params.script, {
					cwd: ctx.cwd,
					durationMs: params.duration_ms,
					outFile: params.out_file,
				});
				const top = res.topFunctions.map((f) => `  ${f.hits} ${f.name}`).join("\n");
				return { content: [{ type: "text", text: `Profile written to ${relFrom(ctx.cwd, res.file)}\n${res.sampleCount} samples over ${res.durationMs}ms\nHottest:\n${top}` }], details: undefined };
			} catch (err) {
				return { content: [{ type: "text", text: `profile failed: ${err instanceof Error ? err.message : String(err)}` }], details: undefined, isError: true };
			}
		},
	});
}

function formatPaused(state: { paused: boolean; reason: string; callFrames: Array<{ functionName: string; file: string; line: number; column: number }> }): string {
	if (!state.paused) return "running (not paused)";
	const frames = state.callFrames.map((f) => `  ${f.functionName} @ ${f.file}:${f.line}:${f.column}`).join("\n");
	return `paused (${state.reason})\n${frames}`;
}
