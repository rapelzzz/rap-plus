/**
 * RAP tool widget renderer — unified registration for all built-in tools.
 *
 * Registers a single `ToolRendererResolver` that provides consistent,
 * compact widget-style rendering for:
 *   - bash   (full custom shell via bash-renderer.ts)
 *   - write  (icon + path + content preview + status badge)
 *   - edit   (icon + path + diff + status badge)
 *   - read   (icon + path + line range + content + status badge)
 *   - grep   (icon + pattern + path + matches + status badge)
 *   - find   (icon + pattern + path + results + status badge)
 *   - ls     (icon + path + listing + status badge)
 *
 * ALL tools use `renderShell: "self"` — this removes pi's default colored Box
 * (green/red/blue background) and gives us full control over the visual shell.
 *
 * CRITICAL: pi passes `{content, details}` as the first arg to `renderResult` —
 * NOT the full result with `isError`. The `isError` flag lives in
 * `context.isError`, and `durationMs` in `context.durationMs`. Both are read
 * from the context, never from the result object.
 */
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text, type Component } from "@earendil-works/pi-tui";
import { registerBashToolRenderer } from "./bash-renderer.ts";
import {
  RAP_TOOL_ICONS,
  countLines,
  formatDuration,
  formatMetaSuffix,
  formatStatusBadge,
  getTextOutput,
  safeExpandHint,
  shortenPath,
  str,
  trimTrailingEmpty,
  type RapResultLike,
} from "./rap-tool-widget-types.ts";

// ─── Shared rendering helpers ──────────────────────────────────────────────

/** Build a tool call header: `icon  toolName  detail`. */
function toolHeader(
  tool: keyof typeof RAP_TOOL_ICONS,
  detail: string,
  theme: Theme,
  padX: number,
): Component {
  const icon = theme.fg("accent", RAP_TOOL_ICONS[tool]);
  const name = theme.fg("toolTitle", theme.bold(tool));
  const text = `${icon}  ${name}  ${theme.fg("text", detail)}`;
  return new Text(text, padX, 0);
}

/** Build the result status line: badge + metadata suffix. */
function statusLine(
  isError: boolean,
  theme: Theme,
  segments: Array<string | undefined>,
  padX: number,
): Component {
  const badge = formatStatusBadge(isError, theme);
  const suffix = formatMetaSuffix(segments, theme);
  return new Text(`${badge}${suffix}`, padX, 0);
}

/** Render output content lines, truncated when collapsed. */
function renderOutput(
  text: string,
  expanded: boolean,
  theme: Theme,
  padX: number,
  maxCollapsed = 15,
): { component: Component; lineCount: number; remaining: number } {
  const clean = trimTrailingEmpty(text);
  if (!clean) {
    return { component: new Text("", padX, 0), lineCount: 0, remaining: 0 };
  }
  const lines = clean.split("\n");
  const lineCount = lines.length;
  const maxLines = expanded ? lines.length : maxCollapsed;
  const displayLines = lines.slice(0, maxLines);
  const remaining = lines.length - maxLines;

  const container = new Container();
  for (const line of displayLines) {
    container.addChild(new Text(theme.fg("toolOutput", line), padX, 0));
  }
  if (remaining > 0 && !expanded) {
    const more = theme.fg(
      "muted",
      `... (${remaining} more lines, ${lineCount} total, ${safeExpandHint(theme)})`,
    );
    container.addChild(new Text(more, padX, 0));
  }
  return { component: container, lineCount, remaining };
}

// ─── Write renderer ──────────────────────────────────────────────────────────

function writeCall(args: unknown, theme: Theme, padX: number): Component {
  const rawPath =
    str((args as Record<string, unknown>)?.file_path) ??
    str((args as Record<string, unknown>)?.path) ??
    "";
  return toolHeader("write", shortenPath(rawPath), theme, padX);
}

