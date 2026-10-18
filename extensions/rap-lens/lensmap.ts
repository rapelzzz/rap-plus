/**
 * /lens-map HTML module-map generator for rap-lens.
 *
 * Behavioral target: `pi-lens` /lens-map. Produces a self-contained HTML
 * page that outlines every script file in the project with its top-level
 * symbols (classes, functions, interfaces, types, consts). Uses the
 * TypeScript LanguageService outline when available, else a regex scan.
 *
 * The HTML renderer is a pure function over collected data → unit-tested.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { TsLanguageService, offsetToLineCol } from "./lsp.ts";

export interface ModuleNode {
	name: string;
	kind: string;
	line: number;
}

export interface ModuleFile {
	path: string;
	rel: string;
	nodes: ModuleNode[];
}

const KIND_ICON: Record<string, string> = {
	class: "🅒",
	interface: "🅘",
	type: "🅣",
	enum: "🅔",
	function: "ƒ",
	method: "ƒ",
	const: "c",
	var: "v",
	module: "📦",
};

function esc(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Pure: render collected module data into a self-contained HTML page.
 * No external assets; inline CSS; relative file paths shown as headings.
 */
export function renderLensMapHtml(files: readonly ModuleFile[], cwd: string): string {
	const totalSymbols = files.reduce((n, f) => n + f.nodes.length, 0);
	const fileBlocks = files
		.map((f) => {
			const nodeRows = f.nodes
				.map((n) => {
					const icon = KIND_ICON[n.kind] ?? "•";
					return `          <li><span class="kind">${icon}</span> <code>${esc(n.kind)}</code> <strong>${esc(n.name)}</strong> <span class="line">:${n.line}</span></li>`;
				})
				.join("\n");
			const nodes = f.nodes.length > 0
				? `        <ul>\n${nodeRows}\n        </ul>`
				: `        <p class="empty">(no top-level symbols)</p>`;
			return `      <section class="file">
        <h3>${esc(f.rel)}</h3>
${nodes}
      </section>`;
		})
		.join("\n");

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>rap-lens module map — ${esc(path.basename(cwd))}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; margin: 2em auto; max-width: 900px; color: #1a1a2e; }
  h1 { border-bottom: 2px solid #3b82f6; padding-bottom: .3em; }
  .summary { color: #555; margin-bottom: 1.5em; }
  .file { margin-bottom: 1.4em; padding: .8em 1em; border: 1px solid #e2e8f0; border-radius: 6px; background: #fafbff; }
  .file h3 { margin: 0 0 .5em; font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; color: #1e3a8a; font-size: 1em; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: .15em 0; }
  .kind { display: inline-block; width: 1.4em; opacity: .7; }
  code { font-size: .85em; color: #6b7280; }
  .line { color: #9ca3af; font-size: .85em; }
  .empty { color: #9ca3af; font-style: italic; margin: 0; }
</style>
</head>
<body>
  <h1>rap-lens module map</h1>
  <p class="summary">${files.length} file${files.length === 1 ? "" : "s"} · ${totalSymbols} symbol${totalSymbols === 1 ? "" : "s"} · root: <code>${esc(path.basename(cwd))}</code></p>
${fileBlocks}
</body>
</html>
`;
}

const SYMBOL_RE = /\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|enum)\s+([A-Za-z_$][\w$]*)/g;

function regexOutline(content: string): ModuleNode[] {
	const out: ModuleNode[] = [];
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		SYMBOL_RE.lastIndex = 0;
		const m = SYMBOL_RE.exec(lines[i]);
		if (m) {
			const kind = lines[i].match(/\b(function|class|interface|type|const|let|enum)\b/)?.[1] ?? "symbol";
			out.push({ name: m[1], kind, line: i + 1 });
		}
	}
	return out;
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

/** Build module-map data for a project. Uses TS outline when available. */
export function buildLensMapData(svc: TsLanguageService | null, cwd: string): ModuleFile[] {
	const files = collectScriptFiles(cwd, 500).sort();
	return files.map((file) => {
		const rel = path.relative(cwd, file) || file;
		let content: string;
		try {
			content = fs.readFileSync(file, "utf8");
		} catch {
			return { path: file, rel, nodes: [] };
		}
		let nodes: ModuleNode[];
		if (svc) {
			const items = svc.getService().getNavigationBarItems(file);
			nodes = items.length > 0 ? flattenNavBar(items, content) : regexOutline(content);
		} else {
			nodes = regexOutline(content);
		}
		return { path: file, rel, nodes };
	});
}

function flattenNavBar(items: ts.NavigationBarItem[], content: string): ModuleNode[] {
	const out: ModuleNode[] = [];
	const walk = (items: ts.NavigationBarItem[]) => {
		for (const it of items) {
			const span = it.spans[0];
			const line = span ? offsetToLineCol(content, span.start).line : 0;
			out.push({ name: it.text, kind: it.kind, line });
			if (it.childItems) walk(it.childItems);
		}
	};
	walk(items);
	return out;
}

/** Build the map and write it to `outFile`. Returns the absolute output path. */
export function writeLensMap(svc: TsLanguageService | null, cwd: string, outFile: string): string {
	const data = buildLensMapData(svc, cwd);
	const html = renderLensMapHtml(data, cwd);
	const abs = path.resolve(cwd, outFile);
	fs.writeFileSync(abs, html);
	return abs;
}
