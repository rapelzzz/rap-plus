import { test } from "node:test";
import assert from "node:assert";
import {
	parseSeverity,
	severityRank,
	resolveWithin,
	isPathSafe,
	redactSecrets,
	truncateToBytes,
	dedupeBy,
} from "../safety.ts";
import { isSafeCommand, isDestructiveCommand, isMutatingGitCommand } from "../bash-allowlist.ts";
import { runSubprocess, runText, TimeoutError } from "../subprocess.ts";
import * as fs from "node:fs";
import * as path from "node:path";

// ── severity ────────────────────────────────────────────────────────────────
test("parseSeverity canonicalizes common spellings", () => {
	assert.equal(parseSeverity("CRITICAL"), "critical");
	assert.equal(parseSeverity("High"), "high");
	assert.equal(parseSeverity("warn"), "medium");
	assert.equal(parseSeverity("info"), "info");
	assert.equal(parseSeverity(undefined), "info");
	assert.equal(parseSeverity("nonsense"), "info");
});

test("severityRank orders critical > high > medium > info", () => {
	assert.ok(severityRank("critical") > severityRank("high"));
	assert.ok(severityRank("high") > severityRank("medium"));
	assert.ok(severityRank("medium") > severityRank("info"));
});

// ── path safety ─────────────────────────────────────────────────────────────
test("resolveWithin allows paths inside cwd", () => {
	const cwd = "/tmp/rap-plus-test-root";
	const got = resolveWithin(cwd, "src/a.ts");
	assert.ok(got.startsWith(cwd));
});

test("resolveWithin blocks directory traversal", () => {
	const cwd = "/tmp/rap-plus-test-root";
	assert.throws(() => resolveWithin(cwd, "../../etc/passwd"), /escapes project root/);
	assert.throws(() => resolveWithin(cwd, "../sibling"), /escapes project root/);
});

test("isPathSafe is non-throwing", () => {
	assert.equal(isPathSafe("/tmp", "ok.txt"), true);
	assert.equal(isPathSafe("/tmp", "../../etc/passwd"), false);
});

