/**
 * rap-big-logo — Replace Pi's built-in startup header (the small `▀▀█` logo
 * + keybinding hints) with an enlarged "RAP" block logo in the active theme's
 * accent color, plus a version label and a compact keybinding hint line.
 *
 * Why this exists:
 *   Pi's built-in logo is a hardcoded 2-row half-block glyph baked into
 *   `BuiltInHeader` (see `dist/modes/interactive/components/pi-logo.js`). Its
 *   size is structural — the surrounding header code assumes exactly two
 *   lines (`const [top, bottom] = piLogoLines()`), so it cannot be enlarged
 *   in place. `ctx.ui.setHeader()` replaces the *whole* header with a custom
 *   component, which lets us draw an arbitrarily large logo at runtime.
 *
 *   Unlike `scripts/patch-pi-logo.sh` (which surgically recolors the hidden
 *   built-in logo's rgbColor triplets and is lost on every `pi update`), this
 *   extension is pure runtime and survives updates.
 *
 * Colors:
 *   Theme-aware via `theme.fg("accent", ...)`. Under the rap-bluemon theme the
 *   accent token resolves to the vivid bluemon blue, matching the palette the
 *   patch script forces. Switching themes recolors the logo automatically.
 *
 * Commands:
 *   /rap-logo         — re-apply the RAP big-logo header.
 *   /rap-logo off     — restore Pi's built-in header (logo + hints).
 *
 * The header auto-applies on every `session_start` in TUI mode.
 */
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";

// "RAP" rendered in a 5-row block font. Each letter is 4 columns wide; letters
// are separated by a single space. Total width: 14 columns. Spaces inside each
// letter cell are significant for alignment — do not trim.
const RAP_LOGO: readonly string[] = [
	"████  ██  ████",
	"█  █ █  █ █  █",
	"███  ████ ████",
	"█ █  █  █ █   ",
	"█  █ █  █ █   ",
];

// Compact keybinding hint line. Mirrors Pi's default compact header; static
// text (does not adapt to remapped keys). Kept so the enlarged header stays
// useful as a quick reference, like the built-in one.
const HINT = "ctrl+c interrupt · ctrl+d/ctrl+c clear/exit · / commands · ! bash · ctrl+o more";

/**
 * Build the header component for a given theme. The `theme` is captured in the
 * closure, so rendered lines use the active theme's colors. Output is cached
 * and cleared by `invalidate()`; the TUI calls `invalidate()` on theme changes
 * and resizes, keeping colors correct without rebuilding on every render.
 */
function makeRapHeader(theme: Theme) {
	let cached: string[] | null = null;
	return {
		render(_width: number): string[] {
			if (cached) return cached;
			// Leading empty line gives the logo breathing room from the top
			// border, mirroring the Spacer(1) Pi places above its header.
			cached = [
				"",
				...RAP_LOGO.map((line) => theme.fg("accent", line)),
				"",
				`${theme.fg("muted", "rap-plus")} ${theme.fg("dim", `v${VERSION}`)}`,
				theme.fg("dim", HINT),
				"",
			];
			return cached;
		},
		invalidate() {
			cached = null;
		},
	};
}

export default function (pi: ExtensionAPI) {
	// Shared factory: setHeader invokes it with the live theme on every build,
	// so the logo recolors automatically when the theme changes.
	const rapHeader = (_tui: unknown, theme: Theme) => makeRapHeader(theme);

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setHeader(rapHeader);
	});

	pi.registerCommand("rap-logo", {
		description: "Toggle the enlarged RAP startup header. Usage: /rap-logo [on|off]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const arg = args.trim().toLowerCase();
			if (arg === "off") {
				ctx.ui.setHeader(undefined);
				ctx.ui.notify("Built-in Pi header restored", "info");
				return;
			}
			ctx.ui.setHeader(rapHeader);
			ctx.ui.notify("RAP big-logo header applied", "info");
		},
	});
}
