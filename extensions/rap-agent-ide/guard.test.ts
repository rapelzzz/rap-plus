import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { validateEditTarget } from "./guard.ts";

test("rejects empty content when it would truncate an existing file", () => {
	const cwd = mkdtempSync(path.join(tmpdir(), "rap-guard-empty-"));
	try {
		writeFileSync(path.join(cwd, "existing.txt"), "keep me", "utf8");
		assert.equal(validateEditTarget(cwd, "existing.txt", "").ok, false);
		assert.equal(validateEditTarget(cwd, "new-empty.txt", "").ok, true);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
