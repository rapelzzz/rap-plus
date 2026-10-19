/**
 * Rap Todo System — persistent per-project storage.
 *
 * Location: <project-root>/.pi/todo-system/todos.json
 *
 * Guarantees:
 *  - Atomic writes (temp file + rename).
 *  - Never silently replaces corrupt data with an empty list — returns a corrupt
 *    result preserving the original file so the user can recover.
 *  - Validates every field before accepting loaded data.
 *  - Handles read/write failures without destroying existing records.
 *  - Each project's data is isolated by its project root.
 */

import fs from "node:fs";
import path from "node:path";

import {
  RAP_TODO_SCHEMA_VERSION,
  type RapTodoItem,
  type RapTodoProject,
  type RapTodoSource,
  type RapTodoStatus,
} from "./rap-todo-types.ts";

/** Runtime data filename (not a repository-managed source file, so "rap" rule N/A). */
export const RAP_TODO_DATA_DIR = path.join(".pi", "todo-system");
export const RAP_TODO_DATA_FILENAME = "todos.json";

const VALID_STATUSES: readonly RapTodoStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "blocked",
];
const VALID_SOURCES: readonly RapTodoSource[] = ["manual", "automatic"];

export type RapTodoStorageLoadResult =
  | { ok: true; data: RapTodoProject }
  | { ok: false; missing: true }
  | { ok: false; error: string; rawPath: string };

export type RapTodoStorageSaveResult =
  | { ok: true }
  | { ok: false; error: string };

export interface RapTodoStorage {
  /** Resolve the absolute data file path for a project root. */
  pathFor(projectRoot: string): string;
  /** Load + validate. Returns `missing` only when the file does not exist. */
  load(projectRoot: string): RapTodoStorageLoadResult;
  /** Atomic write. Never destroys existing records on failure. */
  save(projectRoot: string, data: RapTodoProject): RapTodoStorageSaveResult;
}