function writeResult(
  result: RapResultLike,
  options: { expanded: boolean },
  theme: Theme,
  padX: number,
  durationMs: number | undefined,
  isError: boolean,
): Component {
  const output = getTextOutput(result);

  // On success with no output, just show the status badge.
  if (!isError && !output.trim()) {
    return statusLine(false, theme, ["written", formatDuration(durationMs)], padX);
  }

  // On error, show the error text.
  if (isError) {
    const container = new Container();
    container.addChild(statusLine(true, theme, [formatDuration(durationMs)], padX));
    if (output.trim()) {
      container.addChild(new Text(theme.fg("error", trimTrailingEmpty(output)), padX, 0));
    }
    return container;
  }

  // Success with output (rare for write, but handle it).
  return statusLine(false, theme, [formatDuration(durationMs)], padX);
}

// ─── Edit renderer ───────────────────────────────────────────────────────────

function editCall(args: unknown, theme: Theme, padX: number): Component {
  const rawPath =
    str((args as Record<string, unknown>)?.file_path) ??
    str((args as Record<string, unknown>)?.path) ??
    "";
  return toolHeader("edit", shortenPath(rawPath), theme, padX);
}

function editResult(
  result: RapResultLike,
  options: { expanded: boolean },
  theme: Theme,
  padX: number,
  durationMs: number | undefined,
  isError: boolean,
): Component {
  const output = getTextOutput(result);

  const container = new Container();
  const label = isError ? undefined : "edited";
  container.addChild(statusLine(isError, theme, [label, formatDuration(durationMs)], padX));

  if (output.trim()) {
    const { component } = renderOutput(output, options.expanded, theme, padX, 10);
    container.addChild(component);
  }
  return container;
}

// ─── Read renderer ───────────────────────────────────────────────────────────

function readCall(args: unknown, theme: Theme, padX: number): Component {
  const rawPath =
    str((args as Record<string, unknown>)?.file_path) ??
    str((args as Record<string, unknown>)?.path) ??
    "";
  const offset = (args as Record<string, unknown>)?.offset;
  const limit = (args as Record<string, unknown>)?.limit;
  let detail = shortenPath(rawPath);
  if (typeof offset === "number" || typeof limit === "number") {
    const parts: string[] = [];
    if (typeof offset === "number") parts.push(`offset ${offset}`);
    if (typeof limit === "number") parts.push(`limit ${limit}`);
    detail += `  (${parts.join(", ")})`;
  }
  return toolHeader("read", detail, theme, padX);
}

function readResult(
  result: RapResultLike,
  options: { expanded: boolean },
  theme: Theme,
  padX: number,
  durationMs: number | undefined,
  isError: boolean,
): Component {
  const output = getTextOutput(result);
  const cleanOutput = trimTrailingEmpty(output);
  const lineCount = countLines(cleanOutput);

  const container = new Container();
  const label = isError ? undefined : `${lineCount} line${lineCount === 1 ? "" : "s"}`;
  container.addChild(statusLine(isError, theme, [label, formatDuration(durationMs)], padX));

  if (cleanOutput) {
    const { component } = renderOutput(output, options.expanded, theme, padX, 15);
    container.addChild(component);
  }
  return container;
}

// ─── Grep renderer ───────────────────────────────────────────────────────────

function grepCall(args: unknown, theme: Theme, padX: number): Component {
  const pattern = str((args as Record<string, unknown>)?.pattern) ?? "";
  const rawPath = str((args as Record<string, unknown>)?.path) ?? ".";
  const glob = str((args as Record<string, unknown>)?.glob);
  let detail = `/${pattern || ""}/  in ${shortenPath(rawPath)}`;
  if (glob) detail += `  (${glob})`;
  return toolHeader("grep", detail, theme, padX);
}

function grepResult(
  result: RapResultLike,
  options: { expanded: boolean },
  theme: Theme,
  padX: number,
  durationMs: number | undefined,
  isError: boolean,
): Component {
  const output = getTextOutput(result);
  const cleanOutput = trimTrailingEmpty(output);
  const lineCount = countLines(cleanOutput);

  const container = new Container();
  const label = isError ? undefined : `${lineCount} match${lineCount === 1 ? "" : "es"}`;
  container.addChild(statusLine(isError, theme, [label, formatDuration(durationMs)], padX));

  if (cleanOutput) {
    const { component } = renderOutput(output, options.expanded, theme, padX, 15);
    container.addChild(component);
  } else if (!isError) {
    container.addChild(new Text(theme.fg("dim", "no matches"), padX, 0));
  }
  return container;
}

// ─── Find renderer ───────────────────────────────────────────────────────────

