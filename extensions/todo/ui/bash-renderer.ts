/**
 * Custom bash tool renderer (full custom shell).
 *
 * Replaces pi's default green-background tool box for the `bash` tool with a
 * compact, themed card. Uses shared helpers from rap-tool-widget-types.
 *
 * Uses `renderShell: "self"` so we draw the whole shell. Execution of the bash
 * tool is untouched — only rendering is overridden via `registerToolRenderer`.
 *
 * CRITICAL: pi passes `{content, details}` to renderResult — NOT the full
 * result with `isError`. The `isError` flag is in `context.isError`.
 * `structuredContent` is also not passed; exit code is resolved from the
 * output text or `details`.
 */
import type { BashToolDetails, ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Container, Text, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import {
  formatDuration,
  formatMetaSuffix,
  getTextOutput,
  safeExpandHint,
  trimTrailingEmpty,
  type RapResultLike,
} from "./rap-tool-widget-types.ts";

type BashArgs = { command: string; timeout?: number };

/** Minimal details shape we need from BashToolDetails. */
interface BashDetailsLike {
  truncation?: { truncated?: boolean };
  exitCode?: number;
}

type BashResultLike = RapResultLike & {
  details?: BashDetailsLike | undefined;
};

const STATUS_LINE_RE =
  /^Command (exited with code \d+|timed out after \d+ seconds|aborted|terminated without an exit code)$/;

/** Visible-width-aware truncation with an ellipsis. */
function truncateCommand(cmd: string, max: number): string {
  if (visibleWidth(cmd) <= max) return cmd;
  return `${truncateToWidth(cmd, Math.max(1, max - 1))}…`;
}

/** Remove pi's trailing status line ("Command exited with code N", etc.). */
function stripTrailingStatus(text: string): string {
  if (!text) return "";
  const lines = text.split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const last = lines[lines.length - 1] ?? "";
  if (STATUS_LINE_RE.test(last)) {
    lines.pop();
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  }
  return lines.join("\n");
}

/**
 * Resolve exit code from details or output text.
 * pi passes {content, details} — structuredContent is NOT available.
 * Falls back to regex on the output text ("Command exited with code N").
 */
function resolveExitCode(
  result: BashResultLike,
  rawOutput: string,
): number | undefined {
  const detailsCode = (result.details as BashDetailsLike | undefined)?.exitCode;
  if (typeof detailsCode === "number") return detailsCode;
  const match = rawOutput.match(/Command exited with code (\d+)/);
  return match ? parseInt(match[1], 10) : undefined;
}

/** Format bash status badge: ✓ done / ✗ exit N. */
function formatBashStatus(
  isError: boolean,
  exitCode: number | undefined,
  theme: Theme,
): string {
  if (isError) {
    return `${theme.fg("error", "✗")}${theme.fg("error", ` exit ${exitCode ?? "?"}`)}`;
  }
  return theme.fg("success", "✓ done");
}

function renderBashCall(args: BashArgs, theme: Theme, padX: number): Component {
  const cmd = truncateCommand(args.command ?? "", 120);
  let text = `${theme.fg("accent", "❯ ")}${theme.fg("dim", "$ ")}${theme.fg("text", cmd)}`;
  if (typeof args.timeout === "number") {
    text += theme.fg("dim", `  (timeout ${args.timeout}s)`);
  }
  return new Text(text, padX, 0);
}

function renderBashResult(
  result: BashResultLike,
  options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
  padX: number,
  durationMs: number | undefined,
  isError: boolean,
): Component {
  if (options.isPartial) {
    return new Text(theme.fg("warning", "● running…"), padX, 0);
  }

  const rawOutput = getTextOutput(result);
  const exitCode = resolveExitCode(result, rawOutput);
  const cleanOutput = trimTrailingEmpty(stripTrailingStatus(rawOutput));
  const lineCount = cleanOutput.length ? cleanOutput.split("\n").length : 0;

  // Status line: badge + line count + duration + truncation note.
  const lineLabel = `${lineCount} line${lineCount === 1 ? "" : "s"}`;
  const dur = formatDuration(durationMs);
  const truncNote =
    (result.details as BashDetailsLike | undefined)?.truncation?.truncated
      ? "[truncated]"
      : undefined;
  let status =
    formatBashStatus(isError, exitCode, theme) +
    formatMetaSuffix([lineLabel, dur, truncNote], theme);

  // Collapsed (or empty output): a single status line.
  if (!options.expanded || lineCount === 0) {
    let line = status;
    if (lineCount === 0 && !isError) {
      line += theme.fg("dim", "  ·  no output");
    } else if (lineCount > 0 && !options.expanded) {
      line += theme.fg("dim", `  …  ${safeExpandHint(theme)}`);
    }
    return new Text(line, padX, 0);
  }

  // Expanded: status line, then the output inside a subtle dark panel.
  const container = new Container();
  container.addChild(new Text(status, padX, 0));
  const panel = new Box(padX, 0, (text) => theme.bg("toolPendingBg", text));
  panel.addChild(new Text(cleanOutput, 0, 0));
  container.addChild(panel);
  return container;
}

/** Register the custom bash tool renderer. Non-destructive: execution unchanged. */
export function registerBashToolRenderer(pi: ExtensionAPI): void {
  pi.registerToolRenderer((toolName, next) => {
    if (toolName !== "bash") return next();
    return {
      renderShell: "self",
      renderCall(args, theme, context) {
        return renderBashCall(args as unknown as BashArgs, theme, context.outputPad);
      },
      renderResult(result, options, theme, context) {
        // CRITICAL: pi passes {content, details} — isError is in context.isError
        return renderBashResult(
          result as unknown as BashResultLike,
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
