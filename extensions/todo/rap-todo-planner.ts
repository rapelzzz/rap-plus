/**
 * Rap Todo System — automatic planning heuristics.
 *
 * Decides whether a user request warrants a Todo plan. Used by the
 * `before_agent_start` hook to inject a "plan now" guideline only for complex
 * prompts, so trivial changes never trigger planning.
 *
 * This is a heuristic gate; the actual plan is authored by the model via the
 * `rap_todo` tool (high-quality breakdown). The heuristic only decides WHEN.
 */

import type { RapTodoManager } from "./rap-todo-manager.ts";

const COMPLEX_KEYWORDS: readonly RegExp[] = [
  /\brefactor(ing)?\b/i,
  /\brewrite\b/i,
  /\bmigrat(e|ion)\b/i,
  /\barchitect(ure|ing)?\b/i,
  /\bimplement(ing|ation)?\b/i,
  /\bintegrat(e|ion|ing)\b/i,
  /\bend[\s-]?to[\s-]?end\b/i,
  /\be2e\b/i,
  /\boverhaul\b/i,
  /\brestructure\b/i,
  /\bdecouple\b/i,
  /\bextract\b/i,
  /\bunify\b/i,
];

const SEQUENCING_PATTERNS: readonly RegExp[] = [
  /\bthen\b.*\bafter\b/i,
  /\bfirst\b.*\bthen\b/i,
  /\bstep[\s-]?by[\s-]?step\b/i,
  /\bafter that\b/i,
  /\bnext,?\s+(?:we|I|you)\b/i,
];

const FILE_REF = /(?:^|[\s/])([\w-]+\/[\w-]+\.(?:ts|js|tsx|jsx|py|go|rs|java|rb|php|c|cpp|h|md|json|yaml|yml|toml))/g;
const NUMBERED_LIST = /(?:^|\n)\s*\d+[.)]\s+\S/;

/** True when a prompt looks like complex, multi-step coding work. */
export function isComplexRapTodoRequest(prompt: string): boolean {
  const text = prompt ?? "";
  if (text.trim().length === 0) return false;

  // Long prompts usually describe non-trivial work.
  if (text.length > 160) return true;

  for (const re of COMPLEX_KEYWORDS) if (re.test(text)) return true;
  for (const re of SEQUENCING_PATTERNS) if (re.test(text)) return true;
  if (NUMBERED_LIST.test(text)) return true;

  // Multiple distinct file references imply cross-file work.
  const files = new Set<string>();
  let m: RegExpExecArray | null;
  FILE_REF.lastIndex = 0;
  while ((m = FILE_REF.exec(text))) {
    files.add(m[1]);
    if (files.size >= 2) return true;
  }

  // "multiple files" / "several modules" phrasing.
  if (/\b(multiple|several|many|various)\s+(files|modules|components|services|tests)\b/i.test(text))
    return true;

  return false;
}

/**
 * Decide whether to inject a "plan now" guideline for this run.
 * Returns false when the request is trivial OR there is already an unfinished
 * automatic plan for this project (duplicate prevention).
 */
export function shouldPlanRapTodoNow(prompt: string, manager: RapTodoManager | undefined): boolean {
  if (!isComplexRapTodoRequest(prompt)) return false;
  if (manager && manager.hasUnfinishedAutomatic()) return false;
  return true;
}

/** The guideline bullet injected into the system prompt for complex runs. */
export const RAP_TODO_PLAN_GUIDELINE =
  "This request looks like complex, multi-step work. Before implementing, call the rap_todo tool with action \"plan\" and a concise list of actionable tasks (with dependencies where useful). Then, as you work, call rap_todo with action \"update\" to keep task statuses current. Do not plan trivial, single-step changes.";

/** Standing prompt guidelines attached to the rap_todo tool itself. */
export const RAP_TODO_TOOL_GUIDELINES: readonly string[] = [
  "Use rap_todo to track complex, multi-step coding work. Call action \"plan\" with a concise task list BEFORE starting implementation when a request spans multiple files, refactors, or verification steps.",
  "As work progresses, call action \"update\" to move tasks: pending -> in_progress when starting, in_progress -> completed when done and verified.",
  "Do NOT create a plan for trivial single-step changes (a one-line edit, a single read, a quick question).",
  "If a plan already exists for the current work, update it rather than creating a duplicate.",
];
