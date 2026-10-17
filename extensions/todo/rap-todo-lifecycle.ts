/**
 * Rap Todo System — lifecycle wiring.
 *
 * Owns the shared session/deps interfaces and registers:
 *  - `session_start`: load/validate per-project data, restore unfinished tasks,
 *    show or hide the compact panel, report corruption without destroying data.
 *  - `before_agent_start`: inject a "plan now" guideline only for complex prompts
 *    with no existing unfinished plan (verified hook, no prompt interception).
 *
 * The sessions map, widget refresh, and manager loading live in the composition
 * root (`rap-todo-index.ts`); this module consumes them via `deps`.
 */

import type {
  ExtensionAPI,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

import type { RapTodoManager } from "./rap-todo-manager.ts";
import {
  RAP_TODO_PLAN_GUIDELINE,
  shouldPlanRapTodoNow,
} from "./rap-todo-planner.ts";
import type { RapTodoPanelComponent } from "./ui/rap-todo-panel.ts";

/** Per-project runtime state. */
export interface RapTodoSession {
  manager: RapTodoManager;
  panel?: RapTodoPanelComponent;
  panelTui?: TUI;
  /** Theme captured from the widget factory, used to update panel content live. */
  theme?: Theme;
}

/** Capabilities the composition root supplies to tool/commands/lifecycle. */
export interface RapTodoFeatureDeps {
  resolveSession(cwd: string): RapTodoSession | undefined;
  /** Load (or reuse) the manager for a project root. */
  ensureSession(cwd: string): RapTodoSession;
  /** Reconcile widget visibility + content for a project's UI. */
  refreshPanel(ui: ExtensionUIContext, cwd: string): void;
}

export function registerRapTodoLifecycle(
  pi: ExtensionAPI,
  deps: RapTodoFeatureDeps,
): void {
  pi.on("session_start", async (_event, ctx) => {
    // Load data in every mode so commands/tools remain functional headless.
    const session = deps.ensureSession(ctx.cwd);

    if (ctx.mode !== "tui" || !ctx.hasUI) return;

    // Restore: show the panel iff there is unfinished work.
    try {
      deps.refreshPanel(ctx.ui, ctx.cwd);
    } catch {
      /* best-effort; never block session start */
    }

    // Surface corruption (original file preserved by storage).
    if (session.manager.isCorrupt()) {
      ctx.ui.notify(
        `Todo data could not be loaded: ${session.manager.corruptError() ?? "corrupt file"}. The original file was preserved.`,
        "warning",
      );
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (event.messageType !== "user") return;
    const session = deps.ensureSession(ctx.cwd);
    if (shouldPlanRapTodoNow(event.prompt, session.manager)) {
      // Mutate the mutable prompt sections (verified API) to nudge planning.
      event.systemPromptOptions.promptGuidelines.push(RAP_TODO_PLAN_GUIDELINE);
    }
  });
}
