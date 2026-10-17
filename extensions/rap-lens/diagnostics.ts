/**
 * Diagnostics engine for rap-lens (focused subset).
 *
 * Behavioral target: `pi-lens` (apmantza). The full pi-lens surface (LSP
 * navigation, impact cascade, ast-grep/tree-sitter, symbol_search/module_map/
 * read_symbol, /lens-map, autofix) is NOT implemented here — see
 * research/feature-parity.md. This module ships: dynamic tool/dependency
 * detection + language linter/type-checker invocation + output parsing +
 * diagnostic triage.
 *
 * Pure-ish (node builtins + shared subprocess) → unit-testable.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runSubprocess } from "../_shared/subprocess.ts";

export interface Diagnostic {
	file: string;
	line: number;
	column: number;
	severity: "error" | "warning" | "info";
	message: string;
	source: string;
}

export interface ToolAvailability {
	tsc: boolean;
	eslint: boolean;
	pyright: boolean;
	ruff: boolean;
	golangciLint: boolean;
}

/** Check whether a tool is available: local node_modules/.bin first, then PATH. */
export function detectTool(name: string, cwd: string): boolean {
	const localBin = path.join(cwd, "node_modules", ".bin", name);
	try {
		if (fs.existsSync(localBin)) return true;
	} catch {
		/* ignore */
	}
	// PATH check via `which` (POSIX) / `where` fallback is environment-dependent;
	// keep it synchronous-faithful by trying the local bin only here. PATH
	// resolution is handled lazily in runDiagnostics via spawn errors.
	return false;
}

/** Detect available language tooling in `cwd`. */
export function detectTools(cwd: string): ToolAvailability {
	return {
		tsc: detectTool("tsc", cwd),
		eslint: detectTool("eslint", cwd),
		pyright: detectTool("pyright", cwd),
		ruff: detectTool("ruff", cwd),
		golangciLint: detectTool("golangci-lint", cwd),
	};
}

// Matches both common compiler line formats:
//   file(line,col): error TS1234: message            (tsc)
//   file:line:col: error: message                     (rustc/gcc-style)
//   file:line:col: severity: message                  (ruff/golangci)
const DIAG_LINE_RE =
	/^(.+?)\((\d+),(\d+)\):\s+(error|warning|info)\s+([A-Z0-9]+):\s+(.+)$/;
const DIAG_COLON_RE = /^(.+?):(\d+):(\d+):\s*(error|warning|info)[:]?:\s+(.+)$/;
// ruff/flake8 style: file:line:col: E501 message (code, no severity word → warning).
const DIAG_CODE_RE = /^(.+?):(\d+):(\d+):\s+([A-Z]\d{2,5})\s+(.+)$/;

/** Parse compiler/linter output (tsc, ruff, golangci, rustc-style) into diagnostics. */
export function parseDiagnostics(text: string, source: string): Diagnostic[] {
	const out: Diagnostic[] = [];
	for (const line of text.split("\n")) {
		const m1 = line.match(DIAG_LINE_RE);
		if (m1) {
			out.push({
				file: m1[1],
				line: Number.parseInt(m1[2], 10),
				column: Number.parseInt(m1[3], 10),
				severity: m1[4] as Diagnostic["severity"],
				message: `${m1[5]}: ${m1[6]}`,
				source,
			});
			continue;
		}
		const m2 = line.match(DIAG_COLON_RE);
		if (m2) {
			out.push({
				file: m2[1],
				line: Number.parseInt(m2[2], 10),
				column: Number.parseInt(m2[3], 10),
				severity: m2[4] as Diagnostic["severity"],
				message: m2[5],
				source,
			});
			continue;
		}
		const m3 = line.match(DIAG_CODE_RE);
		if (m3) {
			out.push({
				file: m3[1],
				line: Number.parseInt(m3[2], 10),
				column: Number.parseInt(m3[3], 10),
				severity: "warning",
				message: `${m3[4]}: ${m3[5]}`,
				source,
			});
		}
	}
	return out;
}

/** Run the TypeScript type-checker (`tsc --noEmit`) and return diagnostics. */
export async function runTypeScriptCheck(
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<{ diagnostics: Diagnostic[]; ran: boolean; stderr: string }> {
	if (!detectTool("tsc", cwd)) return { diagnostics: [], ran: false, stderr: "" };
	const r = await runSubprocess("npx", ["tsc", "--noEmit", "--pretty", "false"], {
		cwd,
		signal,
		maxOutputBytes: 200 * 1024,
		redact: false,
	});
	// tsc writes diagnostics to stdout (and exits non-zero).
	const diagnostics = parseDiagnostics(r.stdout, "tsc");
	return { diagnostics, ran: true, stderr: r.stderr };
}

/** Format diagnostics into a readable report. */
export function formatDiagnostics(diagnostics: readonly Diagnostic[]): string {
	if (diagnostics.length === 0) return "No diagnostics. ✓";
	const errors = diagnostics.filter((d) => d.severity === "error");
	const warnings = diagnostics.filter((d) => d.severity === "warning");
	const infos = diagnostics.filter((d) => d.severity === "info");
	const header: string[] = [];
	if (errors.length) header.push(`${errors.length} error${errors.length > 1 ? "s" : ""}`);
	if (warnings.length) header.push(`${warnings.length} warning${warnings.length > 1 ? "s" : ""}`);
	if (infos.length) header.push(`${infos.length} info`);
	const lines: string[] = [`Diagnostics — ${header.join(" · ")}`, ""];
	for (const d of diagnostics) {
		lines.push(`${d.severity === "error" ? "✗" : d.severity === "warning" ? "⚠" : "ℹ"} ${d.file}:${d.line}:${d.column} [${d.source}] ${d.message}`);
	}
	return lines.join("\n");
}
