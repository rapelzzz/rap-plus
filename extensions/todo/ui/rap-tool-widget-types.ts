/**
 * Shared types and helpers for the RAP tool widget renderer system.
 *
 * Provides reusable formatting utilities (status badges, durations, paths, line
 * counts) consumed by tool-specific renderers (bash, write, edit, read, grep,
 * find). Keeps rendering logic DRY across all tool widgets.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";

/** Tool names the widget system renders. */
export type RapWidgetToolName =
  | "bash"
  | "write"
  | "edit"
  | "read"
  | "grep"
  | "find"
  | "ls";

/** Minimal result shape — avoids importing heavy internal types. */
export interface RapResultLike {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
  details?: unknown;
  structuredContent?: unknown;
}

/** Render options passed through from ToolRenderContext. */
export interface RapRenderOptions {
  expanded: boolean;
  isPartial: boolean;
  isError: boolean;
}

/**
 * Material Design Nerd Font icons for tool widgets.
 * Outlined style, consistent with the lucide icon mode.
 */
export const RAP_TOOL_ICONS: Record<RapWidgetToolName, string> = {
  bash: "\ue7c2", // md-console
  write: "\ue255", // md-pencil (create/write)
  edit: "\ue3c9", // md-square-edit-outline
  read: "\ue565", // md-file-eye-outline
  grep: "\ue6d4", // md-magnify-scan
  find: "\ue611", // md-folder-search-outline
  ls: "\ue7fd", // md-format-list-bulleted
};

/** Format milliseconds as a compact duration string. */
export function formatDuration(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}

/** Safe string extraction: returns null for non-strings. */
export function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Status badge for a completed tool call.
 * Success: green ✓. Error: red ✗ with optional code/label.
 */
export function formatStatusBadge(
  isError: boolean,
  theme: Theme,
  errorLabel?: string,
): string {
  if (isError) {
    const label = errorLabel ? ` ${errorLabel}` : "";
    return `${theme.fg("error", "✗")}${theme.fg("error", label)}`;
  }
  return theme.fg("success", "✓");
}

/** Count non-empty lines in text output. */
export function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

/**
 * Extract the first text content block from a tool result.
 * Returns the raw text string (may be empty).
 */
export function getTextOutput(result: RapResultLike): string {
  const block = result.content?.find((c) => c.type === "text");
  return block?.text ?? "";
}

/** Trim trailing empty/whitespace-only lines. */
export function trimTrailingEmpty(text: string): string {
  if (!text) return "";
  const lines = text.split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  return lines.join("\n");
}

/**
 * Format a metadata suffix: `·  N lines  ·  1.2s`.
 * Omits empty segments.
 */
export function formatMetaSuffix(
  segments: Array<string | undefined>,
  theme: Theme,
): string {
  const parts = segments.filter((s): s is string => !!s && s.length > 0);
  if (parts.length === 0) return "";
  return theme.fg("dim", `  ·  ${parts.join("  ·  ")}`);
}

/** Shorten a file path for display: replace home with ~, use basename if long. */
export function shortenPath(path: string): string {
  if (!path) return ".";
  const home = process.env.HOME ?? "";
  if (home && path.startsWith(home)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

/**
 * Safe expand hint that does NOT depend on the global theme singleton.
 *
 * pi's `keyHint()` helper reads the module-level `theme` Proxy, which throws
 * "Theme not initialized" if `initTheme()` hasn't run. In the live TUI this is
 * always initialized, but the renderer can be invoked during session restore
 * or in tests before theme setup. This helper uses the `theme` parameter
 * passed by the renderer and falls back to plain text on any error.
 */
export function safeExpandHint(theme: Theme): string {
  let keyLabel = "ctrl+o";
  try {
    const keys = getKeybindings().getKeys("app.tools.expand");
    if (keys && keys.length > 0) {
      keyLabel = keys.join("/");
    }
  } catch {
    // getKeybindings not initialized — use default
  }
  try {
    return `${theme.fg("dim", keyLabel)} ${theme.fg("muted", "to expand")}`;
  } catch {
    return `${keyLabel} to expand`;
  }
}
