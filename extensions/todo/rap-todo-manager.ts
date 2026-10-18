/**
 * Rap Todo System — in-memory state manager + operations.
 *
 * Single source of truth is the persisted file; the manager owns the working
 * copy and re-saves after every mutation. Operations validate IDs, state
 * transitions, and dependencies (including circular-dependency detection).
 */

import {
  rapTodoCanTransitionTo,
  rapTodoCounts,
  type RapTodoCounts,
  type RapTodoItem,
  type RapTodoProject,
  type RapTodoSource,
  type RapTodoStatus,
} from "./rap-todo-types.ts";
import {
  createEmptyRapTodoProject,
  rapTodoProjectId,
  type RapTodoStorage,
  type RapTodoStorageLoadResult,
} from "./rap-todo-storage.ts";

export type RapTodoOpResult =
  | { ok: true; project: RapTodoProject }
  | { ok: false; error: string };

/** A planned task as supplied by the planner tool (title + optional dependency titles). */
export interface RapTodoPlanInput {
  title: string;
  dependencies?: string[];
}

interface PlanTask {
  title: string;
  /** Titles this task depends on (resolved to IDs after the plan set is built). */
  dependsOnTitles?: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Detect a cycle in a title->title dependency graph (DFS). Returns the cycle or null. */
function findTitleCycle(tasks: PlanTask[]): string[] | null {
  const byTitle = new Map<string, PlanTask>();
  for (const t of tasks) byTitle.set(t.title, t);
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];