function findCall(args: unknown, theme: Theme, padX: number): Component {
  const pattern =
    str((args as Record<string, unknown>)?.pattern) ??
    str((args as Record<string, unknown>)?.name_pattern) ??
    "";
  const rawPath = str((args as Record<string, unknown>)?.path) ?? ".";
  const detail = pattern
    ? `${pattern}  in ${shortenPath(rawPath)}`
    : shortenPath(rawPath);
  return toolHeader("find", detail, theme, padX);
}

function findResult(
  result: RapResultLike,
  options: { expanded: boolean },
  theme: Theme,
  padX: number,
  durationMs: number | undefined,
  isError: boolean,
): Component {
  const output = getTextOutput(result);
  const cleanOutput = trimTrailingEmpty(output);
  const lineCount = countLines(cleanOutput);

  const container = new Container();
  const label = isError ? undefined : `${lineCount} result${lineCount === 1 ? "" : "s"}`;
  container.addChild(statusLine(isError, theme, [label, formatDuration(durationMs)], padX));

  if (cleanOutput) {
    const { component } = renderOutput(output, options.expanded, theme, padX, 15);
    container.addChild(component);
  } else if (!isError) {
    container.addChild(new Text(theme.fg("dim", "no results"), padX, 0));
  }
  return container;
}

// ─── Ls renderer ─────────────────────────────────────────────────────────────

function lsCall(args: unknown, theme: Theme, padX: number): Component {
  const rawPath = str((args as Record<string, unknown>)?.path) ?? ".";
  return toolHeader("ls", shortenPath(rawPath), theme, padX);
}

function lsResult(
  result: RapResultLike,
  options: { expanded: boolean },
  theme: Theme,
  padX: number,
  durationMs: number | undefined,
  isError: boolean,
): Component {
  const output = getTextOutput(result);
  const cleanOutput = trimTrailingEmpty(output);
  const lineCount = countLines(cleanOutput);

  const container = new Container();
  const label = isError ? undefined : `${lineCount} entr${lineCount === 1 ? "y" : "ies"}`;
  container.addChild(statusLine(isError, theme, [label, formatDuration(durationMs)], padX));

  if (cleanOutput) {
    const { component } = renderOutput(output, options.expanded, theme, padX, 15);
    container.addChild(component);
  }
  return container;
}

// ─── Registration ────────────────────────────────────────────────────────────

/**
 * Tool renderers keyed by tool name.
 * Each entry uses `renderShell: "self"` to bypass pi's default colored Box.
 */
const FILE_TOOL_RENDERERS: Record<
  string,
  {
    call: (args: unknown, theme: Theme, padX: number) => Component;
    result: (
      result: RapResultLike,
      options: { expanded: boolean },
      theme: Theme,
      padX: number,
      durationMs: number | undefined,
      isError: boolean,
    ) => Component;
  }
> = {
  write: { call: writeCall, result: writeResult },
  edit: { call: editCall, result: editResult },
  read: { call: readCall, result: readResult },
  grep: { call: grepCall, result: grepResult },
  find: { call: findCall, result: findResult },
  ls: { call: lsCall, result: lsResult },
};

/**
 * Register the RAP tool widget renderers for all built-in tools.
 *
 * ALL tools use `renderShell: "self"` to bypass pi's default colored Box and
 * draw their own compact widget shells.
 *
 * This calls `registerBashToolRenderer` internally — callers should NOT call it
 * separately.
 */
export function registerRapToolWidgetRenderer(pi: ExtensionAPI): void {
  // Bash: full custom shell (delegates to bash-renderer.ts).
  registerBashToolRenderer(pi);

  // File tools: custom shell, call + result widgets.
  pi.registerToolRenderer((toolName, next) => {
    const entry = FILE_TOOL_RENDERERS[toolName];
    if (!entry) return next();

    return {
      renderShell: "self",
      renderCall(args, theme, context) {
        return entry.call(args, theme, context.outputPad);
      },
      renderResult(result, options, theme, context) {
        // CRITICAL: pi passes {content, details} — isError is in context.isError
        return entry.result(
          result as unknown as RapResultLike,
          options,
          theme,
          context.outputPad,
          context.durationMs,
          context.isError,
        );
      },
    };
  });
}
