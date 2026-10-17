import { test } from "node:test";
import assert from "node:assert";
import { detectLanguage, formatChecklist } from "../checklist.ts";
import { extractJsonArray, parseFindings, formatFindingsReport, sortBySeverity } from "../findings.ts";

// ── language detection ──────────────────────────────────────────────────────
test("detectLanguage maps common extensions", () => {
	assert.equal(detectLanguage("src/foo.ts"), "typescript");
	assert.equal(detectLanguage("x.tsx"), "typescript");
	assert.equal(detectLanguage("a.py"), "python");
	assert.equal(detectLanguage("a.go"), "go");
	assert.equal(detectLanguage("a.rs"), "rust");
	assert.equal(detectLanguage("a.java"), "java");
	assert.equal(detectLanguage("a.php"), "php");
	assert.equal(detectLanguage("a.js"), "javascript");
	assert.equal(detectLanguage("README.md"), undefined);
	assert.equal(detectLanguage("UPPER.TS"), "typescript");
});

test("formatChecklist groups by language and includes items", () => {
	const text = formatChecklist(["a.ts", "b.py", "c.rs"]);
	assert.match(text, /\[typescript\] a\.ts/);
	assert.match(text, /\[python\] b\.py/);
	assert.match(text, /\[rust\] c\.rs/);
	assert.match(text, /Type safety/);
	assert.match(text, /mypy/);
});

test("formatChecklist empty when no supported languages", () => {
	assert.equal(formatChecklist(["README.md", "data.json"]), "");
});

// ── JSON array extraction ───────────────────────────────────────────────────
test("extractJsonArray pulls first balanced array", () => {
	assert.equal(extractJsonArray('here is [{"a":1}] done'), '[{"a":1}]');
	assert.equal(extractJsonArray("no array here"), null);
	assert.equal(extractJsonArray('text [1, [2,3], "a]b"] tail'), '[1, [2,3], "a]b"]');
});

// ── findings parsing ────────────────────────────────────────────────────────
test("parseFindings parses a JSON array of findings", () => {
	const text = `Sure! Here are the findings:
[{"severity":"critical","file":"a.ts","line":10,"message":"SQL injection","suggestion":"use prepared stmts"},
{"severity":"medium","file":"b.ts","line":22,"message":"implicit any","suggestion":"add type"}]
done`;
	const f = parseFindings(text);
	assert.equal(f.length, 2);
	assert.equal(f[0].severity, "critical");
	assert.equal(f[0].file, "a.ts");
	assert.equal(f[0].line, 10);
	assert.equal(f[1].severity, "medium");
});

test("parseFindings tolerates non-JSON line format", () => {
	const text = `high | src/x.ts:5 | unhandled promise
critical: y.py:12 | eval on user input`;
	const f = parseFindings(text);
	assert.equal(f.length, 2);
	assert.equal(f[0].severity, "high");
	assert.equal(f[1].severity, "critical");
});

test("parseFindings returns empty for nothing parseable", () => {
	assert.deepEqual(parseFindings("all good, no issues"), []);
});

test("parseFindings coerces bad fields to defaults", () => {
	const f = parseFindings('[{"message":"oops"}]');
	assert.equal(f.length, 1);
	assert.equal(f[0].severity, "info");
	assert.equal(f[0].file, "(unknown)");
	assert.equal(f[0].line, 0);
});

// ── report formatting ───────────────────────────────────────────────────────
test("formatFindingsReport groups by severity with counts", () => {
	const f = parseFindings(
		'[{"severity":"critical","file":"a","line":1,"message":"x"},{"severity":"high","file":"a","line":2,"message":"y"},{"severity":"high","file":"a","line":3,"message":"z"}]',
	);
	const report = formatFindingsReport(f);
	assert.match(report, /1 CRITICAL · 2 HIGH/);
	assert.match(report, /## CRITICAL \(1\)/);
	assert.match(report, /## HIGH \(2\)/);
});

test("formatFindingsReport deduplicates identical findings", () => {
	const f = parseFindings(
		'[{"severity":"high","file":"a","line":1,"message":"dup"},{"severity":"high","file":"a","line":1,"message":"dup"}]',
	);
	assert.match(formatFindingsReport(f), /1 HIGH/);
});

test("formatFindingsReport empty -> all clear", () => {
	assert.equal(formatFindingsReport([]), "No issues found. ✓");
});

test("sortBySeverity puts critical first", () => {
	const f = parseFindings(
		'[{"severity":"info","file":"a","line":1,"message":"i"},{"severity":"critical","file":"a","line":2,"message":"c"},{"severity":"high","file":"a","line":3,"message":"h"}]',
	);
	const sorted = sortBySeverity(f);
	assert.equal(sorted[0].severity, "critical");
	assert.equal(sorted[1].severity, "high");
	assert.equal(sorted[2].severity, "info");
});
