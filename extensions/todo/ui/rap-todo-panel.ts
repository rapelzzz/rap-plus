/**
 * Rap Todo System — compact panel widget rendered above the prompt editor.
 *
 * Visible only while at least one task is unfinished. When every task is
 * completed the widget is removed entirely (no reserved space).
 *
 * Rendering rules:
 *  - Icon glyph + status color applied to the icon ONLY.
 *  - Task titles always use the normal foreground (no color).
 *  - No textual status labels ("done", "pending", ...) beside icons.
 *  - Compact: one header line + one line per task.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import {
  RAP_TODO_ICONS,
  RAP_TODO_ICON_COLOR,
  rapTodoCounts,
  type RapTodoItem,
  type RapTodoStatus,
} from "../rap-todo-types.ts";

export interface RapTodoPanelComponent {
  setTodos(todos: RapTodoItem[], theme: Theme): void;
  invalidate(): void;
  render(width: number): string[];
  dispose(): void;
}

/** Render a single status icon with its color applied to the icon only. */
export function renderRapTodoIcon(status: RapTodoStatus, theme: Theme): string {
  const glyph = RAP_TODO_ICONS[status];
  const role = RAP_TODO_ICON_COLOR[status];
  return role ? theme.fg(role, glyph) : glyph;
}

export function createRapTodoPanelComponent(
  todos: RapTodoItem[],
  theme: Theme,
): RapTodoPanelComponent {
  let currentTodos: RapTodoItem[] = todos;
  let currentTheme: Theme = theme;
  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;

  const invalidate = (): void => {
    cachedWidth = undefined;
    cachedLines = undefined;
  };

  const setTodos = (todos: RapTodoItem[], theme: Theme): void => {
    currentTodos = todos;
    currentTheme = theme;
    invalidate();
  };

  const render = (width: number): string[] => {
    if (currentTodos.length === 0) return [];
    if (cachedLines && cachedWidth === width) return cachedLines;

    const th = currentTheme;
    const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
    const counts = rapTodoCounts(currentTodos);

    const lines: string[] = [];
    // Header: "Todo" + progress count "2/5". No status labels.
    const headerLabel = th.fg("accent", th.bold("Todo"));
    const progress = th.fg("muted", `  ${counts.completed}/${counts.total}`);
    const header = `${headerLabel}${progress}`;
    lines.push(truncateToWidth(header, safeWidth));

    for (const item of currentTodos) {
      const icon = renderRapTodoIcon(item.status, th);
      // Title: normal foreground (plain text, no color), per spec.
      const title = item.title;
      const prefix = `  ${icon} `;
      const prefixWidth = 2 + visibleWidth(RAP_TODO_ICONS[item.status]) + 1;
      const titleMax = Math.max(1, safeWidth - prefixWidth);
      const truncatedTitle = visibleWidth(title) > titleMax
        ? `${truncateToWidth(title, Math.max(1, titleMax - 1))}…`
        : title;
      lines.push(truncateToWidth(`${prefix}${truncatedTitle}`, safeWidth));
    }

    cachedWidth = safeWidth;
    cachedLines = lines;
    return lines;
  };

  const dispose = (): void => {
    currentTodos = [];
    cachedLines = undefined;
    cachedWidth = undefined;
  };

  return { setTodos, invalidate, render, dispose };
}
