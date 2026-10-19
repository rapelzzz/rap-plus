/**
 * rap-toolgate — per-extension on/off toggle for provider-quota savings.
 *
 * Each rap-plus extension that registers model-only tools adds its tool declarations
 * (name + description + JSON schema) to the system prompt on EVERY request. This
 * extension lets you disable individual tool-bearing extensions: their tools are
 * pruned from the active set (via `pi.setActiveTools`) so they leave the prompt,
 * while the extension itself stays loaded (its commands/event handlers still work).
 *
 * Toggle state is persisted globally in `~/.pi/agent/rap-settings.json`, so
 * it applies to every session including new ones. The prune is idempotent and
 * re-applied on every `before_agent_start` (so it self-heals after plan-mode or
 * other tool-set changes).
 *
 * Only extensions that register tools appear in the toggle list — non-tool
 * extensions (pure UI/commands) have ~0 fixed per-request token cost, so toggling
 * them is a no-op and they are intentionally omitted.
 *
 * Usage:
 *   /rap-settings             interactive toggle panel (pick to flip, like /settings)
 *   /rap-settings <id> on|off  quick toggle (e.g. /rap-settings rap-lens off)
 *   /rap-settings all on|off   enable/disable all tool-bearing extensions
 */
import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

/** Persistent enable map: { [extId]: boolean }. Absent key = enabled (default). */
type EnableMap = Record<string, boolean>;

const SETTINGS_PATH = path.join(getAgentDir(), "rap-settings.json");
/** Rough per-tool-declaration token cost (name + description + JSON schema). */
const TOKENS_PER_TOOL = 140;

/** Read the persisted enable map (empty = everything enabled). */
function readEnableMap(): EnableMap {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: EnableMap = {};
      for (const [k, v] of Object.entries(parsed)) if (typeof v === "boolean") out[k] = v;
      return out;
    }
  } catch {
    /* missing or corrupt — treat as all-enabled */
  }
  return {};
}

/** Atomically write the enable map. */
function writeEnableMap(map: EnableMap): void {
  const dir = path.dirname(SETTINGS_PATH);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${SETTINGS_PATH}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2), "utf-8");
    fs.renameSync(tmp, SETTINGS_PATH);
  } catch {
    /* best-effort; toggle still applies in-memory for the current session */
  }
}

/** Whether an extension id is currently enabled (absent = enabled). */
function isEnabled(map: EnableMap, id: string): boolean {
  return map[id] !== false;
}

/**
 * Derive a stable extension id from a tool's source path.
 * rap-plus layout: `.../extensions/<id>/index.ts` or `.../extensions/<id>.ts`.
 * Built-in tools use a `builtin:` synthetic path and map to null (not toggleable).
 */
function extIdOf(toolPath: string): string | null {
  if (!toolPath || toolPath.startsWith("builtin:") || toolPath.startsWith("<")) return null;
  const after = toolPath.split("extensions/").pop();
  if (after) {
    const first = after.split("/")[0] || "";
    const id = first.replace(/\.(ts|js|mjs)$/, "");
    if (id) return id;
  }
  // Fallback: file basename without extension.
  const base = path.basename(toolPath).replace(/\.(ts|js|mjs)$/, "");
  return base || null;
}

/** Build a map of { extId -> [toolName, ...] } from all registered tools. */
function buildToolMap(pi: ExtensionAPI): Map<string, string[]> {
  const all = pi.getAllTools() as unknown as Array<{ name?: string; sourceInfo?: { path?: string } }>;
  const map = new Map<string, string[]>();
  for (const t of all) {
    const name = typeof t === "object" && t ? t.name : undefined;
    if (!name) continue;
    const id = extIdOf(t?.sourceInfo?.path ?? "");
    if (!id) continue; // built-in or unresolvable
    const arr = map.get(id) ?? [];
    arr.push(name);
    map.set(id, arr);
  }
  return map;
}

/** Set of tool names belonging to currently-disabled extensions. */
function disabledToolSet(pi: ExtensionAPI, map: EnableMap): Set<string> {
  const toolMap = buildToolMap(pi);
  const out = new Set<string>();
  for (const [id, tools] of toolMap) {
    if (!isEnabled(map, id)) for (const tn of tools) out.add(tn);
  }
  return out;
}

/**
 * Idempotently prune disabled extensions' tools from the active set.
 * Only removes tools (never adds), and only acts when a disabled tool is actually
 * active — so it's a no-op once pruned and safe to run every turn.
 */
function prune(pi: ExtensionAPI, map: EnableMap): { pruned: number } {
  const active = pi.getActiveTools();
  const disabled = disabledToolSet(pi, map);
  if (disabled.size === 0) return { pruned: 0 };
  const leaked = active.filter((t) => disabled.has(t));
  if (leaked.length === 0) return { pruned: 0 };
  pi.setActiveTools(active.filter((t) => !disabled.has(t)));
  return { pruned: leaked.length };
}

/** Compact single-line status for `/rap-settings` (fits a notify toast). */
function formatStatus(pi: ExtensionAPI, map: EnableMap): string {
  const toolMap = buildToolMap(pi);
  const ids = [...toolMap.keys()].sort();
  if (ids.length === 0) return "rap-settings: no tool-bearing extensions found.";
  const parts: string[] = [];
  let hiddenTools = 0;
  for (const id of ids) {
    const tools = toolMap.get(id) ?? [];
    const enabled = isEnabled(map, id);
    if (enabled) parts.push(`${id} ON(${tools.length})`);
    else {
      parts.push(`${id} OFF(${tools.length},~${tools.length * TOKENS_PER_TOOL}t)`);
      hiddenTools += tools.length;
    }
  }
  const saved = hiddenTools > 0 ? ` | saving ~${hiddenTools * TOKENS_PER_TOOL} tok/req` : "";
  return `rap-settings: ${parts.join(" • ")}${saved} | /rap-settings <id> on|off`;
}

