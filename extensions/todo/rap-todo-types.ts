/**
 * Rap Todo System — core data model, status icons, and color mapping.
 *
 * Every status has exactly one primary glyph:
 *   completed    -> "✓"  (green)
 *   in_progress  -> "◉"  (orange-yellow)
 *   pending      -> "○"  (normal foreground, no color)
 *   blocked      -> "⊘"  (red, distinct — never conflicts with the three primary icons)
 *
 * Color is applied to the icon ONLY. Task titles always use the normal foreground.
 */

export type RapTodoStatus = "pending" | "in_progress" | "completed" | "blocked";

export type RapTodoSource = "manual" | "automatic";

export interface RapTodoItem {
  /** Stable, unique within a project (numeric string from a monotonic counter). */
  id: string;
  title: string;
  status: RapTodoStatus;
  source: RapTodoSource;
  /** IDs this task depends on. Must reference existing tasks; no cycles. */
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface RapTodoProject {
  schemaVersion: 1;
  projectId: string;
  projectRoot: string;
  /** ID of the task currently flagged as the active focus (for safe resume). */
  activeTask?: string;
  /** Monotonic counter backing stable IDs. */
  nextId: number;
  todos: RapTodoItem[];
  updatedAt: string;
}

export const RAP_TODO_SCHEMA_VERSION = 1 as const;

/** Exact primary glyphs. Never substitute emojis or alternate glyphs. */
export const RAP_TODO_ICONS: Record<RapTodoStatus, string> = Object.freeze({
  completed: "✓",
  in_progress: "◉",
  pending: "○",
  blocked: "⊘",
});

/**
 * Theme color role applied to the icon only.
 * `null` means: render the raw glyph with no color (normal foreground).
 */
export const RAP_TODO_ICON_COLOR: Record<RapTodoStatus, "success" | "warning" | "error" | null> =
  Object.freeze({
    completed: "success", // green
    in_progress: "warning", // orange-yellow
    pending: null, // normal foreground
    blocked: "error", // red — distinct, does not conflict with the three primary icons
  });

export interface RapTodoCounts {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  blocked: number;
  unfinished: number;
}

export function rapTodoCounts(todos: RapTodoItem[]): RapTodoCounts {
  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  let blocked = 0;
  for (const t of todos) {
    if (t.status === "completed") completed++;
    else if (t.status === "in_progress") inProgress++;
    else if (t.status === "blocked") blocked++;
    else pending++;
  }
  return {
    total: todos.length,
    completed,
    inProgress,
    pending,
    blocked,
    unfinished: inProgress + pending + blocked,
  };
}

/** True when at least one task is not completed. */
export function rapTodoHasUnfinished(todos: RapTodoItem[]): boolean {
  return todos.some((t) => t.status !== "completed");
}

/** Validated state-transition targets for a given current status. */
export function rapTodoCanTransitionTo(from: RapTodoStatus, to: RapTodoStatus): boolean {
  if (from === to) return true;
  switch (from) {
    case "pending":
      return to === "in_progress" || to === "completed" || to === "blocked";
    case "in_progress":
      return to === "pending" || to === "completed" || to === "blocked";
    case "blocked":
      return to === "pending" || to === "in_progress" || to === "completed";
    case "completed":
      // Reopen only to pending (never directly to in_progress).
      return to === "pending";
  }
}
