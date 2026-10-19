import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { writeLensMap } from "./lensmap.ts";

test("module map rejects absolute and traversal output paths before writing", () => {
	const cwd = mkdtempSync(path.join(tmpdir(), "rap-lens-map-"));
	try {
		assert.throws(() => writeLensMap(null, cwd, "../outside.html"), /Refusing module-map output path/);
		assert.throws(() => writeLensMap(null, cwd, "/tmp/outside.html"), /Refusing module-map output path/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
