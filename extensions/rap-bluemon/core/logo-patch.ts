/**
 * Runtime logo recolor — keeps the Pi startup logo recolored to the rap-bluemon
 * CC Dark palette across `pi update`s.
 *
 * Pi's logo colors (▀▀█ / "Pi" wordmark) are hardcoded in its bundled chunk
 * (`dist/bundle/chunks/*.js`) and are NOT themeable. The package `postinstall`
 * hook patches the file at install time, but `pi update` restores Pi's original
 * bundle — and postinstall only re-fires when rap-plus's OWN version bumps.
 *
 * This module closes that gap: on each `pi` start, if the running Pi version
 * differs from the last one we verified, re-check the bundle and re-patch if
 * the brand-coral signature is present again. Cheap in steady state (one tiny
 * marker-file read); does real work only once per Pi version (i.e. right after
 * a `pi update`).
 *
 * Limitation: a file patch cannot affect the already-loaded process. After a
 * `pi update`, the first session shows the default logo once (this patches the
 * file in the background); subsequent sessions are blue. No manual command.
 *
 * Non-throwing: a failure (pi missing, permission denied, …) is returned as an
 * outcome and never breaks `session_start`.
 */
import { execSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** Pi brand coral — the stable signature for the logo color definition. */
const SIGNATURE = "rgbColor(228,138,122)";

const REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["rgbColor(228,138,122)", "rgbColor(79,158,255)"], // CORAL  -> #4F9EFF
  ["rgbColor(79,142,179)", "rgbColor(31,111,235)"], // BLUE   -> #1F6FEB
  ["rgbColor(234,182,93)", "rgbColor(121,192,255)"], // YELLOW -> #79C0FF
];

export type LogoPatchReason =
  | "patched" // file was rewritten this call
  | "already-ok" // marker verified for this Pi version — skipped the scan
  | "signature-missing" // no chunk carried the signature (already patched OR Pi changed the logo)
  | "no-pi" // could not locate the global Pi install
  | "error";

export interface LogoPatchOutcome {
  patched: boolean;
  reason: LogoPatchReason;
  message?: string;
}

function markerPath(agentDir: string): string {
  return join(agentDir, ".rap-plus-logo-patched.json");
}

function readMarker(agentDir: string): string | undefined {
  try {
    const raw = readFileSync(markerPath(agentDir), "utf8");
    const parsed = JSON.parse(raw) as { v?: unknown };
    return typeof parsed.v === "string" ? parsed.v : undefined;
  } catch {
    return undefined;
  }
}

/** Only write the marker on genuine success/no-op states, so transient
 *  failures (pi unlocatable this session) retry on the next start. */
function writeMarker(agentDir: string, version: string): void {
  try {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(markerPath(agentDir), JSON.stringify({ v: version }));
  } catch {
    /* best-effort; the marker is an optimization, not a correctness requirement */
  }
}

/** Locate the GLOBAL Pi bundle chunks dir (not a local node_modules shadow). */
function findChunksDir(): string | undefined {
  // (a) npm global root — unaffected by node_modules/.bin shadowing, and the
  //     same signal the install-time shell script uses.
  try {
    const root = execSync("npm root -g", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const dir = join(
      root,
      "@earendil-works",
      "pi-coding-agent",
      "dist",
      "bundle",
      "chunks",
    );
    if (existsSync(dir)) return dir;
  } catch {
    /* npm missing or failed — fall through to PATH walk */
  }
  // (b) walk PATH for `pi`, skip copies living under this package's node_modules.
  const cwd = process.cwd();
  const localPrefix = join(cwd, "node_modules");
  for (const d of (process.env.PATH ?? "").split(":")) {
    if (!d) continue;
    const cand = join(d, "pi");
    if (!existsSync(cand)) continue;
    let real: string;
    try {
      real = realpathSync(cand);
    } catch {
      continue;
    }
    if (real.startsWith(localPrefix)) continue; // local shadow — skip
    if (real.endsWith(join("dist", "bundle", "cli.js"))) {
      return join(dirname(real), "chunks");
    }
  }
  return undefined;
}

/**
 * Ensure the global Pi bundle's logo is recolored for the running Pi version.
 * Idempotent and non-throwing. Intended to be called (fire-and-forget) from
 * `session_start`.
 */
export function ensurePiLogoPatched(
  version: string,
  agentDir: string,
): LogoPatchOutcome {
  // Cheap steady-state path: if we already verified for this exact Pi version,
  // skip the chunk scan entirely.
  if (readMarker(agentDir) === version) {
    return { patched: false, reason: "already-ok" };
  }

  const dir = findChunksDir();
  if (!dir) {
    // Don't write the marker — retry on the next start in case PATH was transient.
    return { patched: false, reason: "no-pi" };
  }

  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => join(dir, f));
  } catch (e) {
    return { patched: false, reason: "error", message: (e as Error).message };
  }

  for (const f of files) {
    let src: string;
    try {
      src = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (!src.includes(SIGNATURE)) continue;
    let out = src;
    for (const [from, to] of REPLACEMENTS) out = out.split(from).join(to);
    if (out === src) continue;
    try {
      writeFileSync(f, out);
      writeMarker(agentDir, version);
      return { patched: true, reason: "patched", message: f };
    } catch (e) {
      return {
        patched: false,
        reason: "error",
        message: `write failed: ${(e as Error).message}`,
      };
    }
  }

  // No chunk carried the signature: either already patched, or a future Pi
  // changed the logo colors. Mark verified so we don't re-scan every start.
  writeMarker(agentDir, version);
  return { patched: false, reason: "signature-missing" };
}