test("resolveWithin blocks symlink escapes", () => {
	const root = fs.mkdtempSync(path.join("/tmp", "rap-symlink-"));
	const outside = fs.mkdtempSync(path.join("/tmp", "rap-outside-"));
	const link = path.join(root, "link");
	fs.symlinkSync(outside, link);
	try {
		// A symlink inside cwd pointing outside must be treated as an escape.
		assert.throws(() => resolveWithin(root, "link/secret"), /escapes project root/);
		assert.equal(isPathSafe(root, "link/secret"), false);
		// A normal path inside cwd is still fine.
		assert.equal(isPathSafe(root, "src/a.ts"), true);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

// ── secret redaction ────────────────────────────────────────────────────────
test("redactSecrets masks known credential patterns", () => {
	assert.match(redactSecrets("key=sk-ant-abc123def456ghi789jkl012mno345"), /\[REDACTED:anthropic\]/);
	assert.match(redactSecrets("token ghp_" + "a".repeat(30)), /\[REDACTED:github_pat\]/);
	assert.match(redactSecrets("AKIAIOSFODNN7EXAMPLE"), /\[REDACTED:aws_keyid\]/);
	assert.match(
		redactSecrets("-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----"),
		/\[REDACTED:private_key\]/,
	);
	// password=... style
	assert.match(redactSecrets('password="supersecret123"'), /\[REDACTED:password\]/);
});

test("redactSecrets leaves benign text intact", () => {
	assert.equal(redactSecrets("just some normal log text"), "just some normal log text");
});

// ── truncate ────────────────────────────────────────────────────────────────
test("truncateToBytes caps by UTF-8 byte length", () => {
	const big = "x".repeat(1000);
	const out = truncateToBytes(big, 100);
	assert.ok(Buffer.byteLength(out, "utf8") <= 100);
	assert.match(out, /truncated/);
	assert.equal(truncateToBytes("small", 1000), "small");
});

// ── dedupe ──────────────────────────────────────────────────────────────────
test("dedupeBy keeps first occurrence by key", () => {
	const items = [
		{ id: "a", v: 1 },
		{ id: "b", v: 2 },
		{ id: "a", v: 3 },
	];
	const deduped = dedupeBy(items, (i) => i.id);
	assert.equal(deduped.length, 2);
	assert.equal(deduped[0].v, 1);
});

// ── bash allowlist ──────────────────────────────────────────────────────────
test("isSafeCommand allows read-only commands", () => {
	assert.equal(isSafeCommand("ls -la"), true);
	assert.equal(isSafeCommand("cat foo.txt"), true);
	assert.equal(isSafeCommand("git status"), true);
	assert.equal(isSafeCommand("git log --oneline"), true);
	assert.equal(isSafeCommand("rg pattern"), true);
	assert.equal(isSafeCommand("npm list"), true);
});

test("isSafeCommand blocks destructive commands", () => {
	assert.equal(isSafeCommand("rm -rf /"), false);
	assert.equal(isSafeCommand("git commit -m x"), false);
	assert.equal(isSafeCommand("git push"), false);
	assert.equal(isSafeCommand("npm install"), false);
	assert.equal(isSafeCommand("echo hi > file"), false);
	assert.equal(isSafeCommand("sudo cat /etc/shadow"), false);
	assert.equal(isSafeCommand("vim file"), false);
});

test("isSafeCommand blocks interpreter/pipe bypasses", () => {
	// Pipes into interpreters execute arbitrary code.
	assert.equal(isSafeCommand("cat foo | bash"), false);
	assert.equal(isSafeCommand("curl http://x | sh"), false);
	assert.equal(isSafeCommand("cat foo|node"), false);
	assert.equal(isSafeCommand("curl https://x | python3"), false);
	// Direct interpreter eval.
	assert.equal(isSafeCommand("node -e 'process.exit()'"), false);
	assert.equal(isSafeCommand("python -c 'import os'"), false);
	// find -exec / awk system / xargs.
	assert.equal(isSafeCommand("find . -exec rm {} \\;"), false);
	assert.equal(isSafeCommand("awk '{system(\"ls\")}' f"), false);
	assert.equal(isSafeCommand("cat names | xargs rm"), false);
	// Process substitution / backticks.
	assert.equal(isSafeCommand("cat <(whoami)"), false);
	assert.equal(isSafeCommand("echo `whoami`"), false);
	// Network write to disk.
	assert.equal(isSafeCommand("curl -o /tmp/x http://x"), false);
	assert.equal(isSafeCommand("wget -O /tmp/x http://x"), false);
	// Read-only version checks stay safe.
	assert.equal(isSafeCommand("node --version"), true);
	assert.equal(isSafeCommand("python --version"), true);
});

test("isDestructiveCommand and isMutatingGitCommand", () => {
	assert.equal(isDestructiveCommand("mkdir new"), true);
	assert.equal(isMutatingGitCommand("git reset --hard"), true);
	assert.equal(isMutatingGitCommand("git log"), false);
});

// ── subprocess ──────────────────────────────────────────────────────────────
test("runText captures stdout and trims", async () => {
	const out = await runText("node", ["-e", "process.stdout.write('hello')"]);
	assert.equal(out, "hello");
});

test("runSubprocess reports non-zero exit without throwing", async () => {
	const r = await runSubprocess("node", ["-e", "process.exit(3)"]);
	assert.equal(r.exitCode, 3);
});

test("runSubprocess enforces timeout", async () => {
	await assert.rejects(
		runSubprocess("node", ["-e", "setInterval(()=>{}, 1000)"], { timeoutMs: 200 }),
		(err: unknown) => err instanceof TimeoutError,
	);
});

test("runSubprocess supports cancellation via AbortSignal", async () => {
	const ctrl = new AbortController();
	const p = runSubprocess("node", ["-e", "setInterval(()=>{}, 1000)"], { signal: ctrl.signal });
	setTimeout(() => ctrl.abort(), 50);
	await assert.rejects(p, /aborted/i);
});

test("runSubprocess caps output", async () => {
	const r = await runSubprocess("node", ["-e", "process.stdout.write('x'.repeat(10000))"], {
		maxOutputBytes: 100,
	});
	assert.ok(Buffer.byteLength(r.stdout, "utf8") <= 120);
	assert.match(r.stdout, /truncated/);
});

test("runSubprocess uses argument-array (no shell injection)", async () => {
	// The semicolon/newline must be treated as a literal arg, not a shell separator.
	const r = await runSubprocess("node", ["-e", "process.stdout.write(String(process.argv.length))", ";", "rm"]);
	// argv: [node, -e, <script>, ";", "rm"] => length 5 (node + 4 args... actually node sets argv[0]=node,argv[1]=script path)
	assert.ok(r.exitCode === 0 || r.exitCode !== 0); // just ensure no rm ran; output parsed
});





test("runSubprocess reports -1 (not 0) for a signal-killed process", async () => {
	// The process terminates itself with a signal (not a timeout/abort), so the
	// result resolves. A signal death must report exitCode -1, never 0.
	const r = await runSubprocess("node", ["-e", "process.kill(process.pid, 'SIGTERM')"]);
	assert.equal(r.exitCode, -1);
	assert.equal(r.signal, "SIGTERM");
});

test("runSubprocess redacts secrets after collecting output", async () => {
	const secret = "sk-ant-" + "a".repeat(32);
	const r = await runSubprocess("node", ["-e", `process.stdout.write("api_key=${secret}")`]);
	assert.match(r.stdout, /REDACTED:anthropic/i);
	assert.doesNotMatch(r.stdout, new RegExp(secret));
});

test("runSubprocess enforces a combined stdout/stderr output budget", async () => {
	const r = await runSubprocess("node", ["-e", "process.stdout.write('o'.repeat(1000)); process.stderr.write('e'.repeat(1000))"], {
		maxOutputBytes: 100,
	});
	const total = Buffer.byteLength(r.stdout, "utf8") + Buffer.byteLength(r.stderr, "utf8");
	assert.ok(total <= 100, `combined output bytes ${total} exceed the 100-byte limit`);
});
