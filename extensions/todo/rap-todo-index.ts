/**
 * Rap Todo System — composition root.
 *
 * Wires storage, per-project sessions, the compact widget lifecycle, the
 * model-callable tool, slash commands, and session/planning hooks. Registered
 * from the main extension entry point via `registerRapTodoFeature(pi)`.
 */

import type { ExtensionAPI, ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import path from "node:path";

import { createRapTodoPanelComponent } from "./ui/rap-todo-panel.ts";
import { RapTodoManager } from "./rap-todo-manager.ts";
import { createRapTodoStorage } from "./rap-todo-storage.ts";
import {
  registerRapTodoLifecycle,
  type RapTodoFeatureDeps,
  type RapTodoSession,
} from "./rap-todo-lifecycle.ts";
import { registerRapTodoTool } from "./rap-todo-tool.ts";
import { registerRapTodoCommands } from "./rap-todo-commands.ts";

const RAP_TODO_WIDGET_KEY = "rap-todo";

export interface RapTodoFeature {
  dispose(): void;
}

export function registerRapTodoFeature(pi: ExtensionAPI): RapTodoFeature {
  const storage = createRapTodoStorage();
  const sessions = new Map<string, RapTodoSession>();

  const resolveSession = (cwd: string): RapTodoSession | undefined =>
    sessions.get(pathKey(cwd));

  const ensureSession = (cwd: string): RapTodoSession => {
    const key = pathKey(cwd);
    const existing = sessions.get(key);
    if (existing) return existing;
    const manager = RapTodoManager.load(storage, cwd);
    const session: RapTodoSession = { manager };
    sessions.set(key, session);
    return session;
  };

  /**
   * Reconcile widget visibility + content. Deterministic function of state:
   * unfinished -> show; all completed / empty -> hide (no reserved space).
   */
  const refreshPanel = (ui: ExtensionUIContext, cwd: string): void => {
    const session = resolveSession(cwd);
    if (!session) return;
    const todos = session.manager.getTodos();
    const hasUnfinished = session.manager.hasUnfinished();

    if (!hasUnfinished) {
      // Hide: never delete records, just remove the widget.
      if (session.panel) {
        ui.setWidget(RAP_TODO_WIDGET_KEY, undefined);
        session.panel.dispose();
        session.panel = undefined;
        session.panelTui = undefined;
        session.theme = undefined;
      }
      return;
    }

    if (!session.panel) {
      // First show: register the widget factory (placement above the editor).
      const factory = (tui: TUI, theme: Theme): Component & { dispose?(): void } => {
        session.panelTui = tui;
        session.theme = theme;
        session.panel = createRapTodoPanelComponent(session.manager.getTodos(), theme);
        return {
          invalidate: () => session.panel?.invalidate(),
          render: (width: number) => session.panel?.render(width) ?? [],
          dispose: () => {
            session.panel?.dispose();
            session.panel = undefined;
            session.panelTui = undefined;
            session.theme = undefined;
          },
        };
      };
      ui.setWidget(RAP_TODO_WIDGET_KEY, factory, { placement: "aboveEditor" });
      return;
    }

    // Live update: refresh content + invalidate + request a render.
    if (session.theme) session.panel.setTodos(todos, session.theme);
    session.panel.invalidate();
    try {
      session.panelTui?.requestRender();
    } catch {
      /* host may have torn down the widget */
    }
  };

  const deps: RapTodoFeatureDeps = { resolveSession, ensureSession, refreshPanel };

  registerRapTodoLifecycle(pi, deps);
  registerRapTodoTool(pi, deps);
  registerRapTodoCommands(pi, deps);

  return {
    dispose() {
      for (const session of sessions.values()) {
        session.panel?.dispose();
      }
      sessions.clear();
    },
  };
}

function pathKey(cwd: string): string {
  // Stable per-process key; guard against non-string cwd.
  try {
    return path.resolve(String(cwd));
  } catch {
    return String(cwd);
  }
}
