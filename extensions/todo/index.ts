/**
 * RAP Todo + Widget Renderer Extension — entry point.
 *
 * This is a standalone Pi extension that owns:
 *  - The RAP Todo System (compact panel, /todo commands, rap_todo tool,
 *    per-project persistence, lifecycle hooks, auto-planning).
 *  - The RAP Widget Renderer system (shared tool-output widgets for bash,
 *    write, edit, read, grep/search, and test operations).
 *  - Shared UI primitives (icons, theme-palette, ui-primitives, frame-layout)
 *    reused by both this extension and the rap-bluemon extension.
 *
 * Loaded once by Pi as `./extensions/todo` (see package.json `pi.extensions`).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerRapTodoFeature } from "./rap-todo-index";
import { registerRapToolWidgetRenderer } from "./ui/rap-tool-widget-renderer";

export default function registerRapTodoExtension(pi: ExtensionAPI): void {
  // RAP Todo System: compact panel + /todo commands + model-callable rap_todo tool.
  registerRapTodoFeature(pi);

  // RAP Widget Renderer: unified tool-output widgets (bash, write, edit, read, grep, test).
  // registerRapToolWidgetRenderer internally registers the bash renderer as part
  // of the unified system, so registerBashToolRenderer is NOT called separately.
  registerRapToolWidgetRenderer(pi);
}

export { registerRapTodoExtension };
