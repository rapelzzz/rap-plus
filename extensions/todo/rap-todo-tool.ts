/**
 * Rap Todo System — model-callable `rap_todo` tool.
 *
 * This is the verified integration mechanism for AUTOMATIC planning: the model
 * authors high-quality plans by calling `action: "plan"`, guided by
 * `promptGuidelines` and the `before_agent_start` nudge for complex prompts.
 * As work progresses it calls `action: "update"` to keep statuses current.
 *
 * Execution is sequential so concurrent tool calls never race on todo state.
 */

import { StringEnum, Type } from "@earendil-works/pi-ai";
import type {
  AgentToolResult,
  ExtensionAPI,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";

import { renderRapTodoIcon } from "./ui/rap-todo-panel";
import {
  RAP_TODO_ICONS,
  rapTodoCounts,
  type RapTodoCounts,
  type RapTodoItem,
  type RapTodoStatus,
} from "./rap-todo-types";
import { RAP_TODO_TOOL_GUIDELINES } from "./rap-todo-planner";
import type { RapTodoFeatureDeps } from "./rap-todo-lifecycle";

export interface RapTodoToolDetails {
  action: "plan" | "update" | "list";
  todos: RapTodoItem[];
  counts: RapTodoCounts;
  error?: string;
}

const RapTodoParams = Type.Object({
  action: StringEnum(["plan", "update", "list"] as const, {
    description:
      'plan: create a task list for complex work. update: set a task status. list: read current todos.',
  }),
  tasks: Type.Optional(
    Type.Array(
      Type.Object({
        title: Type.String({ description: "Task title." }),
        dependencies: Type.Optional(
          Type.Array(Type.String(), {
            description: "Titles of tasks this one depends on (must be in the same plan).",
          }),
        ),
      }),
      { description: "Task list for action: plan." },
    ),
  ),
  id: Type.Optional(Type.String({ description: "Task ID for action: update." })),
  status: Type.Optional(
    StringEnum(["pending", "in_progress", "completed", "blocked"] as const, {
      description: "New status for action: update.",
    }),
  ),
});

function summarize(todos: RapTodoItem[]): string {
  if (todos.length === 0) return "No todos.";
  const counts = rapTodoCounts(todos);
  return todos
    .map((t) => `[${RAP_TODO_ICONS[t.status]}] #${t.id} ${t.title}`)
    .join("\n") + `\n${counts.completed}/${counts.total} completed`;
}

export function registerRapTodoTool(pi: ExtensionAPI, deps: RapTodoFeatureDeps): void {
  pi.registerTool({
    name: "rap_todo",
    label: "Todo",
    description:
      "Track complex, multi-step coding work with a todo list. Use action 'plan' to create a concise task list BEFORE implementing complex requests; action 'update' to move a task status as you work; action 'list' to read the current list. Do not use for trivial single-step changes.",
    promptSnippet: "track multi-step work with a plan and status updates",
    promptGuidelines: [...RAP_TODO_TOOL_GUIDELINES],
    exposure: "direct",
    executionMode: "sequential",
    parameters: RapTodoParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<
      AgentToolResult<RapTodoToolDetails>
    > {
      const session = deps.ensureSession(ctx.cwd);

      if (session.manager.isCorrupt()) {
        const error = session.manager.corruptError() ?? "todo data corrupt";
        return {
          isError: true,
          content: [{ type: "text", text: `Todo data is corrupt and was not modified. ${error}` }],
          details: { action: params.action, todos: [], counts: rapTodoCounts([]), error },
        };
      }

      const refresh = () => {
        try {
          deps.refreshPanel(ctx.ui, ctx.cwd);
        } catch {
          /* never fail a tool call because of a UI refresh */
        }
      };

      if (params.action === "list") {
        const todos = session.manager.getTodos();
        return {
          content: [{ type: "text", text: summarize(todos) }],
          details: { action: "list", todos: [...todos], counts: rapTodoCounts(todos) },
        };
      }

      if (params.action === "plan") {
        const tasks = params.tasks ?? [];
        if (tasks.length === 0) {
          return {
            isError: true,
            content: [{ type: "text", text: "plan requires a non-empty tasks array." }],
            details: {
              action: "plan",
              todos: session.manager.getTodos(),
              counts: session.manager.counts(),
              error: "empty plan",
            },
          };
        }
        const result = session.manager.planTasks(tasks, "automatic");
        if (!result.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: `Could not plan: ${result.error}` }],
            details: {
              action: "plan",
              todos: session.manager.getTodos(),
              counts: session.manager.counts(),
              error: result.error,
            },
          };
        }
        refresh();
        return {
          content: [{ type: "text", text: summarize(result.project.todos) }],
          details: {
            action: "plan",
            todos: [...result.project.todos],
            counts: rapTodoCounts(result.project.todos),
          },
        };
      }

      // action === "update"
      if (!params.id) {
        return {
          isError: true,
          content: [{ type: "text", text: "update requires an id." }],
          details: {
            action: "update",
            todos: session.manager.getTodos(),
            counts: session.manager.counts(),
            error: "missing id",
          },
        };
      }
      if (!params.status) {
        return {
          isError: true,
          content: [{ type: "text", text: "update requires a status." }],
          details: {
            action: "update",
            todos: session.manager.getTodos(),
            counts: session.manager.counts(),
            error: "missing status",
          },
        };
      }
      const result = session.manager.setStatus(params.id, params.status as RapTodoStatus);
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `Could not update: ${result.error}` }],
          details: {
            action: "update",
            todos: session.manager.getTodos(),
            counts: session.manager.counts(),
            error: result.error,
          },
        };
      }
      refresh();
      const item = session.manager.find(params.id);
      return {
        content: [
          { type: "text", text: `Task #${params.id} -> ${params.status}: ${item?.title ?? ""}` },
        ],
        details: {
          action: "update",
          todos: [...result.project.todos],
          counts: rapTodoCounts(result.project.todos),
        },
      };
    },

    renderCall(args, theme: Theme): Component {
      let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", args.action);
      if (args.id) text += ` ${theme.fg("accent", `#${args.id}`)}`;
      if (args.status) text += ` ${theme.fg("dim", args.status)}`;
      if (args.tasks) text += ` ${theme.fg("dim", `(${args.tasks.length} tasks)`)}`;
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme: Theme): Component {
      const details = result.details as RapTodoToolDetails | undefined;
      if (!details) {
        const c = result.content[0];
        return new Text(c?.type === "text" ? c.text : "", 0, 0);
      }
      if (details.error && details.todos.length === 0) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }
      const todos = details.todos;
      if (todos.length === 0) return new Text(theme.fg("dim", "No todos"), 0, 0);

      const counts = details.counts ?? rapTodoCounts(todos);
      let text = theme.fg("muted", `${counts.completed}/${counts.total}`);
      const display = expanded ? todos : todos.slice(0, 6);
      for (const t of display) {
        text += `\n${renderRapTodoIcon(t.status, theme)} ${theme.fg("accent", `#${t.id}`)} ${t.title}`;
      }
      if (!expanded && todos.length > display.length) {
        text += `\n${theme.fg("dim", `… ${todos.length - display.length} more`)}`;
      }
      return new Text(text, 0, 0);
    },
  });
}
