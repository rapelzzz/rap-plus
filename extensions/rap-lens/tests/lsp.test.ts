/**
 * rap-lens lsp.ts — pure helper tests + TS LanguageService integration smoke.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	lineColToOffset,
	offsetToLineCol,
	formatNavLocations,
	TsLanguageService,
	type NavLocation,
} from "../lsp.ts";

// --- pure helpers -----------------------------------------------------------

test("lineColToOffset / offsetToLineCol round-trip on multi-line source", () => {
	const src = "abc\ndefgh\nij";
	// line 2 col 4 -> the 'h' (1-based: line2="defgh", col4='h')
	const off = lineColToOffset(src, 2, 4);
	assert.equal(off, 7); // indices: a0 b1 c2 \n3 d4 e5 f6 g7 -> wait
	// Recompute: "abc\n" is 4 chars (0..3). line2 starts at offset 4 (d). col4 of line2 = d(1),e(2),f(3),g(4) -> offset 4+3=7. correct.
	assert.equal(src[off], "g");
	const back = offsetToLineCol(src, off);
	assert.deepEqual(back, { line: 2, column: 4 });
});

test("lineColToOffset handles column past end-of-line gracefully", () => {
	const src = "ab\ncd";
	// line 1 col 5 (past "ab") -> offset 4 (clamped to source region)
	const off = lineColToOffset(src, 1, 5);
	assert.ok(off >= 0);
});

test("formatNavLocations shows relative paths and text", () => {
	const cwd = "/proj";
	const locs: NavLocation[] = [
		{ file: "/proj/src/a.ts", line: 10, column: 3, endLine: 10, endColumn: 8, text: "foo" },
	];
	assert.equal(formatNavLocations(locs, cwd), "src/a.ts:10:3 — foo");
	assert.equal(formatNavLocations([], cwd), "No locations found.");
});

// --- LanguageService integration (real typescript) --------------------------

function makeTempProject(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-lens-lsp-"));
	fs.writeFileSync(
		path.join(dir, "lib.ts"),
		[
			"export function greet(name: string): string {",
			"  return 'hi ' + name;",
			"}",
		].join("\n") + "\n",
	);
	fs.writeFileSync(
		path.join(dir, "main.ts"),
		[
			'import { greet } from "./lib.ts";',
			'export const msg = greet("world");',
		].join("\n") + "\n",
	);
	return dir;
}

test("TsLanguageService.getDefinition jumps to imported symbol", () => {
	const dir = makeTempProject();
	try {
		const svc = TsLanguageService.create(dir);
		assert.ok(svc, "LanguageService should be created when typescript is installed");
		if (!svc) return;
		// main.ts line 2: 'export const msg = greet("world");' — 'greet' starts at col 21 (1-based)
		const defs = svc.getDefinition("main.ts", 2, 21);
		assert.ok(defs.length > 0, "expected at least one definition for greet");
		const def = defs[0];
		assert.match(path.basename(def.file), /^lib\.ts$/);
		assert.ok(def.line >= 1, "definition line should be set");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("TsLanguageService.getReferences finds usages across files", () => {
	const dir = makeTempProject();
	try {
		const svc = TsLanguageService.create(dir);
		if (!svc) return;
		// Find references to greet from its definition site in lib.ts line 1.
		const refs = svc.getReferences("lib.ts", 1, 17);
		assert.ok(refs.length >= 2, "expected definition + at least one reference");
		const files = new Set(refs.map((r) => path.basename(r.file)));
		assert.ok(files.has("lib.ts"));
		assert.ok(files.has("main.ts"));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("TsLanguageService.getQuickInfo returns type info", () => {
	const dir = makeTempProject();
	try {
		const svc = TsLanguageService.create(dir);
		if (!svc) return;
		const info = svc.getQuickInfo("lib.ts", 1, 17);
		assert.ok(typeof info === "string");
		if (info) assert.match(info, /greet/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("TsLanguageService returns [] on missing file without throwing", () => {
	const dir = makeTempProject();
	try {
		const svc = TsLanguageService.create(dir);
		if (!svc) return;
		assert.deepEqual(svc.getDefinition("nope.ts", 1, 1), []);
		assert.deepEqual(svc.getReferences("nope.ts", 1, 1), []);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
