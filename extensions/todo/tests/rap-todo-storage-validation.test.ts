import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRapTodoProject } from "../rap-todo-storage.ts";
import { RAP_TODO_SCHEMA_VERSION } from "../rap-todo-types.ts";

const root = "/project";
const todo = (id: string, dependencies: string[] = []) => ({
	id, title: `task ${id}`, status: "pending", source: "manual",
	dependencies, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});
const project = (todos: unknown[], nextId = 1) => ({
	schemaVersion: RAP_TODO_SCHEMA_VERSION, projectId: "test", projectRoot: root,
	nextId, todos, updatedAt: "2026-01-01T00:00:00.000Z",
});

test("todo storage rejects dependency cycles in loaded JSON", () => {
	const result = validateRapTodoProject(project([todo("1", ["2"]), todo("2", ["1"])], 3), root);
	assert.ok("error" in result);
	if ("error" in result) assert.match(result.error, /circular dependency/i);
});

test("todo storage normalizes stale nextId without marking valid records corrupt", () => {
	const result = validateRapTodoProject(project([todo("1"), todo("7")], 2), root);
	assert.ok("data" in result);
	if ("data" in result) {
		assert.equal(result.data.nextId, 8);
		assert.equal(result.data.todos.length, 2);
	}
});

test("todo storage rejects non-safe ID counters", () => {
	const result = validateRapTodoProject(project([todo("1")], Number.MAX_SAFE_INTEGER + 1), root);
	assert.ok("error" in result);
	if ("error" in result) assert.match(result.error, /nextId/i);
});
