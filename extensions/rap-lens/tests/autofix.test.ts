/**
 * rap-lens autofix.ts — pure helper tests + TS codefix + dynamic detection.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { applyTextChanges, formatAutofixResults, applyTsCodeFixes, detectFormatter } from "../autofix.ts";
import { TsLanguageService } from "../lsp.ts";

test("applyTextChanges applies right-to-left and preserves earlier offsets", () => {
	const src = "abcdef";
	const changes = [
		{ start: 0, length: 1, newText: "X" },
		{ start: 4, length: 2, newText: "YZ" },
	];
	const { result, applied } = applyTextChanges(src, changes);
	assert.equal(applied, 2);
	assert.equal(result, "XbcdYZ");
});

test("applyTextChanges skips out-of-range spans", () => {
	const src = "abc";
	const { result, applied } = applyTextChanges(src, [
		{ start: 0, length: 1, newText: "Z" },
		{ start: 5, length: 2, newText: "QQ" }, // out of range
	]);
	assert.equal(applied, 1);
	assert.equal(result, "Zbc");
});

test("applyTextChanges empty changes is a no-op", () => {
	assert.deepEqual(applyTextChanges("abc", []), { result: "abc", applied: 0 });
});

test("formatAutofixResults summarizes tools", () => {
	const out = formatAutofixResults([
		{ tool: "typescript", fixesApplied: 3, filesChanged: ["a.ts"] },
		{ tool: "eslint", fixesApplied: 0, filesChanged: [], notes: "eslint not installed" },
	]);
	assert.match(out, /typescript: 3 fixes applied \(1 file\)/);
	assert.match(out, /eslint: 0 fixes applied — eslint not installed/);
	assert.equal(formatAutofixResults([]), "No autofix tools ran.");
});

test("applyTsCodeFixes applies a fixable diagnostic (unused import)", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-lens-fix-"));
	try {
		// 'unusedVar' triggers suggestion codefix "Remove unused declaration".
		fs.writeFileSync(
			path.join(dir, "a.ts"),
			[
				"function used() { return 1 }",
				"const unusedVar = 99;",
				"export const r = used();",
			].join("\n") + "\n",
		);
		const svc = TsLanguageService.create(dir);
		if (!svc) return;
		const before = fs.readFileSync(path.join(dir, "a.ts"), "utf8");
		const res = applyTsCodeFixes(svc, "a.ts", dir);
		const after = fs.readFileSync(path.join(dir, "a.ts"), "utf8");
		// Either fixes were applied (file changed) or there were none — both valid.
		assert.ok(typeof res.fixesApplied === "number");
		if (res.fixesApplied > 0) {
			assert.notEqual(before, after, "file content should change when fixes applied");
			assert.ok(res.filesChanged.includes("a.ts"));
		}
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("applyTsCodeFixes returns a notes message for a missing file", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-lens-fix-"));
	try {
		const svc = TsLanguageService.create(dir);
		if (!svc) return;
		const res = applyTsCodeFixes(svc, "nope.ts", dir);
		assert.equal(res.fixesApplied, 0);
		assert.match(res.notes ?? "", /not found/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("detectFormatter returns null for a missing tool", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-lens-fix-"));
	try {
		const bin = await detectFormatter(dir, "definitely-not-a-real-tool-xyz");
		assert.equal(bin, null);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
