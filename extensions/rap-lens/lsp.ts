/**
 * TypeScript LanguageService wrapper for rap-lens navigation.
 *
 * goto-definition and
 * find-references, powered by the `typescript` package's LanguageService
 * (the same engine tsserver uses). Works for .ts/.tsx/.js/.jsx.
 *
 * Pure helpers (offset conversion) are exported for unit testing; the
 * LanguageService wrapper is exercised by the integration smoke test.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

export interface NavLocation {
	file: string;
	line: number;
	column: number;
	endLine: number;
	endColumn: number;
	text: string;
}

/** Convert 1-based line/column to a 0-based character offset. */
export function lineColToOffset(source: string, line: number, col: number): number {
	let offset = 0;
	let currentLine = 1;
	for (let i = 0; i < source.length && currentLine < line; i++) {
		if (source[i] === "\n") currentLine++;
		offset = i + 1;
	}
	return offset + (col - 1);
}

/** Convert a 0-based character offset to 1-based line/column. */
export function offsetToLineCol(source: string, offset: number): { line: number; column: number } {
	let line = 1;
	let col = 1;
	for (let i = 0; i < offset && i < source.length; i++) {
		if (source[i] === "\n") {
			line++;
			col = 1;
		} else {
			col++;
		}
	}
	return { line, column: col };
}

/** Format navigation locations into a readable list. */
export function formatNavLocations(locs: readonly NavLocation[], cwd: string): string {
	if (locs.length === 0) return "No locations found.";
	return locs
		.map((l) => {
			const rel = path.relative(cwd, l.file) || l.file;
			return `${rel}:${l.line}:${l.column}${l.text ? ` — ${l.text}` : ""}`;
		})
		.join("\n");
}

const MAX_FILES = 1000;

function collectScriptFiles(cwd: string): string[] {
	const out: string[] = [];
	const stack = [cwd];
	const seen = new Set<string>();
	while (stack.length && out.length < MAX_FILES) {
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
			if (e.isDirectory()) {
				stack.push(full);
			} else if (/\.[cm]?[tj]sx?$/.test(e.name)) {
				if (!seen.has(full)) {
					seen.add(full);
					out.push(full);
				}
			}
		}
	}
	return out;
}

/** Snapshot reader: reads file content from disk, caching in the given map. */
type SnapshotFn = (fileName: string) => string | undefined;

function makeSnapshotFn(): { cache: Map<string, { mtimeMs: number; content: string }>; read: SnapshotFn } {
	// Cache keyed by mtimeMs so an edited file is re-read instead of served stale.
	const cache = new Map<string, { mtimeMs: number; content: string }>();
	const read: SnapshotFn = (fileName) => {
		let mtimeMs: number;
		try {
			mtimeMs = fs.statSync(fileName).mtimeMs;
		} catch {
			return undefined;
		}
		const cached = cache.get(fileName);
		if (cached && cached.mtimeMs === mtimeMs) return cached.content;
		try {
			const content = fs.readFileSync(fileName, "utf8");
			cache.set(fileName, { mtimeMs, content });
			return content;
		} catch {
			return undefined;
		}
	};
	return { cache, read };
}

/**
 * A TypeScript LanguageService bound to a project root. Reads file snapshots
 * from disk on demand. Lazily created per project; reuse across calls.
 */
export class TsLanguageService {
	private readonly svc: ts.LanguageService;
	private readonly cwd: string;
	private readonly fileNames: string[];
	private readonly snapshot: SnapshotFn;

	private constructor(svc: ts.LanguageService, cwd: string, fileNames: string[], snapshot: SnapshotFn) {
		this.svc = svc;
		this.cwd = cwd;
		this.fileNames = fileNames;
		this.snapshot = snapshot;
	}

	/** Create a service for `cwd`. Returns null if typescript is unavailable. */
	static create(cwd: string): TsLanguageService | null {
		try {
			const fileNames = collectScriptFiles(cwd);
			const { read: snapshot } = makeSnapshotFn();
			const settings: ts.CompilerOptions = {
				...ts.getDefaultCompilerOptions(),
				allowJs: true,
				jsx: ts.JsxEmit.Preserve,
				noEmit: true,
			};
			const host: ts.LanguageServiceHost = {
				getCompilationSettings: () => settings,
				getScriptFileNames: () => fileNames,
				// Version per file derived from mtime: when a file is edited its
				// version changes, so the document registry invalidates its cached
				// AST instead of reusing stale syntax trees.
				getScriptVersion: (fileName) => {
					try {
						return String(fs.statSync(fileName).mtimeMs);
					} catch {
						return "0";
					}
				},
				getScriptSnapshot: (fileName) => {
					const content = snapshot(fileName);
					return content !== undefined ? ts.ScriptSnapshot.fromString(content) : undefined;
				},
				getCurrentDirectory: () => cwd,
				getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
				fileExists: (f) => fs.existsSync(f),
				readFile: (f) => {
					try {
						return fs.readFileSync(f, "utf8");
					} catch {
						return undefined;
					}
				},
			};
			const svc = ts.createLanguageService(host, ts.createDocumentRegistry());
			return new TsLanguageService(svc, cwd, fileNames, snapshot);
		} catch {
			return null;
		}
	}

	/** Resolve a (1-based) line/col in `file` to definition locations. */
	getDefinition(file: string, line: number, col: number): NavLocation[] {
		const abs = path.resolve(this.cwd, file);
		const source = this.snapshot(abs);
		if (!source) return [];
		const offset = lineColToOffset(source, line, col);
		const defs = this.svc.getDefinitionAtPosition(abs, offset);
		if (!defs) return [];
		return defs.map((d) => this.toNavLocation(d.fileName, d.textSpan, d.name));
	}

	/** Find references for the symbol at (1-based) line/col in `file`. */
	getReferences(file: string, line: number, col: number): NavLocation[] {
		const abs = path.resolve(this.cwd, file);
		const source = this.snapshot(abs);
		if (!source) return [];
		const offset = lineColToOffset(source, line, col);
		const refs = this.svc.getReferencesAtPosition(abs, offset);
		if (!refs) return [];
		return refs.map((r) => this.toNavLocation(r.fileName, r.textSpan, ""));
	}

	/** Hover/quick-info text for the symbol at (1-based) line/col. */
	getQuickInfo(file: string, line: number, col: number): string | undefined {
		const abs = path.resolve(this.cwd, file);
		const source = this.snapshot(abs);
		if (!source) return undefined;
		const offset = lineColToOffset(source, line, col);
		const info = this.svc.getQuickInfoAtPosition(abs, offset);
		if (!info) return undefined;
		return ts.displayPartsToString(info.displayParts);
	}

	/** Expose the underlying service for sibling modules (symbol search, autofix). */
	getService(): ts.LanguageService {
		return this.svc;
	}

	/** Resolve a relative file path + read its snapshot (shared helper). */
	resolveSnapshot(file: string): { abs: string; source: string | undefined } {
		const abs = path.resolve(this.cwd, file);
		return { abs, source: this.snapshot(abs) };
	}

	private toNavLocation(fileName: string, span: ts.TextSpan, text: string): NavLocation {
		const src = this.snapshot(fileName) ?? "";
		const start = offsetToLineCol(src, span.start);
		const end = offsetToLineCol(src, span.start + span.length);
		return {
			file: fileName,
			line: start.line,
			column: start.column,
			endLine: end.line,
			endColumn: end.column,
			text,
		};
	}
}
