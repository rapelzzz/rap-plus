import { test } from "node:test";
import assert from "node:assert";
import { parseDiagnostics, formatDiagnostics, detectTool, detectTools } from "../diagnostics.ts";
import { TriageStore, diagnosticKey, serializeTriage } from "../triage.ts";

// ── diagnostics parsing ─────────────────────────────────────────────────────
test("parseDiagnostics parses tsc-style output", () => {
	const text = `src/foo.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/bar.ts(3,1): warning TS6133: 'x' is declared but its value is never read.`;
	const d = parseDiagnostics(text, "tsc");
	assert.equal(d.length, 2);
	assert.equal(d[0].file, "src/foo.ts");
	assert.equal(d[0].line, 12);
	assert.equal(d[0].severity, "error");
	assert.match(d[0].message, /TS2322/);
	assert.equal(d[1].severity, "warning");
});

test("parseDiagnostics parses colon-style output (rustc/gcc)", () => {
	const text = `src/y.rs:5:1: error: mismatched types
src/z.c:8:2: warning: unused variable`;
	const d = parseDiagnostics(text, "rustc");
	assert.equal(d.length, 2);
	assert.equal(d[0].file, "src/y.rs");
	assert.equal(d[0].line, 5);
	assert.equal(d[0].severity, "error");
	assert.equal(d[1].severity, "warning");
});

test("parseDiagnostics parses ruff/flake8 code-style output", () => {
	const text = `src/x.py:10:3: E501 line too long
src/w.py:2:1: F401 unused import`;
	const d = parseDiagnostics(text, "ruff");
	assert.equal(d.length, 2);
	assert.equal(d[0].file, "src/x.py");
	assert.equal(d[0].severity, "warning");
	assert.match(d[0].message, /E501/);
});

test("parseDiagnostics empty for non-diagnostic text", () => {
	assert.deepEqual(parseDiagnostics("just some logs\nnothing here", "tsc"), []);
});

test("formatDiagnostics groups and counts", () => {
	const d = parseDiagnostics(
		`a.ts(1,1): error TS1: bad\nb.ts(2,2): warning TS2: meh\nc.ts(3,3): info TS3: fyi`,
		"tsc",
	);
	const report = formatDiagnostics(d);
	assert.match(report, /1 error · 1 warning · 1 info/);
	assert.match(report, /✗ a\.ts:1/);
});

test("formatDiagnostics empty -> all clear", () => {
	assert.equal(formatDiagnostics([]), "No diagnostics. ✓");
});

// ── tool detection ──────────────────────────────────────────────────────────
test("detectTool finds local node_modules/.bin", () => {
	const cwd = "/root/.pi/agent/extensions/rap-plus"; // has node_modules/.bin/tsc
	assert.equal(detectTool("tsc", cwd), true);
	assert.equal(detectTool("this-does-not-exist-tool", cwd), false);
});

test("detectTools reports availability", () => {
	const t = detectTools("/root/.pi/agent/extensions/rap-plus");
	assert.equal(typeof t.tsc, "boolean");
	assert.equal(typeof t.eslint, "boolean");
});

// ── triage store ────────────────────────────────────────────────────────────
test("diagnosticKey is stable", () => {
	assert.equal(diagnosticKey("a.ts", 5, "msg"), diagnosticKey("a.ts", 5, "msg"));
	assert.notEqual(diagnosticKey("a.ts", 5, "msg"), diagnosticKey("a.ts", 6, "msg"));
});

test("TriageStore hides false-positive and suppressed, keeps deferred/flagFix", () => {
	const store = new TriageStore();
	const k1 = diagnosticKey("a.ts", 1, "x");
	const k2 = diagnosticKey("a.ts", 2, "y");
	const k3 = diagnosticKey("a.ts", 3, "z");
	const k4 = diagnosticKey("a.ts", 4, "w");
	store.mark("falsePositive", k1);
	store.mark("suppressed", k2);
	store.mark("deferred", k3);
	store.mark("flagFix", k4);
	assert.equal(store.isActive(k1), false); // hidden
	assert.equal(store.isActive(k2), false); // hidden
	assert.equal(store.isActive(k3), true); // active
	assert.equal(store.isActive(k4), true); // active
	assert.equal(store.isActive("nonexistent"), true); // unmarked = active
});

test("TriageStore clear and serialize", () => {
	const store = new TriageStore();
	store.mark("flagFix", diagnosticKey("a.ts", 1, "x"), "must fix");
	assert.equal(store.size(), 1);
	store.clear(diagnosticKey("a.ts", 1, "x"));
	assert.equal(store.size(), 0);
	store.mark("deferred", diagnosticKey("b.ts", 2, "y"));
	const ser = serializeTriage(store);
	assert.equal(ser.length, 1);
	assert.equal(ser[0].mark, "deferred");
});
