/**
 * rap-lens astgrep.ts — pure parser tests + binary integration.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	parseAstGrepJson,
	formatAstGrepMatches,
	detectAstGrep,
	astGrepSearch,
	astGrepReplace,
} from "../astgrep.ts";

const SAMPLE = JSON.stringify([
	{
		text: 'console.log("hi")',
		file: "/tmp/a.ts",
		language: "TypeScript",
		range: { byteOffset: { start: 10, end: 27 }, start: { line: 0, column: 10 }, end: { line: 0, column: 27 } },
	},
]);

test("parseAstGrepJson converts 0-based to 1-based line/col", () => {
	const m = parseAstGrepJson(SAMPLE);
	assert.equal(m.length, 1);
	assert.equal(m[0].file, "/tmp/a.ts");
	assert.equal(m[0].line, 1);
	assert.equal(m[0].column, 11);
	assert.equal(m[0].endLine, 1);
	assert.equal(m[0].endColumn, 28);
	assert.equal(m[0].text, 'console.log("hi")');
	assert.equal(m[0].language, "TypeScript");
});

test("parseAstGrepJson handles empty/garbage", () => {
	assert.deepEqual(parseAstGrepJson(""), []);
	assert.deepEqual(parseAstGrepJson("not json"), []);
	assert.deepEqual(parseAstGrepJson("{}"), []);
});

test("formatAstGrepMatches shows relative paths", () => {
	const m = parseAstGrepJson(SAMPLE);
	const out = formatAstGrepMatches(m, "/tmp");
	assert.equal(out, 'a.ts:1:11  console.log("hi")');
	assert.equal(formatAstGrepMatches([], "/tmp"), "No structural matches.");
});

test("detectAstGrep rejects the system sg (newgrp) and finds the real binary", async () => {
	const bin = await detectAstGrep(process.cwd());
	// ast-grep was installed locally in this repo, so we expect to find it.
	assert.ok(bin, "expected ast-grep binary to be detected (local install present)");
	// Must NOT be the bare 'sg' that is newgrp — verify by running its version.
	const { runText } = await import("../../_shared/subprocess.ts");
	const ver = await runText(bin, ["--version"], { timeoutMs: 5000, maxOutputBytes: 4096 });
	assert.match(ver.toLowerCase(), /ast-grep/);
});

test("astGrepSearch finds structural matches end-to-end", async () => {
	const bin = await detectAstGrep(process.cwd());
	if (!bin) return;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-lens-sg-"));
	try {
		fs.writeFileSync(path.join(dir, "a.ts"), 'const x = console.log("hi");\nconst y = console.log("bye");\n');
		const matches = await astGrepSearch(bin, "console.log($ARGS)", [dir], { cwd: dir });
		assert.equal(matches.length, 2);
		assert.equal(matches[0].line, 1);
		assert.match(matches[0].text, /console\.log/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("astGrepReplace rewrites in place with named metavariables", async () => {
	const bin = await detectAstGrep(process.cwd());
	if (!bin) return;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-lens-sg-"));
	try {
		const file = path.join(dir, "a.ts");
		fs.writeFileSync(file, 'const x = console.log("hi");\n');
		const res = await astGrepReplace(bin, "console.log($ARGS)", "console.warn($ARGS)", [file], { cwd: dir });
		assert.ok(res.changed >= 1, `expected >=1 change, got ${res.changed}`);
		const after = fs.readFileSync(file, "utf8");
		assert.match(after, /console\.warn\("hi"\)/);
		assert.doesNotMatch(after, /console\.log/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
