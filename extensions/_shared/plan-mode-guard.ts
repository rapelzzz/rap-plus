/**
 * Narrow bash allowlist for read-only planning mode.
 *
 * Commands are matched exactly instead of being parsed heuristically as shell
 * syntax. No arguments, redirections, substitutions, pipelines, or chaining
 * are accepted unless the entire command string is explicitly listed.
 */
const READ_ONLY_BASH_COMMANDS = new Set([
	"pwd",
	"git status",
	"git status --short",
	"git status --short --branch",
	"git diff",
	"git diff --cached",
	"git diff --stat",
	"git diff --cached --stat",
	"git diff --check",
	"git log -1 --oneline",
	"git branch --show-current",
]);

export function isSafePlanModeBashCommand(command: string): boolean {
	return READ_ONLY_BASH_COMMANDS.has(command.trim());
}
