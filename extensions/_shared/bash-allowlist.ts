/**
 * Bash command safety classifier.
 *
 * Classifies a shell command as read-only-safe or destructive.
 *
 * Pure (no Pi imports) → unit-testable.
 */

// Mutating/destructive patterns that must be blocked in read-only modes.
// Beyond obvious mutations, this catches the string-classifier bypasses:
// pipes/substitution into interpreters (execute arbitrary code), find -exec,
// awk system()/getline, xargs, process substitution, and backticks.
const DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
	/\brm\b/i, /\brmdir\b/i, /\bmv\b/i, /\bcp\b/i, /\bmkdir\b/i, /\btouch\b/i,
	/\bchmod\b/i, /\bchown\b/i, /\bchgrp\b/i, /\bln\b/i, /\btee\b/i, /\btruncate\b/i,
	/\bdd\b/i, /\bshred\b/i,
	/(^|[^<])>(?!>)/, />>/, /<\(/, /`/,
	// Pipe (or trailing) into an interpreter — executes arbitrary code.
	/\|\s*(bash|sh|zsh|dash|ksh|fish|csh|tcsh|node|deno|bun|python\d?|perl|ruby|php|lua|tclsh)\b/i,
	// Direct interpreter invocation with eval/exec flags.
	/\bnode\b\s+(-e|--eval|-p|--print|-r|--require)\b/i,
	/\bdeno\b\s+(-e|--eval)\b/i,
	/\bpython\d?\b\s+(-c|-m)\b/i,
	/\bperl\b\s+(-e|-M)\b/i,
	/\bruby\b\s+(-e)\b/i,
	/\bphp\b\s+(-r|-f)\b/i,
	// Command execution via find/awk/xargs.
	/\bfind\b.*\s-exec(dir)?\b/i,
	/\bawk\b.*\b(system|getline)\b/i,
	/\bxargs\b/i,
	// Network writes to disk (side-effect in read-only mode).
	/\bcurl\b.*(-o|--output)\b/i,
	/\bwget\b.*(-O|--output-document)\b(?!\s*-)/i,
	/\bnpm\s+(install|uninstall|update|ci|link|publish|run|exec)/i,
	/\byarn\s+(add|remove|install|publish|run)/i,
	/\bpnpm\s+(add|remove|install|publish|run|exec)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i, /\bsu\b/i, /\bkill\b/i, /\bpkill\b/i, /\bkillall\b/i,
	/\breboot\b/i, /\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

// Read-only commands allowed in read-only modes.
const SAFE_PATTERNS: readonly RegExp[] = [
	/^\s*cat\b/, /^\s*head\b/, /^\s*tail\b/, /^\s*less\b/, /^\s*more\b/,
	/^\s*grep\b/, /^\s*find\b/, /^\s*ls\b/, /^\s*pwd\b/, /^\s*echo\b/, /^\s*printf\b/,
	/^\s*wc\b/, /^\s*sort\b/, /^\s*uniq\b/, /^\s*diff\b/, /^\s*file\b/, /^\s*stat\b/,
	/^\s*du\b/, /^\s*df\b/, /^\s*tree\b/, /^\s*which\b/, /^\s*whereis\b/, /^\s*type\b/,
	/^\s*env\b/, /^\s*printenv\b/, /^\s*uname\b/, /^\s*whoami\b/, /^\s*id\b/,
	/^\s*date\b/, /^\s*cal\b/, /^\s*uptime\b/, /^\s*ps\b/, /^\s*top\b/, /^\s*htop\b/,
	/^\s*free\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+--version/i, /^\s*python\s+--version/i,
	/^\s*curl\s/i, /^\s*wget\s+-O\s*-/i,
	/^\s*jq\b/, /^\s*sed\s+-n/i, /^\s*awk\b/, /^\s*rg\b/, /^\s*fd\b/, /^\s*bat\b/, /^\s*eza\b/,
];

/** True only if the command is allowlisted AND not destructive. */
export function isSafeCommand(command: string): boolean {
	const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
	const isSafe = SAFE_PATTERNS.some((p) => p.test(command));
	return !isDestructive && isSafe;
}

/** True if the command matches a destructive pattern (write/mutate). */
export function isDestructiveCommand(command: string): boolean {
	return DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
}

/** True if the command is a mutating git subcommand. */
export function isMutatingGitCommand(command: string): boolean {
	return /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|stash|cherry-pick|revert|tag|init|clone)/i.test(command);
}
