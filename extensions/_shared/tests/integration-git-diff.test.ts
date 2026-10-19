import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { buildDiffArgs, isSafeDiffRef, parseDiffArgs, parseGitDiff } from "../git-diff.ts";

test("git-diff integration: compare a changed file in a temporary repository", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "rap-plus-git-diff-"));
	const git = (args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
	try {
		const init = git(["init", "-q"]);
		assert.equal(init.status, 0, init.stderr);
		assert.equal(git(["config", "user.name", "RAP+ test"]).status, 0);
		assert.equal(git(["config", "user.email", "rap-plus-test@example.invalid"]).status, 0);
		fs.writeFileSync(path.join(root, "sample.ts"), "export const before = 1;\n");
		assert.equal(git(["add", "sample.ts"]).status, 0);
		assert.equal(git(["commit", "-m", "initial", "-q"]).status, 0);
		fs.writeFileSync(path.join(root, "sample.ts"), "export const after = 2;\n");
		const result = git(["diff", ...buildDiffArgs(parseDiffArgs([]))]);
		assert.equal(result.status, 0, result.stderr);
		const changed = parseGitDiff(result.stdout);
		assert.equal(changed.length, 1);
		assert.equal(changed[0].path, "sample.ts");
		assert.ok(changed[0].hunks.length > 0);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("git-diff ref parser rejects option injection and malformed refs", () => {
	for (const ref of ["--output=/tmp/overwrite", "--cached", "../outside", "main..HEAD", "main@{1}", "topic:other", "refs//heads/x"]) {
		assert.equal(isSafeDiffRef(ref), false, ref);
		assert.throws(() => parseDiffArgs([`--ref=${ref}`]), /Invalid --ref branch name/i, ref);
	}
	assert.equal(isSafeDiffRef("feature/safe-branch_1"), true);
	assert.deepEqual(parseDiffArgs(["--ref=feature/safe-branch_1"]), {
		staged: false,
		ref: "feature/safe-branch_1",
		files: [],
	});
});
