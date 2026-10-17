export type IconMode = "lucide" | "nerd" | "ascii";

export const DEFAULT_ICON_MODE: IconMode = "lucide";

export interface StatusIcons {
  readonly model: string;
  readonly thinking: string;
  readonly path: string;
  readonly branch: string;
  readonly transition: string;
  readonly tokens: string;
  readonly gaugeFilled: string;
  readonly gaugeEmpty: string;
}

/**
 * Lucide-style icons delivered through Nerd Font Material Design glyphs
 * (Lucide itself isn't shipped as a named Nerd Font set, so the closest
 * outlined equivalents are used: bot=zap, bolt, folder, source-branch,
 * multiple-coins). The powerline transition stays a sharp right triangle `>`.
 *
 * Codepoints are taken from the official Nerd Font glyph data (NF v3.5+).
 */
const LUCIDE_ICONS: StatusIcons = Object.freeze({
  model: "\u{f06a9}",      // md-robot        (Lucide "bot")
  thinking: "\u{f0db3}",   // md-bolt         (Lucide "zap")
  path: "\u{f024b}",       // md-folder       (Lucide "folder")
  branch: "\u{f062c}",     // md-source_branch (Lucide "git-branch")
  transition: "\uE0B0",    // powerline right triangle (sharp `>` divider)
  tokens: "\u{f0695}",     // md-circle_multiple_outline (Lucide "coins")
  gaugeFilled: "\u2588",   // full block
  gaugeEmpty: "\u2591",    // light shade
});

const NERD_ICONS: StatusIcons = Object.freeze({
  model: "\uE795",
  thinking: "\u26A1",
  path: "\uF07B",
  branch: "\uE0A0",
  transition: "\uE0B0",
  tokens: "\u03A3",
  gaugeFilled: "\u2588",
  gaugeEmpty: "\u2591",
});

const ASCII_ICONS: StatusIcons = Object.freeze({
  model: "@",
  thinking: "",
  path: "~",
  branch: "*",
  transition: "\uE0B0",
  tokens: "\u03A3",
  gaugeFilled: "\u2588",
  gaugeEmpty: "\u2591",
});

export function isIconMode(value: unknown): value is IconMode {
  return value === "lucide" || value === "nerd" || value === "ascii";
}

export function resolveIcons(mode: IconMode): StatusIcons {
  if (mode === "ascii") return ASCII_ICONS;
  if (mode === "nerd") return NERD_ICONS;
  return LUCIDE_ICONS;
}