/**
 * Interactive `/settings`-style toggle panel: a select loop where picking an
 * extension flips its state, refreshes, and re-shows. Esc saves & exits.
 */
async function runInteractivePanel(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  for (;;) {
    const map = readEnableMap();
    const toolMap = buildToolMap(pi);
    const ids = [...toolMap.keys()].sort();
    if (ids.length === 0) {
      ctx.ui.notify("rap-settings: no tool-bearing extensions found.", "info");
      return;
    }
    let hiddenTools = 0;
    const options: string[] = ids.map((id) => {
      const tools = toolMap.get(id) ?? [];
      const enabled = isEnabled(map, id);
      if (!enabled) hiddenTools += tools.length;
      const tok = tools.length * TOKENS_PER_TOOL;
      return enabled
        ? `[ON]  ${id.padEnd(16)} ${tools.length} tools`
        : `[OFF] ${id.padEnd(16)} ${tools.length} tools  (~${tok} tok/req saved)`;
    });
    // No "Done" option — press Esc to save & exit. Toggles already persist on each flip.
    const title =
      hiddenTools > 0
        ? `rap-settings — saving ~${hiddenTools * TOKENS_PER_TOOL} tok/req (pick to flip, Esc to save & exit)`
        : `rap-settings — pick an extension to toggle (Esc to save & exit)`;
    const choice = await ctx.ui.select(title, options);
    if (!choice) return;
    const m = choice.match(/^\[(?:ON|OFF)\]\s+(\S+)/);
    if (!m) continue;
    const id = m[1];
    const next: EnableMap = { ...map };
    const wasEnabled = isEnabled(map, id);
    if (wasEnabled) next[id] = false;
    else delete next[id];
    writeEnableMap(next);
    const toolCount = toolMap.get(id)?.length ?? 0;
    const { pruned } = prune(pi, next);
    ctx.ui.notify(
      wasEnabled
        ? `${id} OFF — ${pruned} tools hidden (~${pruned * TOKENS_PER_TOOL} tok/req saved).`
        : `${id} ON (${toolCount} tools). Tools return on next session or /reload.`,
      "info",
    );
  }
}

export default function rapToolgate(pi: ExtensionAPI): void {
  // Re-prune on every user turn (idempotent — no-op when already pruned).
  // This keeps disabled tools out of the prompt and self-heals after plan-mode
  // or any other setActiveTools call restores the normal tool set.
  pi.on("before_agent_start", async (event: { messageType?: string }) => {
    if (event?.messageType !== "user") return;
    try {
      prune(pi, readEnableMap());
    } catch {
      /* never block the agent turn */
    }
  });

  pi.registerCommand("rap-settings", {
    description:
      "Toggle rap-plus tool-bearing extensions on/off to save provider quota. Usage: /rap-settings  (interactive) | /rap-settings <id> on|off | /rap-settings all on|off",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const tokens = args.trim().split(/\s+/).filter(Boolean);

      // /rap-settings  → interactive panel (or compact notify without UI)
      if (tokens.length === 0) {
        if (ctx.hasUI) {
          await runInteractivePanel(pi, ctx);
        } else {
          ctx.ui.notify(formatStatus(pi, readEnableMap()), "info");
        }
        return;
      }

      const map = readEnableMap();
      const toolMap = buildToolMap(pi);
      const knownIds = new Set(toolMap.keys());

      // /rap-settings all on|off
      if (tokens[0] === "all") {
        const val = tokens[1]?.toLowerCase();
        if (val !== "on" && val !== "off") {
          ctx.ui.notify("Usage: /rap-settings all on|off", "warning");
          return;
        }
        const next: EnableMap = {};
        if (val === "off") for (const id of knownIds) next[id] = false;
        // "on" → empty map (everything enabled by default)
        writeEnableMap(next);
        const { pruned } = prune(pi, next);
        const count = knownIds.size;
        ctx.ui.notify(
          val === "on"
            ? `All ${count} tool-bearing extensions ON.`
            : `All ${count} tool-bearing extensions OFF (${pruned} tools hidden).`,
          "info",
        );
        return;
      }

      // /rap-settings <id> on|off
      const id = tokens[0];
      const val = tokens[1]?.toLowerCase();
      if (val !== "on" && val !== "off") {
        ctx.ui.notify(`Usage: /rap-settings ${id} on|off`, "warning");
        return;
      }
      if (!knownIds.has(id)) {
        ctx.ui.notify(
          `Unknown extension "${id}". Tool-bearing extensions: ${[...knownIds].sort().join(", ")}`,
          "warning",
        );
        return;
      }
      const next: EnableMap = { ...map };
      if (val === "on") delete next[id];
      else next[id] = false;
      writeEnableMap(next);

      const toolCount = toolMap.get(id)?.length ?? 0;
      if (val === "on") {
        // Re-enabling can't "add back" surgically without clobbering other active
        // tool choices, so just notify; the next session (or /reload) restores it
        // fully. The idempotent prune stays a no-op for this id now.
        prune(pi, next);
        ctx.ui.notify(
          `${id} ON (${toolCount} tools). Tools return on next session or /reload.`,
          "info",
        );
      } else {
        const { pruned } = prune(pi, next);
        ctx.ui.notify(
          `${id} OFF — ${pruned} tools hidden (~${pruned * TOKENS_PER_TOOL} tok/req saved). Re-enable: /rap-settings ${id} on`,
          "info",
        );
      }
    },
  });
}