/** Stable project identity from an absolute project root (djb2 hex hash). */
export function rapTodoProjectId(projectRoot: string): string {
  const normalized = path.resolve(projectRoot);
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) >>> 0;
  }
  return `pid-${hash.toString(16)}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function validateItem(raw: unknown, index: number): RapTodoItem | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return `todo[${index}]: expected an object`;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0) return `todo[${index}]: invalid id`;
  if (typeof r.title !== "string" || r.title.trim().length === 0)
    return `todo[${index}]: invalid title`;
  if (typeof r.status !== "string" || !VALID_STATUSES.includes(r.status as RapTodoStatus))
    return `todo[${index}]: invalid status "${r.status}"`;
  if (typeof r.source !== "string" || !VALID_SOURCES.includes(r.source as RapTodoSource))
    return `todo[${index}]: invalid source "${r.source}"`;
  if (!isStringArray(r.dependencies)) return `todo[${index}]: invalid dependencies`;
  if (typeof r.createdAt !== "string") return `todo[${index}]: invalid createdAt`;
  if (typeof r.updatedAt !== "string") return `todo[${index}]: invalid updatedAt`;
  if (r.completedAt !== undefined && typeof r.completedAt !== "string")
    return `todo[${index}]: invalid completedAt`;
  return {
    id: r.id,
    title: r.title,
    status: r.status as RapTodoStatus,
    source: r.source as RapTodoSource,
    dependencies: r.dependencies,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    completedAt: r.completedAt as string | undefined,
  };
}

/** Validate + migrate raw parsed JSON into a RapTodoProject. Returns error string on failure. */
export function validateRapTodoProject(
  raw: unknown,
  projectRoot: string,
): { data: RapTodoProject } | { error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return { error: "root is not an object" };
  const r = raw as Record<string, unknown>;

  // Migrate older/missing schemaVersion safely. We only support v1; anything
  // unrecognised is reported as corrupt rather than silently reset.
  if (r.schemaVersion !== undefined && r.schemaVersion !== RAP_TODO_SCHEMA_VERSION) {
    return { error: `unsupported schemaVersion ${String(r.schemaVersion)}` };
  }

  if (!Array.isArray(r.todos)) return { error: "todos is not an array" };
  if (typeof r.nextId !== "number" || !Number.isSafeInteger(r.nextId) || r.nextId < 1)
    return { error: "invalid nextId" };
  if (typeof r.updatedAt !== "string") return { error: "invalid updatedAt" };

  const todos: RapTodoItem[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < r.todos.length; i++) {
    const res = validateItem(r.todos[i], i);
    if (typeof res === "string") return { error: res };
    if (seenIds.has(res.id)) return { error: `duplicate id ${res.id}` };
    seenIds.add(res.id);
    todos.push(res);
  }

  // Validate dependency references exist.
  const byId = new Map(todos.map((todo) => [todo.id, todo] as const));
  for (const t of todos) {
    for (const dep of t.dependencies) {
      if (!seenIds.has(dep)) return { error: `todo ${t.id} depends on missing id ${dep}` };
    }
  }

  // Existing files may have been hand-edited; reject cycles during load too.
  const colors = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string | null => {
    colors.set(id, 1);
    stack.push(id);
    for (const dep of byId.get(id)?.dependencies ?? []) {
      const color = colors.get(dep) ?? 0;
      if (color === 1) return stack.slice(stack.indexOf(dep)).concat(dep).join(" -> ");
      if (color === 0) {
        const cycle = visit(dep);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    colors.set(id, 2);
    return null;
  };
  for (const todo of todos) {
    if ((colors.get(todo.id) ?? 0) === 0) {
      const cycle = visit(todo.id);
      if (cycle) return { error: `circular dependency: ${cycle}` };
    }
  }

  const numericIds = todos
    .map((todo) => /^\d+$/.test(todo.id) ? Number(todo.id) : 0)
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  const maxNumericId = numericIds.length > 0 ? Math.max(...numericIds) : 0;
  if (maxNumericId >= Number.MAX_SAFE_INTEGER) {
    return { error: "numeric todo id is outside the safe integer range" };
  }
  // Repair stale counters safely rather than labelling an otherwise valid user
  // file corrupt or risking a collision on the next mutation.
  const nextId = Math.max(r.nextId, maxNumericId + 1);

  const projectId =
    typeof r.projectId === "string" && r.projectId.length > 0
      ? r.projectId
      : rapTodoProjectId(projectRoot);

  const data: RapTodoProject = {
    schemaVersion: RAP_TODO_SCHEMA_VERSION,
    projectId,
    projectRoot: path.resolve(projectRoot),
    nextId,
    todos,
    updatedAt: r.updatedAt,
  };
  if (typeof r.activeTask === "string" && seenIds.has(r.activeTask)) {
    data.activeTask = r.activeTask;
  }
  return { data };
}

/** Create an empty project record (used only for brand-new projects, never to mask corruption). */
export function createEmptyRapTodoProject(projectRoot: string): RapTodoProject {
  return {
    schemaVersion: RAP_TODO_SCHEMA_VERSION,
    projectId: rapTodoProjectId(projectRoot),
    projectRoot: path.resolve(projectRoot),
    nextId: 1,
    todos: [],
    updatedAt: new Date().toISOString(),
  };
}

export function createRapTodoStorage(): RapTodoStorage {
  return {
    pathFor(projectRoot) {
      return path.join(projectRoot, RAP_TODO_DATA_DIR, RAP_TODO_DATA_FILENAME);
    },

    load(projectRoot) {
      const filePath = this.pathFor(projectRoot);
      let text: string;
      try {
        text = fs.readFileSync(filePath, "utf-8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { ok: false, missing: true };
        }
        // Read error (permissions, etc.) — do not destroy anything.
        return {
          ok: false,
          error: `Could not read ${filePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          rawPath: filePath,
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        // Malformed JSON — preserve the file and report the error.
        return {
          ok: false,
          error: `Corrupt todos.json (invalid JSON): ${
            error instanceof Error ? error.message : String(error)
          }`,
          rawPath: filePath,
        };
      }

      const result = validateRapTodoProject(parsed, projectRoot);
      if ("error" in result) {
        return { ok: false, error: result.error, rawPath: filePath };
      }
      return { ok: true, data: result.data };
    },

    save(projectRoot, data) {
      const filePath = this.pathFor(projectRoot);
      const dir = path.dirname(filePath);
      let temporaryPath: string | undefined;
      try {
        fs.mkdirSync(dir, { recursive: true });
        const payload = JSON.stringify(data, null, 2);
        temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(temporaryPath, payload, "utf-8");
        fs.renameSync(temporaryPath, filePath);
        temporaryPath = undefined;
        return { ok: true };
      } catch (error) {
        if (temporaryPath) {
          try {
            fs.unlinkSync(temporaryPath);
          } catch {
            /* best-effort cleanup */
          }
        }
        // Existing file is left untouched on failure.
        return {
          ok: false,
          error: `Could not save ${filePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    },
  };
}
