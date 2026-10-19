/**
 * Codex-style renderer for Pi's built-in bash tool.
 *
 * Only the call preview is customized. Pi's existing result renderer is
 * preserved so Ctrl+O continues to expand the full output.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

function displayCommands(command: string): string[] {
	const lines = command.split(/\r?\n/).filter((line) => line.trim().length > 0);
	if (lines.length <= 1) return lines;

	// Keep recognizable shell control-flow blocks together instead of
	// misleadingly presenting each source line as an independent command.
	const structured = lines.some((line) =>
		/^\s*(if|then|elif|else|fi|for|while|do|done|case|esac|function)\b/.test(line) ||
		/\\\s*$/.test(line)
	);
	return structured ? [command] : lines;
}

export default function rapBashRenderer(pi: ExtensionAPI): void {
	pi.registerToolRenderer((toolName, next) => {
		const base = next();
		if (toolName !== "bash") return base;

		return {
			...(base ?? {}),
			renderCall(args, theme, context) {
				const command = typeof args.command === "string" ? args.command : "";
				const commands = displayCommands(command);
				const visible = context.expanded ? commands : commands.slice(0, 5);
				const lines = [theme.fg("toolTitle", "• ❯ Ran")];

				visible.forEach((cmd, index) => {
					const last = index === visible.length - 1;
					const tree = last ? "└─" : "├─";
					const commandLines = cmd.split(/\r?\n/);
					lines.push(
						theme.fg("muted", `  ${tree} `) +
						theme.fg("text", `$ ${commandLines[0]}`)
					);
					for (const continuation of commandLines.slice(1)) {
						lines.push(theme.fg("muted", `     ${continuation}`));
					}
				});

				if (!context.expanded && commands.length > visible.length) {
					lines.push(theme.fg("muted", `  … ${commands.length - visible.length} more commands`));
				}
				return new Text(lines.join("\n"), 0, 0);
			},
		};
	});
}
