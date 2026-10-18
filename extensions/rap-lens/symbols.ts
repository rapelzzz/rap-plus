/**
 * Symbol discovery for rap-lens.
 *
 * Backed by the TypeScript LanguageService navigate APIs (symbol_search /
 * module_report / read_symbol). Falls back to a
 * regex scan when a project has no TypeScript LanguageService available.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { TsLanguageService, offsetToLineCol } from "./lsp.ts";

export interface SymbolHit {
	name: string;
	kind: string;
	file: string;
	line: number;
	column: number;
	containerName: string;
}

const KIND_LABELS: Record<string, string> = {
	class: "class",
	interface: "interface",
	type: "type",
	enum: "enum",
	function: "fn",
	method: "method",
	property: "prop",
	var: "var",
	let: "var",
	const: "const",
	module: "module",
	import: "import",
};

/** Symbol search by name across the whole project. */
export function symbolSearch(
	svc: TsLanguageService | null,
	query: string,
	cwd: string,
): SymbolHit[] {
	if (!svc) return regexSymbolSearch(query, cwd);
	if (!query) return [];
	const items = svc.getService().getNavigateToItems(query, 50);
	return items.map((it) => {
		const source = svc.resolveSnapshot(it.fileName).source ?? "";
		const pos = offsetToLineCol(source, it.textSpan.start);
		return {
			name: it.name,
			kind: KIND_LABELS[it.kind] ?? it.kind,
			file: it.fileName,
			line: pos.line,
			column: pos.column,
			containerName: it.containerName ?? "",
		};
	});
}

/** Format symbol hits as a list. */
export function formatSymbolHits(hits: readonly SymbolHit[], cwd: string): string {
	if (hits.length === 0) return "No symbols found.";
	return hits
		.map((h) => {
			const rel = path.relative(cwd, h.file) || h.file;
			const container = h.containerName ? ` in ${h.containerName}` : "";
			return `${rel}:${h.line}:${h.column}  ${h.kind} ${h.name}${container}`;
		})
		.join("\n");
}

interface OutlineNode {
	name: string;
	kind: string;
	startLine: number;
	children: OutlineNode[];
}

/** Build a module structure outline for `file`. */
export function moduleReport(svc: TsLanguageService | null, file: string, cwd: string): string {
	if (!svc) return regexModuleReport(file, cwd);
	const abs = path.resolve(cwd, file);
	const source = svc.resolveSnapshot(file).source;
	if (!source) return `Module report: file not found: ${file}`;
	const items = svc.getService().getNavigationBarItems(abs);
	const nodes = items.map((it) => toOutlineNode(it, abs, svc));
	if (nodes.length === 0) return `Module report: no outline for ${file}`;
	return `**Module outline — ${path.relative(cwd, abs) || file}**\n\n${renderOutline(nodes, 0)}`;
}

function toOutlineNode(item: ts.NavigationBarItem, fileName: string, svc: TsLanguageService): OutlineNode {
	const source = svc.resolveSnapshot(fileName).source ?? "";
	// First span is the declaration span.
	const span = item.spans[0];
	const start = span ? offsetToLineCol(source, span.start).line : 0;
	return {
		name: item.text,
		kind: KIND_LABELS[item.kind] ?? item.kind,
		startLine: start,
		children: (item.childItems ?? []).map((c) => toOutlineNode(c, fileName, svc)),
	};
}

function renderOutline(nodes: OutlineNode[], depth: number): string {
	const indent = "  ".repeat(depth);
	return nodes
		.map((n) => `${indent}${n.kind} ${n.name} :${n.startLine}${n.children.length ? "\n" + renderOutline(n.children, depth + 1) : ""}`)
		.join("\n");
}

/** Read the symbol at a position: name, type, and source text. */
export function readSymbol(
	svc: TsLanguageService | null,
	file: string,
	line: number,
	col: number,
	cwd: string,
): { name: string; type: string; source: string } | undefined {
	if (!svc) return undefined;
	const abs = path.resolve(cwd, file);
	const { source } = svc.resolveSnapshot(file);
	if (!source) return undefined;
	const offset = ((): number => {
		// reuse the pure helper from lsp.ts via the instance's internal path
		// (line/col are 1-based)
		let o = 0;
		let cl = 1;
		for (let i = 0; i < source.length && cl < line; i++) {
			if (source[i] === "\n") cl++;
			o = i + 1;
		}
		return o + (col - 1);
	})();
	const info = svc.getService().getQuickInfoAtPosition(abs, offset);
	if (!info) return undefined;
	const name = ts.displayPartsToString(info.displayParts);
	const type = info.kind ?? "";
	const textSpan = info.textSpan;
	const sourceText = source.slice(textSpan.start, textSpan.start + textSpan.length);
	return { name, type, source: sourceText };
}

// --- regex fallbacks (no LanguageService available) -------------------------

const SYMBOL_RE = /\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|enum)\s+([A-Za-z_$][\w$]*)/g;

function regexSymbolSearch(query: string, cwd: string): SymbolHit[] {
	if (!query) return [];
	const hits: SymbolHit[] = [];
	// Fresh global regex per call — never share lastIndex across invocations.
	const re = new RegExp(SYMBOL_RE.source, "g");
	const files = collectScriptFiles(cwd, 200);
	for (const file of files) {
		let content: string;
		try {
			content = fs.readFileSync(file, "utf8");
		} catch {
			continue;
		}
		let m: RegExpExecArray | null;
		re.lastIndex = 0;
		while ((m = re.exec(content)) !== null && hits.length < 50) {
			const name = m[1];
			if (!name.toLowerCase().includes(query.toLowerCase())) continue;
			const before = content.slice(0, m.index);
			const line = before.split("\n").length;
			const col = m.index - before.lastIndexOf("\n");
			hits.push({ name, kind: "symbol", file, line, column: col, containerName: "" });
		}
	}
	return hits;
}

function regexModuleReport(file: string, cwd: string): string {
	const abs = path.resolve(cwd, file);
	let content: string;
	try {
		content = fs.readFileSync(abs, "utf8");
	} catch {
		return `Module report: file not found: ${file}`;
	}
	const lines = content.split("\n");
	const out: string[] = [`**Module outline — ${path.relative(cwd, abs) || file}**`, ""];
	// Non-global regex: no lastIndex state to leak between lines.
	const lineRe = new RegExp(SYMBOL_RE.source);
	for (let i = 0; i < lines.length; i++) {
		const m = lineRe.exec(lines[i]);
		if (m) out.push(`${i + 1}: ${lines[i].trim()}`);
	}
	return out.length <= 2 ? `Module report: no outline for ${file}` : out.join("\n");
}

function collectScriptFiles(cwd: string, cap: number): string[] {
	const out: string[] = [];
	const stack = [cwd];
	const seen = new Set<string>();
	while (stack.length && out.length < cap) {
		const dir = stack.pop()!;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries) {
			if (e.name === "node_modules" || e.name === ".git" || e.name.startsWith(".")) continue;
			const full = path.join(dir, e.name);
			if (e.isDirectory()) stack.push(full);
			else if (/\.[cm]?[tj]sx?$/.test(e.name) && !seen.has(full)) {
				seen.add(full);
				out.push(full);
			}
		}
	}
	return out;
}
