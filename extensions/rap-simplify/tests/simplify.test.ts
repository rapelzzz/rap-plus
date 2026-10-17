import { test } from "node:test";
import assert from "node:assert";
import { parseGitDiff, parseSimplifyArgs, buildDiffArgs, formatChangedFiles } from "../utils.ts";

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index 111..222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,5 +12,8 @@ function foo() {
 const a = 1;
 const b = 2;
+const c = 3;
+const d = 4;
 return a;
 }
diff --git a/src/bar.ts b/src/bar.ts
index 333..444 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -1,1 +1,1 @@
-old
+new
diff --git a/binary.dat b/binary.dat
Binary files differ
`;

test("parseGitDiff extracts files and new-file hunk ranges", () => {
	const files = parseGitDiff(SAMPLE_DIFF);
	assert.equal(files.length, 2); // binary.dat has no +++ b/ path hunks mapped
	const foo = files.find((f) => f.path === "src/foo.ts");
	assert.ok(foo);
	assert.equal(foo.hunks.length, 1);
	assert.equal(foo.hunks[0].newStart, 12);
	assert.equal(foo.hunks[0].newLen, 8);
	const bar = files.find((f) => f.path === "src/bar.ts");
	assert.ok(bar);
	assert.equal(bar.hunks[0].newStart, 1);
	assert.equal(bar.hunks[0].newLen, 1);
});

test("parseGitDiff handles empty diff", () => {
	assert.deepEqual(parseGitDiff(""), []);
});

test("parseGitDiff single-line hunk (no ,len) defaults len to 1", () => {
	const diff = `diff --git a/x b/x
--- a/x
+++ b/x
@@ -5,3 +7 @@
 context
+added
 context
`;
	const files = parseGitDiff(diff);
	assert.equal(files.length, 1);
	assert.equal(files[0].hunks[0].newStart, 7);
	assert.equal(files[0].hunks[0].newLen, 1);
});

test("parseSimplifyArgs parses --staged, --ref, files", () => {
	assert.deepEqual(parseSimplifyArgs(["--staged", "a.ts", "b.ts"]), {
		staged: true,
		ref: undefined,
		files: ["a.ts", "b.ts"],
	});
	assert.deepEqual(parseSimplifyArgs(["--ref=main"]), { staged: false, ref: "main", files: [] });
	assert.deepEqual(parseSimplifyArgs(["--cached", "--ref=dev", "x.ts"]), {
		staged: true,
		ref: "dev",
		files: ["x.ts"],
	});
	assert.deepEqual(parseSimplifyArgs(["--unknown-flag", "y.ts"]), {
		staged: false,
		ref: undefined,
		files: ["y.ts"],
	});
});

test("buildDiffArgs assembles git diff args", () => {
	assert.deepEqual(buildDiffArgs({ staged: true, ref: undefined, files: [] }), [
		"--cached",
		"--no-color",
		"-U0",
	]);
	assert.deepEqual(buildDiffArgs({ staged: false, ref: "main", files: [] }), ["main", "--no-color", "-U0"]);
	assert.deepEqual(buildDiffArgs({ staged: false, ref: undefined, files: ["a.ts", "b.ts"] }), [
		"--no-color",
		"-U0",
		"--",
		"a.ts",
		"b.ts",
	]);
});

test("formatChangedFiles renders file list with line ranges", () => {
	const files = parseGitDiff(SAMPLE_DIFF);
	const text = formatChangedFiles(files);
	assert.match(text, /src\/foo\.ts \(L12-19\)/);
	assert.match(text, /src\/bar\.ts \(L1\)/);
});

test("formatChangedFiles empty case", () => {
	assert.equal(formatChangedFiles([]), "(no changes detected)");
});
