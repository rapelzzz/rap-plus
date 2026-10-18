/**
 * Language-aware review checklists for rap-code-review.
 *
 * After each turn where the agent edits files, a language-aware review
 * checklist is injected. Pure (no Pi imports) → unit-testable.
 */

export type Language = "typescript" | "javascript" | "python" | "go" | "rust" | "java" | "php";

const EXT_LANG: Record<string, Language> = {
	ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
	js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
	py: "python",
	go: "go",
	rs: "rust",
	java: "java",
	php: "php",
};

/** Detect a supported language from a file path's extension (case-insensitive). */
export function detectLanguage(filePath: string): Language | undefined {
	const ext = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
	return EXT_LANG[ext];
}

const CHECKLISTS: Record<Language, readonly string[]> = {
	typescript: [
		"Type safety: no `any` leaks, narrow unions, return types explicit on exports.",
		"Error handling: promises awaited, no swallowed rejections, Result/throw used consistently.",
		"Security: no string-built SQL/HTML/shell, no `eval`, secrets not logged.",
		"Naming & boundaries: clear names, no dead exports, single-responsibility.",
	],
	javascript: [
		"Type coercion pitfalls: strict equality (===), no NaN comparisons.",
		"Error handling: async errors caught, no floating promises.",
		"Security: no innerHTML/text concatenation, no eval, secrets not logged.",
		"Naming & dead code: clear names, remove unused exports.",
	],
	python: [
		"Type hints present on public functions; mypy-friendly.",
		"Exceptions: specific, not bare except; resources use context managers.",
		"Security: no shell=True with user input, no pickle of untrusted data.",
		"Naming & style: PEP 8, no shadowing of builtins.",
	],
	go: [
		"Errors checked (err != nil), no discarded errors; wrap with context.",
		"Goroutine lifecycle: no leaks, context.Context propagated for cancellation.",
		"Concurrency: no data races, sync primitives correct.",
		"Naming & idioms: exported docs present, receiver names consistent.",
	],
	rust: [
		"Ownership/borrowing: no needless clones, lifetimes correct.",
		"Result/Option handled, no unwrap() on fallible public paths.",
		"Unsafe: justified and minimized; no UB.",
		"Naming & API: clear names, no panic in libraries.",
	],
	java: [
		"Null safety: Optional over null returns, null-checks where needed.",
		"Exceptions: specific types, no catch-all Exception swallowing.",
		"Resources: try-with-resources for Closeable.",
		"Naming & OO: conventions, no god classes.",
	],
	php: [
		"Type declarations on params/returns; strict_types where appropriate.",
		"Error handling: exceptions not ignored, no @ suppression.",
		"Security: no eval/exec with user input, prepared statements, no XSS echoes.",
		"Naming & style: PSR conventions.",
	],
};

/** Build a concise, language-grouped checklist for the files edited this turn. */
export function formatChecklist(files: readonly string[]): string {
	const byLang = new Map<Language, string[]>();
	for (const f of files) {
		const lang = detectLanguage(f);
		if (!lang) continue;
		const list = byLang.get(lang) ?? [];
		list.push(f);
		byLang.set(lang, list);
	}
	if (byLang.size === 0) return "";
	const parts: string[] = [];
	for (const [lang, langs] of byLang) {
		parts.push(`[${lang}] ${langs.join(", ")}`);
		for (const item of CHECKLISTS[lang]) parts.push(`  - ${item}`);
	}
	return `[CODE REVIEW CHECKLIST — self-review before proceeding]
Edited files grouped by language:
${parts.join("\n")}

Before continuing, verify the edited code against the checklist above. Fix issues inline only if trivial and safe; otherwise note them. Do not introduce new behavior.`;
}
