/**
 * Pure plan-extraction utilities for rap-plan-mode.
 *
 * Reimplemented from Pi's bundled `examples/extensions/plan-mode/utils.ts`
 * (verified reference, MIT-adjacent). Plan-step extraction, [DONE:n] tracking,
 * and step-text cleaning. `isSafeCommand` is imported from the shared module
 * to avoid duplication.
 *
 * Pure (no Pi imports) → unit-testable with `node --test`.
 */

export interface TodoItem {
	step: number;
	text: string;
	completed: boolean;
}

/** Strip markdown emphasis / leading verbs and normalize whitespace; cap length. */
export function cleanStepText(text: string): string {
	let cleaned = text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1") // bold/italic
		.replace(/`([^`]+)`/g, "$1") // inline code
		.replace(
			/^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
			"",
		)
		.replace(/\s+/g, " ")
		.trim();

	if (cleaned.length > 0) {
		cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	}
	if (cleaned.length > 50) {
		cleaned = `${cleaned.slice(0, 47)}...`;
	}
	return cleaned;
}

/** Extract numbered plan steps from a "Plan:" section in an assistant message. */
export function extractTodoItems(message: string): TodoItem[] {
	const items: TodoItem[] = [];
	const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i);
	if (!headerMatch) return items;

	const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
	const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;

	for (const match of planSection.matchAll(numberedPattern)) {
		const text = match[2]
			.trim()
			.replace(/\*{1,2}$/, "")
			.trim();
		if (text.length > 5 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
			const cleaned = cleanStepText(text);
			if (cleaned.length > 3) {
				items.push({ step: items.length + 1, text: cleaned, completed: false });
			}
		}
	}
	return items;
}

/** Parse [DONE:n] markers from a message, returning the step numbers. */
export function extractDoneSteps(message: string): number[] {
	const steps: number[] = [];
	for (const match of message.matchAll(/\[DONE:(\d+)\]/gi)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.push(step);
	}
	return steps;
}

/** Mark items completed for any [DONE:n] in `text`. Returns count marked. */
export function markCompletedSteps(text: string, items: TodoItem[]): number {
	const doneSteps = extractDoneSteps(text);
	for (const step of doneSteps) {
		const item = items.find((t) => t.step === step);
		if (item) item.completed = true;
	}
	return doneSteps.length;
}

/** Filter a list of tool names to only those actually registered with Pi.
 * Pure (takes the registered set as input) so plan-mode tool resolution can be
 * unit-tested without a full Pi mock. Prevents activating tool names that
 * don't exist in this build (e.g. `find`/`ls`/`questionnaire`). */
export function filterRegisteredTools(
	names: readonly string[],
	registered: ReadonlySet<string>,
): string[] {
	return names.filter((n) => registered.has(n));
}

/** Resolve the plan-mode active tool set: keep active tools not in the
 * `disabled` set (and registered), plus managed read-only tools (registered).
 * Order is preserved, duplicates removed. */
export function resolvePlanModeTools(
	active: readonly string[],
	managed: readonly string[],
	registered: ReadonlySet<string>,
	disabled: ReadonlySet<string>,
): string[] {
	return [...new Set([
		...active.filter((n) => !disabled.has(n) && registered.has(n)),
		...filterRegisteredTools(managed, registered),
	])];
}
