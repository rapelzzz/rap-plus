/**
 * Rap Todo System — slash commands.
 *
 *   /todo                       Refresh/show the compact panel.
 *   /todo list                  Full overlay list (all records incl. completed; works when hidden).
 *   /todo add <task>            Create a manual todo.
 *   /todo check <id>            Mark completed.
 *   /todo uncheck <id>          Reopen as pending.
 *   /todo edit <id> <title>     Edit a title.
 *   /todo remove <id>           Remove (warns + confirms when dependents exist).
 *   /todo resume                Resume unfinished work (marks next task in progress).
 *   /todo clear-completed       Delete completed records (with confirmation).
 *   /todo clear                 Delete ALL todos, completed + unfinished (with confirmation).
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { renderRapTodoIcon } from "./ui/rap-todo-panel.ts";
import {
  RAP_TODO_ICONS,
  rapTodoCounts,
  type RapTodoItem,
} from "./rap-todo-types.ts";
import type { RapTodoFeatureDeps } from "./rap-todo-lifecycle.ts";

const LIST_WINDOW = 16;

/** Full-screen overlay listing every todo (including completed). */
class RapTodoListOverlay implements Component {
  private todos: RapTodoItem[];
  private theme: Theme;
  private onClose: () => void;
  private offset = 0;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  constructor(todos: RapTodoItem[], theme: Theme, onClose: () => void) {
    this.todos = todos;
    this.theme = theme;
    this.onClose = onClose;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") {
      this.onClose();
      return;
    }
    const max = Math.max(0, this.todos.length - LIST_WINDOW);
    if (matchesKey(data, "down") || data === "j") {
      this.offset = Math.min(max, this.offset + 1);
      this.invalidate();
    } else if (matchesKey(data, "up") || data === "k") {
      this.offset = Math.max(0, this.offset - 1);
      this.invalidate();
    } else if (matchesKey(data, "pageDown")) {
      this.offset = Math.min(max, this.offset + LIST_WINDOW);
      this.invalidate();
    } else if (matchesKey(data, "pageUp")) {
      this.offset = Math.max(0, this.offset - LIST_WINDOW);
      this.invalidate();
    } else if (matchesKey(data, "end")) {
      this.offset = max;
      this.invalidate();
    } else if (matchesKey(data, "home")) {
      this.offset = 0;
      this.invalidate();
    }
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    const th = this.theme;
    const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
    const counts = rapTodoCounts(this.todos);
    const lines: string[] = [];

    lines.push("");
    const title = th.fg("accent", " Todos ");
    const header = th.fg("borderMuted", "─".repeat(3)) + title +
      th.fg("borderMuted", "─".repeat(Math.max(0, safeWidth - 11)));
    lines.push(truncateToWidth(header, safeWidth));
    lines.push("");

    if (this.todos.length === 0) {
      lines.push(truncateToWidth(`  ${th.fg("dim", "No todo records for this project.")}`, safeWidth));
    } else {
      lines.push(
        truncateToWidth(
          `  ${th.fg("muted", `${counts.completed}/${counts.total} completed · ${counts.unfinished} unfinished`)}`,
          safeWidth,
        ),
      );
      lines.push("");
      const start = this.offset;
      const end = Math.min(this.todos.length, start + LIST_WINDOW);
      for (let i = start; i < end; i++) {
        const t = this.todos[i];
        const icon = renderRapTodoIcon(t.status, th);
        const id = th.fg("accent", `#${t.id}`);
        const depNote =
          t.dependencies.length > 0 ? th.fg("dim", ` (needs #${t.dependencies.join(", #")})`) : "";
        // Title: normal foreground (plain), per spec.
        const line = `  ${icon} ${id} ${t.title}${depNote}`;
        lines.push(truncateToWidth(line, safeWidth));
      }
      if (this.todos.length > LIST_WINDOW) {
        lines.push("");
        lines.push(
          truncateToWidth(
            `  ${th.fg("dim", `↑/↓ scroll · showing ${start + 1}-${end} of ${this.todos.length}`)}`,
            safeWidth,
          ),
        );
      }
    }

    lines.push("");
    lines.push(truncateToWidth(`  ${th.fg("dim", "Esc to close")}`, safeWidth));
    lines.push("");

