/**
 * rap-lens lensmap.ts — pure HTML renderer + data builder + write tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { renderLensMapHtml, buildLensMapData, writeLensMap, type ModuleFile } from "../lensmap.ts";

const SAMPLE: ModuleFile[] = [
	{ path: "/p/a.ts", rel: "a.ts", nodes: [{ name: "Foo", kind: "class", line: 1 }, { name: "bar", kind: "function", line: 5 }] },
	{ path: "/p/b.ts", rel: "b.ts", nodes: [] },
];

test("renderLensMapHtml produces a valid self-contained HTML page", () => {
	const html = renderLensMapHtml(SAMPLE, "/p");
	assert.match(html, /<!DOCTYPE html>/);
	assert.match(html, /<title>rap-lens module map/);
	// symbols present
	assert.match(html, /Foo/);
	assert.match(html, /bar/);
	// empty file shows placeholder
	assert.match(html, /\(no top-level symbols\)/);
	// summary counts
	assert.match(html, /2 files/);
	assert.match(html, /2 symbols/);
});

test("renderLensMapHtml escapes HTML-special characters in names", () => {
	const data: ModuleFile[] = [
		{ path: "/p/a.ts", rel: "a.ts", nodes: [{ name: "<script>", kind: "function", line: 1 }] },
	];
	const html = renderLensMapHtml(data, "/p");
	assert.doesNotMatch(html, /<script>/);
	assert.match(html, /&lt;script&gt;/);
});

test("buildLensMapData collects symbols from a real project (regex fallback)", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-lens-map-"));
	try {
		fs.writeFileSync(path.join(dir, "a.ts"), "export class Foo {}\nexport function bar() {}\n");
		const data = buildLensMapData(null, dir);
		assert.equal(data.length, 1);
		assert.equal(data[0].rel, "a.ts");
		assert.ok(data[0].nodes.length >= 2);
		const names = data[0].nodes.map((n) => n.name);
		assert.ok(names.includes("Foo"));
		assert.ok(names.includes("bar"));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("writeLensMap writes an HTML file and returns its absolute path", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-lens-map-"));
	try {
		fs.writeFileSync(path.join(dir, "a.ts"), "export const x = 1;\n");
		const outPath = writeLensMap(null, dir, "lens-map.html");
		assert.equal(path.basename(outPath), "lens-map.html");
		assert.ok(fs.existsSync(outPath));
		const html = fs.readFileSync(outPath, "utf8");
		assert.match(html, /<!DOCTYPE html>/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
