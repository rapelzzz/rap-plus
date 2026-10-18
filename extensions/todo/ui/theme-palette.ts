import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  bgRgb,
  fgRgb,
  RESET_BG,
  RESET_FG,
} from "./ui-primitives.ts";

export type RapForegroundRole =
  | "rain"
  | "star"
  | "moon"
  | "prompt"
  | "workingCyan"
  | "workingPurple"
  | "workingText"
  | "workingTextShimmer"
  | "frame"
  | "statusModel"
  | "statusThinking"
  | "statusPath"
  | "statusGit"
  | "statusLimit"
  | "statusTokens"
  | "statusCost"
  | "statusContext";

export type RapBackgroundRole =
  | "model"
  | "thinking"
  | "path"
  | "git"
  | "quota"
  | "tokens"
  | "cost";

export interface RapThemePalette {
  fg(role: RapForegroundRole, text: string): string;
  workingPulse(text: string, intensity: number): string;
  bg(role: RapBackgroundRole, text: string): string;
  transition(
    from: RapBackgroundRole | null,
    to: RapBackgroundRole | null,
    text: string,
  ): string;
}

type ThemeForeground = Parameters<Theme["fg"]>[0];
type RgbColor = readonly [number, number, number];

const THEME_FOREGROUND_TOKENS: Partial<
  Record<RapForegroundRole, ThemeForeground>
> = {
  rain: "thinkingLow",
  star: "accent",
  moon: "warning",
  prompt: "accent",
  workingCyan: "thinkingLow",
  workingPurple: "thinkingMedium",
};

// Rap Bluemon's status bar and shared frame retain a stable visual identity:
// a 7-step blue powerline gradient. The gradient uses a vivid cobalt blue
// (hue ~215, saturation 84%, primary #4f9eff) so the chrome matches the
// active rap-bluemon theme while keeping Bluemon's signature gradient character.
// Foregrounds rendered on the gradient stay near-white for contrast; those
// rendered directly on the terminal surface follow the active Theme so they
// remain legible across light and dark backgrounds.
const STATIC_FOREGROUND_COLORS: Partial<
  Record<RapForegroundRole, RgbColor>
> = {
  // blueBright (#79c0ff) tinted toward white, with a subtle brightness
  // progression across the left status modules (model -> path gets lighter).
  frame: [42, 64, 96], // #2a4060 — frame border, visible chrome edge on #0d1117
  statusModel: [195, 227, 255], // #c3e3ff — blueBright + 55% white
  statusThinking: [215, 236, 255], // #d7ecff — blueBright + 70% white
  statusPath: [235, 246, 255], // #ebf6ff — blueBright + 85% white
  statusGit: [255, 255, 255], // #ffffff — full white for the git segment
  statusLimit: [226, 241, 255], // #e2f1ff — blueBright + 78% white
  // Semantic tints aligned to the theme's accents, lightened ~75% toward white so
  // they stay readable on the blue gradient backgrounds.
  statusTokens: [242, 228, 196], // yellow (#cb9214) lightened -> tokens
  statusCost: [205, 236, 210], // green (#37b34a) lightened -> cost
  statusContext: [253, 221, 238], // pink (#f778ba) lightened -> context
};

// Working "..." indicator text rendered on the terminal surface (not on the
// gradient). Pulses from the active theme's muted fg up to its primary fg, in
// the rap-bluemon family: dark -> fgMuted #929eab up to fg #d6dde3; light -> fgMuted
// #3e4a56 up to fg #1e252a (darker reads brighter on a light background).
const WORKING_TEXT_COLORS = {
  dark: {
    base: [146, 158, 171], // #929eab — fgMuted
    shimmer: [214, 221, 227], // #d6dde3 — fg
  },
  light: {
    base: [62, 74, 86], // #3e4a56 — light fgMuted
    shimmer: [30, 37, 42], // #1e252a — light fg
  },
} as const satisfies Record<"dark" | "light", Record<"base" | "shimmer", RgbColor>>;

// rap-bluemon blue gradient (cobalt hue ~215, saturation 84%), 7 vivid steps from
// the selection blue (#1a4480 family) at the model segment up toward the primary
// blue (#4f9eff family) at cost. Keeps Bluemon's powerline gradient identity
// while speaking rap-bluemon's vivid blue. Backgrounds stay dark enough that the
// near-white foreground tints above remain readable (all segments >= 3:1).
const STATIC_BACKGROUND_COLORS: Record<
  RapBackgroundRole,
  RgbColor
> = {
  model: [12, 64, 136], // #0c4088 — L29 (selection blue family)
  thinking: [13, 72, 153], // #0d4899 — L31.7
  path: [15, 80, 170], // #0f50aa — L35.3
  git: [16, 88, 188], // #1058bc — L39
  quota: [18, 96, 205], // #1260cd — L42.7
  tokens: [19, 104, 222], // #1368de — L46.3
  cost: [25, 113, 235], // #1971eb — L51 (toward primary blue #4f9eff)
};

function renderRgbForeground(color: RgbColor, text: string): string {
  return `${fgRgb(color)}${text}${RESET_FG}`;
}

function renderRgbBackground(color: RgbColor, text: string): string {
  return `${bgRgb(color)}${text}${RESET_BG}`;
}

function interpolateRgb(from: RgbColor, to: RgbColor, intensity: number): RgbColor {
  const amount = Math.max(0, Math.min(1, intensity));
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount),
  ];
}

function renderChromeTransition(
  from: RapBackgroundRole | null,
  to: RapBackgroundRole | null,
  text: string,
): string {
  const background = to === null
    ? RESET_BG
    : bgRgb(STATIC_BACKGROUND_COLORS[to]);
  const foreground = from === null
    ? RESET_FG
    : fgRgb(STATIC_BACKGROUND_COLORS[from]);
  return `${background}${foreground}${text}${RESET_BG}${RESET_FG}`;
}

/**
 * Resolve surface accents through the active Theme while keeping Rap Bluemon's
 * status and frame chrome independent from generic content-surface tokens.
 */
export function createRapPalette(
  theme: Theme,
): RapThemePalette {
  const workingColors = theme.name?.includes("light")
    ? WORKING_TEXT_COLORS.light
    : WORKING_TEXT_COLORS.dark;

  return {
    fg: (role, text) => {
      if (role === "workingText") {
        return renderRgbForeground(workingColors.base, text);
      }
      if (role === "workingTextShimmer") {
        return renderRgbForeground(workingColors.shimmer, text);
      }

      const staticColor = STATIC_FOREGROUND_COLORS[role];
      if (staticColor) return renderRgbForeground(staticColor, text);

      const themeToken = THEME_FOREGROUND_TOKENS[role];
      if (themeToken && typeof theme.fg === "function") {
        return theme.fg(themeToken, text);
      }
      return text;
    },
    workingPulse: (text, intensity) =>
      renderRgbForeground(
        interpolateRgb(workingColors.base, workingColors.shimmer, intensity),
        text,
      ),
    bg: (role, text) =>
      renderRgbBackground(STATIC_BACKGROUND_COLORS[role], text),
    transition: renderChromeTransition,
  };
}

/** Stable chrome palette for public frame helpers without a host Theme. */
// SAFETY: the fallback palette only calls fg; the remaining Theme methods are intentionally unavailable.
export const DEFAULT_RAP_PALETTE = createRapPalette({
  fg: (_color: string, text: string) => text,
} as unknown as Theme);