    this.cachedWidth = safeWidth;
    this.cachedLines = lines;
    return lines;
  }

  dispose(): void {
    this.todos = [];
    this.cachedLines = undefined;
  }
}

function notifyResult(ctx: ExtensionCommandContext, ok: boolean, message: string): void {
  if (ctx.hasUI) ctx.ui.notify(message, ok ? "info" : "error");
  else console.log(`${ok ? "" : "error: "}${message}`);
}

export function registerRapTodoCommands(pi: ExtensionAPI, deps: RapTodoFeatureDeps): void {
  pi.registerCommand("rap-todo", {
    description:
      "Rap Todo system. Subcommands: list, add <task>, check <id>, uncheck <id>, edit <id> <title>, remove <id>, resume, clear-completed, clear.",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const trimmed = args.trim();
      const spaceIdx = trimmed.indexOf(" ");
      const sub = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
      const rest = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

      const session = deps.ensureSession(ctx.cwd);

      // Corrupt data is never silently destroyed: refuse mutations (and any
      // operation) so the original file is preserved for recovery.
      if (session.manager.isCorrupt()) {
        notifyResult(
          ctx,
          false,
          `Todo data is corrupt and was not modified. ${(session.manager.corruptError() ?? "").trim()}`,
        );
        return;
      }

      // No subcommand: refresh/show the compact panel.
      if (sub === "" ) {
        if (ctx.mode === "tui" && ctx.hasUI) {
          deps.refreshPanel(ctx.ui, ctx.cwd);
          if (!session.manager.hasUnfinished()) {
            notifyResult(
              ctx,
              true,
              session.manager.getTodos().length === 0
                ? "No todos yet. Use /todo add <task>."
                : "All todos completed.",
            );
          }
        } else {
          notifyResult(ctx, true, summarizeForNotify(session.manager.getTodos()));
        }
        return;
      }

      switch (sub) {
        case "list": {
          if (ctx.mode !== "tui" || !ctx.hasUI) {
            notifyResult(ctx, true, summarizeForNotify(session.manager.getTodos()));
            return;
          }
          await ctx.ui.custom<void>((_tui: TUI, theme: Theme, _kb: KeybindingsManager, done) => {
            return new RapTodoListOverlay(session.manager.getTodos(), theme, () => done());
          });
          return;
        }

        case "add": {
          if (rest.length === 0) {
            notifyResult(ctx, false, "Usage: /rap-todo add <task>");
            return;
          }
          const res = session.manager.add(rest, "manual");
          if (!res.ok) {
            notifyResult(ctx, false, res.error);
            return;
          }
          if (ctx.mode === "tui" && ctx.hasUI) deps.refreshPanel(ctx.ui, ctx.cwd);
          const added = res.project.todos[res.project.todos.length - 1];
          notifyResult(ctx, true, `Added #${added.id}: ${added.title}`);
          return;
        }

        case "check": {
          if (rest.length === 0) {
            notifyResult(ctx, false, "Usage: /rap-todo check <id>");
            return;
          }
          const res = session.manager.check(rest);
          if (!res.ok) {
            notifyResult(ctx, false, res.error);
            return;
          }
          if (ctx.mode === "tui" && ctx.hasUI) deps.refreshPanel(ctx.ui, ctx.cwd);
          notifyResult(ctx, true, `Completed #${rest}`);
          return;
        }

        case "uncheck": {
          if (rest.length === 0) {
            notifyResult(ctx, false, "Usage: /rap-todo uncheck <id>");
            return;
          }
          const res = session.manager.uncheck(rest);
          if (!res.ok) {
            notifyResult(ctx, false, res.error);
            return;
          }
          if (ctx.mode === "tui" && ctx.hasUI) deps.refreshPanel(ctx.ui, ctx.cwd);
          notifyResult(ctx, true, `Reopened #${rest} as pending`);
          return;
        }

        case "edit": {
          const sp = rest.indexOf(" ");
          const id = sp === -1 ? rest : rest.slice(0, sp);
          const title = sp === -1 ? "" : rest.slice(sp + 1).trim();
          if (!id || title.length === 0) {
            notifyResult(ctx, false, "Usage: /rap-todo edit <id> <new title>");
            return;
          }
          const res = session.manager.edit(id, title);
          if (!res.ok) {
            notifyResult(ctx, false, res.error);
            return;
          }
          if (ctx.mode === "tui" && ctx.hasUI) deps.refreshPanel(ctx.ui, ctx.cwd);
          notifyResult(ctx, true, `Edited #${id}`);
          return;
        }

        case "remove": {
          if (rest.length === 0) {
            notifyResult(ctx, false, "Usage: /rap-todo remove <id>");
            return;
          }
          // Warn about dependents and confirm when present.
          const before = session.manager.find(rest);
          if (!before) {
            notifyResult(ctx, false, `Task ${rest} not found`);
            return;
          }
          const dependents = session.manager
            .getTodos()
            .filter((t) => t.dependencies.includes(rest))
            .map((t) => `#${t.id} (${t.title})`);
          if (dependents.length > 0 && ctx.hasUI) {
            const ok = await ctx.ui.confirm(
              "Remove task?",
              `#${rest} "${before.title}" is depended on by: ${dependents.join(", ")}. Their dependency on it will be removed. Continue?`,
            );
            if (!ok) {
              notifyResult(ctx, true, "Cancelled.");
              return;
            }
          }
          const res = session.manager.remove(rest);
          if (!res.ok) {
            notifyResult(ctx, false, res.error);
            return;
          }
          if (ctx.mode === "tui" && ctx.hasUI) deps.refreshPanel(ctx.ui, ctx.cwd);
          notifyResult(ctx, true, `Removed #${rest}`);
          return;
        }

        case "resume": {
          if (!session.manager.hasUnfinished()) {
            notifyResult(ctx, true, "No unfinished tasks to resume.");
            return;
          }
          const res = session.manager.resumeNext();
          if (!res.ok) {
            notifyResult(ctx, false, res.error);
            return;
          }
          if (ctx.mode === "tui" && ctx.hasUI) deps.refreshPanel(ctx.ui, ctx.cwd);
          const id = (res as { resumedId?: string }).resumedId;
          const task = id ? session.manager.find(id) : undefined;
          notifyResult(
            ctx,
            true,
            task ? `Resuming #${task.id}: ${task.title}` : "Resumed unfinished work.",
          );
          return;
        }

        case "clear-completed": {
          if (ctx.hasUI) {
            const ok = await ctx.ui.confirm(
              "Clear completed todos?",
              "This permanently removes completed records. Unfinished tasks are kept.",
            );
            if (!ok) {
              notifyResult(ctx, true, "Cancelled.");
              return;
            }
          }
          const res = session.manager.clearCompleted();
          if (!res.ok) {
            notifyResult(ctx, false, res.error);
            return;
          }
          if (ctx.mode === "tui" && ctx.hasUI) deps.refreshPanel(ctx.ui, ctx.cwd);
          notifyResult(ctx, true, `Cleared ${(res as { removed: number }).removed} completed todo(s).`);
          return;
        }

        case "clear": {
          if (ctx.hasUI) {
            const ok = await ctx.ui.confirm(
              "Clear ALL todos?",
              "This permanently removes every todo (completed + unfinished) for this project.",
            );
            if (!ok) {
              notifyResult(ctx, true, "Cancelled.");
              return;
            }
          }
          const res = session.manager.clearAll();
          if (!res.ok) {
            notifyResult(ctx, false, res.error);
            return;
          }
          if (ctx.mode === "tui" && ctx.hasUI) deps.refreshPanel(ctx.ui, ctx.cwd);
          notifyResult(ctx, true, `Cleared all ${(res as { removed: number }).removed} todo(s).`);
          return;
        }

        default:
          notifyResult(ctx, false, `Unknown subcommand "${sub}". Try: list, add, check, uncheck, edit, remove, resume, clear-completed, clear.`);
      }
    },
  });
}

function summarizeForNotify(todos: RapTodoItem[]): string {
  if (todos.length === 0) return "No todo records for this project.";
  const counts = rapTodoCounts(todos);
  return todos
    .map((t) => `${RAP_TODO_ICONS[t.status]} #${t.id} ${t.title}`)
    .join("\n") + `\n${counts.completed}/${counts.total} completed`;
}