  const visit = (title: string): string[] | null => {
    color.set(title, GRAY);
    stack.push(title);
    const deps = byTitle.get(title)?.dependsOnTitles ?? [];
    for (const dep of deps) {
      if (!byTitle.has(dep)) continue; // unknown dep handled by caller
      const c = color.get(dep) ?? WHITE;
      if (c === GRAY) {
        const start = stack.indexOf(dep);
        return stack.slice(start).concat(dep);
      }
      if (c === WHITE) {
        const cycle = visit(dep);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    color.set(title, BLACK);
    return null;
  };

  for (const t of tasks) {
    if ((color.get(t.title) ?? WHITE) === WHITE) {
      const cycle = visit(t.title);
      if (cycle) return cycle;
    }
  }
  return null;
}

export class RapTodoManager {
  private readonly storage: RapTodoStorage;
  readonly projectRoot: string;
  private project: RapTodoProject;
  /** Load result, surfaced so callers can report corruption without destroying data. */
  readonly loadResult: RapTodoStorageLoadResult;

  private constructor(
    storage: RapTodoStorage,
    projectRoot: string,
    project: RapTodoProject,
    loadResult: RapTodoStorageLoadResult,
  ) {
    this.storage = storage;
    this.projectRoot = projectRoot;
    this.project = project;
    this.loadResult = loadResult;
  }

  /**
   * Load (or create) a manager for a project root.
   * Corrupt data is NOT replaced: a corrupt manager exposes `loadResult` and
   * operates on an empty in-memory project while the original file is preserved.
   * Use `isCorrupt()` to guard mutations.
   */
  static load(storage: RapTodoStorage, projectRoot: string): RapTodoManager {
    const result = storage.load(projectRoot);
    if (result.ok) {
      return new RapTodoManager(storage, projectRoot, result.data, result);
    }
    if ("missing" in result) {
      const fresh = createEmptyRapTodoProject(projectRoot);
      return new RapTodoManager(storage, projectRoot, fresh, result);
    }
    // Corrupt/read error: operate on an empty project, preserve original file.
    const empty = createEmptyRapTodoProject(projectRoot);
    return new RapTodoManager(storage, projectRoot, empty, result);
  }

  isCorrupt(): boolean {
    const r = this.loadResult;
    return !r.ok && !("missing" in r);
  }

  corruptError(): string | undefined {
    const r = this.loadResult;
    return !r.ok && !("missing" in r) ? r.error : undefined;
  }

  getProject(): RapTodoProject {
    return this.project;
  }
  getTodos(): RapTodoItem[] {
    return this.project.todos;
  }
  counts(): RapTodoCounts {
    return rapTodoCounts(this.project.todos);
  }
  hasUnfinished(): boolean {
    return this.project.todos.some((t) => t.status !== "completed");
  }
  hasUnfinishedAutomatic(): boolean {
    return this.project.todos.some(
      (t) => t.source === "automatic" && t.status !== "completed",
    );
  }
  find(id: string): RapTodoItem | undefined {
    return this.project.todos.find((t) => t.id === id);
  }

  private commit(): RapTodoOpResult {
    // Corrupt data is never silently overwritten: refuse to persist any
    // mutation so the original (corrupt but recoverable) file is preserved.
    // The in-memory project may have been tentatively mutated, but it is not
    // saved; callers see a failure and the file stays intact for recovery.
    if (this.isCorrupt()) {
      return {
        ok: false,
        error:
          "Todo data is corrupt; refusing to overwrite. Recover or delete the todos file manually.",
      };
    }
    this.project.updatedAt = nowIso();
    const save = this.storage.save(this.projectRoot, this.project);
    if (!save.ok) return { ok: false, error: save.error };
    return { ok: true, project: this.project };
  }

  private nextId(): string {
    return String(this.project.nextId++);
  }

  add(title: string, source: RapTodoSource = "manual"): RapTodoOpResult {
    const trimmed = title.trim();
    if (trimmed.length === 0) return { ok: false, error: "Task title cannot be empty" };
    const item: RapTodoItem = {
      id: this.nextId(),
      title: trimmed,
      status: "pending",
      source,
      dependencies: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.project.todos.push(item);
    return this.commit();
  }

  /** Mark a task completed and record completion time. */
  check(id: string): RapTodoOpResult {
    const item = this.find(id);
    if (!item) return { ok: false, error: `Task ${id} not found` };
    if (item.status === "completed") return { ok: true, project: this.project };
    item.status = "completed";
    item.completedAt = nowIso();
    item.updatedAt = nowIso();
    if (this.project.activeTask === id) this.project.activeTask = undefined;
    return this.commit();
  }

  /** Reopen a completed task as pending. */
  uncheck(id: string): RapTodoOpResult {
    const item = this.find(id);
    if (!item) return { ok: false, error: `Task ${id} not found` };
    if (item.status !== "completed")
      return { ok: false, error: `Task ${id} is not completed` };
    item.status = "pending";
    item.completedAt = undefined;
    item.updatedAt = nowIso();
    return this.commit();
  }

  edit(id: string, title: string): RapTodoOpResult {
    const trimmed = title.trim();
    if (trimmed.length === 0) return { ok: false, error: "Task title cannot be empty" };
    const item = this.find(id);
    if (!item) return { ok: false, error: `Task ${id} not found` };
    item.title = trimmed;
    item.updatedAt = nowIso();
    return this.commit();
  }

  /** Remove a task. Returns IDs of tasks that depended on it (caller warns, never silently invalidates). */
  remove(id: string): RapTodoOpResult & { dependents?: string[] } {
    const item = this.find(id);
    if (!item) return { ok: false, error: `Task ${id} not found` };
    const dependents = this.project.todos
      .filter((t) => t.dependencies.includes(id))
      .map((t) => t.id);
    // Clean up dangling dependency references left behind.
    for (const t of this.project.todos) {
      if (t.dependencies.includes(id)) {
        t.dependencies = t.dependencies.filter((d) => d !== id);
        t.updatedAt = nowIso();
      }
    }
    this.project.todos = this.project.todos.filter((t) => t.id !== id);
    if (this.project.activeTask === id) this.project.activeTask = undefined;
    const res = this.commit();
    return { ...res, dependents };
  }

  clearCompleted(): RapTodoOpResult & { removed: number } {
    const before = this.project.todos.length;
    this.project.todos = this.project.todos.filter((t) => t.status !== "completed");
    const removed = before - this.project.todos.length;
    return { ...this.commit(), removed };
  }

  /** Remove ALL todos (completed + unfinished). Resets the active task. nextId stays monotonic. */
  clearAll(): RapTodoOpResult & { removed: number } {
    const before = this.project.todos.length;
    this.project.todos = [];
    this.project.activeTask = undefined;
    const removed = before;
    return { ...this.commit(), removed };
  }

  /** Set a task's status with transition validation. */
  setStatus(id: string, status: RapTodoStatus): RapTodoOpResult {
    const item = this.find(id);
    if (!item) return { ok: false, error: `Task ${id} not found` };
    if (!rapTodoCanTransitionTo(item.status, status)) {
      return {
        ok: false,
        error: `Task ${id} cannot move from ${item.status} to ${status}`,
      };
    }
    item.status = status;
    item.updatedAt = nowIso();
    if (status === "completed") item.completedAt = nowIso();
    else item.completedAt = undefined;
    if (status === "in_progress") this.project.activeTask = id;
    else if (this.project.activeTask === id) this.project.activeTask = undefined;
    return this.commit();
  }

  /**
   * Apply a model-generated plan for complex work.
   *
   * Reconciliation rules (prevents duplicate plans, never silently drops history):
   *  - Completed tasks are always preserved.
   *  - If the new plan's titles exactly match the current unfinished automatic
   *    plan, this is a no-op (duplicate prevention).
   *  - Otherwise the unfinished automatic tasks are replaced by the new plan
   *    (pending by default); manual tasks are preserved.
   */
  planTasks(inputs: RapTodoPlanInput[], source: RapTodoSource = "automatic"): RapTodoOpResult {
    if (inputs.length === 0) return { ok: false, error: "Plan must contain at least one task" };

    const planTasks: PlanTask[] = inputs.map((i) => ({
      title: i.title.trim(),
      dependsOnTitles: (i.dependencies ?? []).map((d) => d.trim()),
    }));
    for (const t of planTasks) {
      if (t.title.length === 0) return { ok: false, error: "Plan task title cannot be empty" };
    }
    // Duplicate titles within the plan are not allowed (dependencies resolve by title).
    const titleSet = new Set<string>();
    for (const t of planTasks) {
      if (titleSet.has(t.title)) return { ok: false, error: `Duplicate task title: ${t.title}` };
      titleSet.add(t.title);
    }
    // Dependency titles must exist within the plan.
    for (const t of planTasks) {
      for (const dep of t.dependsOnTitles ?? []) {
        if (!titleSet.has(dep))
          return { ok: false, error: `Task "${t.title}" depends on unknown task "${dep}"` };
      }
    }
    // Circular dependency detection on the title graph.
    const cycle = findTitleCycle(planTasks);
    if (cycle) return { ok: false, error: `Circular dependency: ${cycle.join(" -> ")}` };

    // Duplicate-plan prevention: identical unfinished automatic plan.
    const unfinishedAuto = this.project.todos.filter(
      (t) => t.source === "automatic" && t.status !== "completed",
    );
    const unfinishedAutoTitles = new Set(unfinishedAuto.map((t) => t.title));
    const newTitles = new Set(planTasks.map((t) => t.title));
    const samePlan =
      unfinishedAuto.length === planTasks.length &&
      planTasks.every((t) => unfinishedAutoTitles.has(t.title)) &&
      unfinishedAuto.every((t) => newTitles.has(t.title));
    if (samePlan) return { ok: true, project: this.project };

    // Decide whether the previous automatic plan is fully complete. When it is,
    // its completed tasks are dropped so a new plan starts fresh — this prevents
    // stale completed todos from reappearing after the panel hid them on "all
    // done". When the previous plan is only partially complete (re-plan mid
    // work), completed tasks are preserved to keep progress context. Manual
    // tasks are always preserved regardless.
    const autoTasks = this.project.todos.filter((t) => t.source === "automatic");
    const prevPlanFullyComplete =
      autoTasks.length > 0 && autoTasks.every((t) => t.status === "completed");

    this.project.todos = this.project.todos.filter((t) => {
      if (t.source === "manual") return true; // always keep user-created tasks
      if (t.status === "completed") return !prevPlanFullyComplete; // drop if prev plan done
      return false; // drop unfinished automatic tasks (replaced by the new plan)
    });

    // Title -> id map for dependency resolution.
    const titleToId = new Map<string, string>();
    for (const t of planTasks) {
      const id = this.nextId();
      titleToId.set(t.title, id);
      this.project.todos.push({
        id,
        title: t.title,
        status: "pending",
        source,
        dependencies: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
    }
    // Wire dependencies (already validated, no cycles).
    for (const t of planTasks) {
      const id = titleToId.get(t.title)!;
      const item = this.find(id)!;
      item.dependencies = (t.dependsOnTitles ?? [])
        .map((d) => titleToId.get(d)!)
        .filter(Boolean);
    }

    return this.commit();
  }

  /** Mark the next sensible task in progress (used by /todo resume). */
  resumeNext(): RapTodoOpResult & { resumedId?: string } {
    if (!this.hasUnfinished()) return { ok: true, project: this.project };
    // Prefer an already in_progress task.
    const inProg = this.project.todos.find((t) => t.status === "in_progress");
    if (inProg) return { ok: true, project: this.project, resumedId: inProg.id };
    // Else the first pending whose dependencies are all completed.
    const pending = this.project.todos.find(
      (t) =>
        t.status === "pending" &&
        t.dependencies.every((d) => this.find(d)?.status === "completed"),
    );
    if (pending) {
      const res = this.setStatus(pending.id, "in_progress");
      return { ...res, resumedId: res.ok ? pending.id : undefined };
    }
    // Else the first pending regardless of deps (may be blocked-aware later).
    const anyPending = this.project.todos.find((t) => t.status === "pending");
    if (anyPending) {
      const res = this.setStatus(anyPending.id, "in_progress");
      return { ...res, resumedId: res.ok ? anyPending.id : undefined };
    }
    return { ok: true, project: this.project };
  }
}

export { rapTodoProjectId };
