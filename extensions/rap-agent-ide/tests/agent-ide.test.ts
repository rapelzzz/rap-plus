import { test } from "node:test";
import assert from "node:assert";
import { isSensitivePath, relFrom, validateEdit, validateEditTarget, validateEditInputShape } from "../guard.ts";
import { formatHits, parseRipgrep } from "../search.ts";

// ── guard: path safety ──────────────────────────────────────────────────────
test("validateEditTarget blocks paths outside project root", () => {
	const r = validateEditTarget("/root/.pi/agent/extensions/rap-plus", "../../etc/passwd", "x");
	assert.equal(r.ok, false);
	assert.match(r.reason!, /outside project root/i);
});

test("validateEditTarget allows in-root paths", () => {
	const r = validateEditTarget("/root/.pi/agent/extensions/rap-plus", "src/a.ts", "hello");
	assert.equal(r.ok, true);
	assert.ok(r.absPath!.endsWith("src/a.ts"));
});

test("validateEditTarget blocks sensitive paths (.env, credentials, ssh)", () => {
	const cwd = "/root/.pi/agent/extensions/rap-plus";
	assert.equal(validateEditTarget(cwd, ".env", "x").ok, false);
	assert.equal(validateEditTarget(cwd, "secrets/credentials.json", "x").ok, false);
	assert.equal(validateEditTarget(cwd, "config/.ssh/id_rsa", "x").ok, false);
	assert.equal(validateEditTarget(cwd, ".npmrc", "x").ok, false);
});

test("validateEditTarget blocks oversized content", () => {
	const big = "x".repeat(6 * 1024 * 1024);
	const r = validateEditTarget("/root/.pi/agent/extensions/rap-plus", "a.ts", big);
	assert.equal(r.ok, false);
	assert.match(r.reason!, /too large/i);
});

test("validateEdit enforces edit size cap", () => {
	const big = "y".repeat(600 * 1024);
	const r = validateEdit("/root/.pi/agent/extensions/rap-plus", "a.ts", "old", big);
	assert.equal(r.ok, false);
	assert.match(r.reason!, /too large/i);
});

test("isSensitivePath detects sensitive and treats out-of-root as sensitive", () => {
	const cwd = "/root/.pi/agent/extensions/rap-plus";
	assert.equal(isSensitivePath(cwd, ".env"), true);
	assert.equal(isSensitivePath(cwd, "../../etc/passwd"), true);
	assert.equal(isSensitivePath(cwd, "src/a.ts"), false);
});

test("relFrom returns relative path for in-root, abs otherwise", () => {
	const cwd = "/root/.pi/agent/extensions/rap-plus";
	assert.equal(relFrom(cwd, "/root/.pi/agent/extensions/rap-plus/src/a.ts"), "src/a.ts");
	assert.equal(relFrom(cwd, "/etc/passwd"), "/etc/passwd");
});

// ── search parsing ──────────────────────────────────────────────────────────
test("parseRipgrep parses column format", () => {
	const text = `src/a.ts:10:5:const x = 1;
src/b.ts:22:1:let y = 2;`;
	const hits = parseRipgrep(text);
	assert.equal(hits.length, 2);
	assert.equal(hits[0].file, "src/a.ts");
	assert.equal(hits[0].line, 10);
	assert.equal(hits[0].column, 5);
	assert.equal(hits[0].match, "const x = 1;");
});

test("parseRipgrep tolerates no-column format", () => {
	const hits = parseRipgrep("src/a.ts:10:match here");
	assert.equal(hits.length, 1);
	assert.equal(hits[0].line, 10);
	assert.equal(hits[0].column, 0);
});

test("parseRipgrep empty for blank input", () => {
	assert.deepEqual(parseRipgrep(""), []);
});

test("formatHits summarizes matches with count", () => {
	const hits = parseRipgrep("a.ts:1:1:foo\nb.ts:2:3:bar");
	const text = formatHits(hits);
	assert.match(text, /2 matches/);
	assert.match(text, /a\.ts:1:1: foo/);
});

test("formatHits empty -> no matches", () => {
	assert.equal(formatHits([]), "No matches found.");
});

test("formatHits truncates beyond max", () => {
	const lines = Array.from({ length: 60 }, (_, i) => `a.ts:${i}:1:x`).join("\n");
	const hits = parseRipgrep(lines);
	assert.equal(hits.length, 60);
	const text = formatHits(hits, 10);
	assert.match(text, /more/);
});


test("validateEditTarget blocks the entire .git metadata directory", () => {
	const cwd = "/root/project";
	assert.equal(validateEditTarget(cwd, ".git/config", "x").ok, false);
	assert.equal(validateEditTarget(cwd, ".git/hooks/pre-commit", "x").ok, false);
});

test("guarded edit detects Windows-style sensitive paths", () => {
	const cwd = "/root/project";
	assert.equal(validateEditTarget(cwd, ".git\\config", "x").ok, false);
	assert.equal(validateEditTarget(cwd, ".env.production", "x").ok, false);
});

test("validateEditInputShape rejects malformed edit and missing write content", () => {
	assert.match(validateEditInputShape({ old_text: "before" }) ?? "", /both old_text and new_text/i);
	assert.match(validateEditInputShape({ new_text: "after" }) ?? "", /both old_text and new_text/i);
	assert.match(validateEditInputShape({}) ?? "", /content is required/i);
	assert.match(validateEditInputShape({ old_text: "", new_text: "after" }) ?? "", /old_text must not be empty/i);
	assert.match(validateEditInputShape({ old_text: "before", new_text: "after", content: "other" }) ?? "", /content alone/i);
	assert.equal(validateEditInputShape({ content: "" }), null);
	assert.equal(validateEditInputShape({ old_text: "before", new_text: "after" }), null);
});
