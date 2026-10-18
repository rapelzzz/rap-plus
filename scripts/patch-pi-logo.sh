#!/usr/bin/env sh
# patch-pi-logo.sh — recolor the Pi startup logo (▀▀█ / "Pi" wordmark) to match
# the rap-bluemon CC Dark theme.
#
# Why this exists:
#   Pi's logo colors are hardcoded in its bundled chunk
#   (dist/bundle/chunks/*.js) as CORAL/BLUE/YELLOW and are NOT themeable.
#   This script surgically rewrites those three rgbColor() triplets so the
#   logo follows the rap-bluemon vivid-blue palette.
#
# Colors (CC Dark "blue gradient", Option A):
#   CORAL  rgb(228,138,122) -> rgb(79,158,255)   #4F9EFF  (accent blue)
#   BLUE   rgb(79,142,179)  -> rgb(31,111,235)   #1F6FEB  (deep blue)
#   YELLOW rgb(234,182,93)  -> rgb(121,192,255)  #79C0FF  (light blue)
#
# Properties:
#   - Idempotent: re-running is a no-op once patched.
#   - Version-robust: locates the chunk by scanning for the brand-coral
#     signature rgbColor(228,138,122), so it does not depend on the chunk's
#     build-hash filename. If a future Pi changes the logo colors, the
#     signature is absent and the script safely does nothing.
#   - Targets the GLOBAL Pi install (the one the user actually runs), NOT a
#     local node_modules copy of @earendil-works/pi-coding-agent that npm may
#     have dropped inside this package during install (which would shadow `pi`
#     on PATH during postinstall). It prefers `npm root -g`, then a PATH walk
#     that skips copies under this package's own node_modules.
#   - Non-fatal: never exits non-zero. The logo recolor is cosmetic; a failure
#     (pi missing, permission denied, ...) is reported on stderr and skipped,
#     so a postinstall problem can never block `npm install` / `pi install`.
#
# Usage:
#   sh scripts/patch-pi-logo.sh            # auto-locate the global Pi install
#
# Re-run this after `pi update`, which restores Pi's original bundle.
set -u

log()  { printf '\033[1;34m rap+\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m rap+\033[0m %s\n' "$*" >&2; }

# The Pi brand coral is the stable signature for the logo color definition.
SIG='rgbColor(228,138,122)'

# --- 1. locate the GLOBAL Pi core bundle chunks dir ------------------------
# Returns the chunks dir on stdout, or returns non-zero if not found.
find_chunks_dir() {
    # (a) npm global root — the most reliable signal for the global install,
    #     unaffected by node_modules/.bin shadowing during postinstall.
    if command -v npm >/dev/null 2>&1; then
        groot=$(npm root -g 2>/dev/null || true)
        if [ -n "$groot" ] && [ -d "$groot/@earendil-works/pi-coding-agent/dist/bundle/chunks" ]; then
            printf '%s\n' "$groot/@earendil-works/pi-coding-agent/dist/bundle/chunks"
            return 0
        fi
    fi
    # (b) walk PATH for `pi`, skip copies living inside THIS package's
    #     node_modules (dev/peer shadows), resolve the real global binary.
    cwd=$(pwd -P 2>/dev/null || pwd)
    ifs_old=$IFS
    IFS=:
    for d in $PATH; do
        IFS=$ifs_old
        [ -n "$d" ] || continue
        cand=$d/pi
        [ -x "$cand" ] || continue
        real=$(readlink -f "$cand" 2>/dev/null || true)
        [ -n "$real" ] || continue
        case "$real" in
            "$cwd"/node_modules/*) continue ;;   # local shadow — skip
        esac
        case "$real" in
            */dist/bundle/cli.js) printf '%s\n' "${real%/cli.js}/chunks"; return 0 ;;
        esac
    done
    IFS=$ifs_old
    # (c) last resort: whatever `command -v pi` resolves to.
    if command -v pi >/dev/null 2>&1; then
        real=$(readlink -f "$(command -v pi)" 2>/dev/null || true)
        case "$real" in
            */dist/bundle/cli.js) printf '%s\n' "${real%/cli.js}/chunks"; return 0 ;;
        esac
    fi
    return 1
}

CHUNKS_DIR=$(find_chunks_dir) || { warn "could not locate the global Pi install; skipping logo recolor."; exit 0; }
[ -d "$CHUNKS_DIR" ] || { warn "Pi bundle chunks dir not found ($CHUNKS_DIR); skipping logo recolor."; exit 0; }

# --- 2. find chunk(s) carrying the logo signature --------------------------
# grep -l prints filenames; if none match, the logo is already patched or Pi
# changed its colors — either way, nothing to do.
matches=$(grep -l -- "$SIG" "$CHUNKS_DIR"/*.js 2>/dev/null || true)
if [ -z "$matches" ]; then
    # Already recolored (or signature changed in a newer Pi). Quiet success.
    exit 0
fi

# --- 3. recolor (portable sed via temp file; works on GNU + BSD) -----------
for f in $matches; do
    tmp=${f}.rap-plus.tmp
    if sed \
        -e 's/rgbColor(228,138,122)/rgbColor(79,158,255)/g' \
        -e 's/rgbColor(79,142,179)/rgbColor(31,111,235)/g' \
        -e 's/rgbColor(234,182,93)/rgbColor(121,192,255)/g' \
        "$f" > "$tmp" 2>/dev/null && mv -f "$tmp" "$f" 2>/dev/null; then
        log "recolored Pi logo in $f"
    else
        rm -f "$tmp"
        warn "could not write $f (permission denied? try with sudo); logo left as-is."
    fi
done

# Note: the change takes effect on the NEXT `pi` start, because the running
# process already loaded the bundle into memory. The postinstall hook runs
# during `pi install` (before the user's first `pi` launch), so it is seamless.
exit 0
