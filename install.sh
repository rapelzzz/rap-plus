#!/usr/bin/env sh
# rap-plus installer — curl | sh
#
#   curl -fsSL https://raw.githubusercontent.com/rapelzzz/rap-plus/main/install.sh | sh
#
# Installs Pi (if missing) and then installs the rap-plus package
# (bluemon studio, todo system, widget renderer, web search, theme).
set -eu

OWNER="rapelzzz"
REPO="rap-plus"
PKG_SOURCE="git:github.com/${OWNER}/${REPO}"

# --- helpers ---------------------------------------------------------------
log()  { printf '\033[1;34m rap+\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m rap+\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m rap+\033[0m %s\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# --- 1. ensure Node + Pi ----------------------------------------------------
if ! have pi; then
  log "Pi not found — installing via the official installer…"
  if have curl; then
    curl -fsSL https://pi.dev/install.sh | sh
  elif have wget; then
    wget -qO- https://pi.dev/install.sh | sh
  else
    die "Need curl or wget to install Pi. Aborting."
  fi
fi

have pi || die "Pi still not on PATH after install. Open a new shell and re-run."

log "Pi detected: $(pi --version 2>/dev/null || echo 'version unknown')"

# --- 2. install the rap-plus package ---------------------------------------
log "Installing package: ${PKG_SOURCE}"
pi install "${PKG_SOURCE}"

# --- 3. done + next steps ---------------------------------------------------
cat <<EOF

\033[1;32m✓ rap-plus installed.\033[0m

Loaded extensions:
  • bluemon studio  (extensions/rap-bluemon)
  • todo system     (extensions/todo)
  • web search      (extensions/rap-web-search.ts)
  • theme           (themes/rap-bluemon.json)

Next:
  pi              # start Pi; the extensions load automatically
  pi list         # confirm rap-plus is registered
  pi config       # toggle resources / enable the rap-bluemon theme

EOF
