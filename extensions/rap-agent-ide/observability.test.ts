import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { resolveCpuProfileOutFile } from "./observability.ts";

test("CPU profile output falls back for absolute and traversal paths", () => {
	const cwd = mkdtempSync(path.join(tmpdir(), "rap-profile-path-"));
	try {
		const fallback = path.resolve(cwd, "rap-cpu-profile.cpuprofile");
		assert.equal(resolveCpuProfileOutFile(cwd, "/etc/cron.d/x"), fallback);
		assert.equal(resolveCpuProfileOutFile(cwd, "../../outside.cpuprofile"), fallback);
		assert.equal(resolveCpuProfileOutFile(cwd, "safe/profile.cpuprofile"), path.resolve(cwd, "safe/profile.cpuprofile"));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
