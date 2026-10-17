import { test } from "node:test";
import assert from "node:assert";
import { RapTodoManager } from "../rap-todo-manager.ts";
import type { RapTodoProject } from "../rap-todo-types.ts";
import type { RapTodoStorage, RapTodoStorageLoadResult, RapTodoStorageSaveResult } from "../rap-todo-storage.ts";

/** In-memory storage fake for deterministic manager tests. */
function makeMemoryStorage(): RapTodoStorage & { snapshot: () => RapTodoProject | undefined } {
	let stored: RapTodoProject | undefined;
	const s: RapTodoStorage & { snapshot: () => RapTodoProject | undefined } = {
		pathFor: () => "<mem>/todos.json",
		load: (): RapTodoStorageLoadResult =>
			stored ? { ok: true, data: structuredClone(stored) } : { ok: false, missing: true },
		save: (_root: string, data: RapTodoProject): RapTodoStorageSaveResult => {
			stored = structuredClone(data);
			return { ok: true };
		},
		snapshot: () => stored,
	};
	return s;
}

function freshManager(root = "/proj"): RapTodoManager {
	return RapTodoManager.load(makeMemoryStorage(), root);
}

test("planTasks creates a fresh list when there are no prior todos", () => {
	const m = freshManager();
	const r = m.planTasks([{ title: "A" }, { title: "B", dependencies: ["A"] }]);
	assert.equal(r.ok, true);
	const titles = m.getTodos().map((t) => t.title);
	assert.deepEqual(titles, ["A", "B"]);
	assert.equal(m.getTodos().find((t) => t.title === "B")?.dependencies.length, 1);
});

test("planTasks drops completed automatic tasks when the previous plan is fully complete (no reappear)", () => {
	const m = freshManager();
	m.planTasks([{ title: "Old1" }, { title: "Old2" }]);
	// complete both -> previous plan fully done
	m.setStatus(m.getTodos().find((t) => t.title === "Old1")!.id, "completed");
	m.setStatus(m.getTodos().find((t) => t.title === "Old2")!.id, "completed");
	assert.equal(m.hasUnfinished(), false);

	// new plan after all done -> old completed tasks must NOT reappear
	m.planTasks([{ title: "New1" }]);
	const titles = m.getTodos().map((t) => t.title);
	assert.deepEqual(titles, ["New1"]);
	assert.ok(!titles.includes("Old1"));
	assert.ok(!titles.includes("Old2"));
});

test("planTasks preserves completed automatic tasks when re-planning mid-work (progress context)", () => {
	const m = freshManager();
	m.planTasks([{ title: "A" }, { title: "B" }, { title: "C" }]);
	// complete only A; B and C unfinished -> not fully complete
	m.setStatus(m.getTodos().find((t) => t.title === "A")!.id, "completed");
	assert.equal(m.hasUnfinished(), true);

	// re-plan -> completed A preserved; B, C replaced by new pending tasks
	m.planTasks([{ title: "B2" }, { title: "C2" }]);
	const titles = m.getTodos().map((t) => t.title);
	assert.ok(titles.includes("A"), "completed A kept for progress context");
	assert.ok(!titles.includes("B"));
	assert.ok(!titles.includes("C"));
	assert.ok(titles.includes("B2"));
	assert.ok(titles.includes("C2"));
});

test("planTasks always preserves manual tasks across plans", () => {
	const m = freshManager();
	m.add("Manual note", "manual");
	m.planTasks([{ title: "A1" }]);
	m.setStatus(m.getTodos().find((t) => t.title === "A1")!.id, "completed");
	// fully complete automatic plan, then re-plan -> manual must survive
	m.planTasks([{ title: "A2" }]);
	const titles = m.getTodos().map((t) => t.title);
	assert.ok(titles.includes("Manual note"));
	assert.ok(titles.includes("A2"));
	assert.ok(!titles.includes("A1"));
});

test("planTasks is a no-op when re-planning the identical unfinished automatic plan", () => {
	const m = freshManager();
	m.planTasks([{ title: "A" }, { title: "B" }]);
	const beforeIds = m.getTodos().map((t) => t.id).join(",");
	// identical titles, still unfinished -> no-op (no new IDs minted)
	const r = m.planTasks([{ title: "A" }, { title: "B" }]);
	assert.equal(r.ok, true);
	const afterIds = m.getTodos().map((t) => t.id).join(",");
	assert.equal(beforeIds, afterIds);
});

test("planTasks rejects duplicate titles, unknown deps, and cycles", () => {
	const m = freshManager();
	const dups = m.planTasks([{ title: "X" }, { title: "X" }]);
	assert.ok(!dups.ok);
	assert.match((dups as { error: string }).error, /Duplicate/);
	const unknown = m.planTasks([{ title: "Y", dependencies: ["Z"] }]);
	assert.ok(!unknown.ok);
	assert.match((unknown as { error: string }).error, /unknown/);
	const cycle = m.planTasks([{ title: "P", dependencies: ["Q"] }, { title: "Q", dependencies: ["P"] }]);
	assert.ok(!cycle.ok);
	assert.match((cycle as { error: string }).error, /Circular/);
});
