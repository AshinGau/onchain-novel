#!/usr/bin/env bash
# Build the CLI from source and link it globally via `npm link`.
#
# Usage:
#   ./install.sh            build + link (default)
#   ./install.sh --unlink   remove the global link
#
# `npm link` symlinks the global bin to ./dist/onchain-novel-cli.js, so future
# rebuilds (npm run build) take effect immediately without re-running this script.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

if [[ -t 1 ]]; then
  _G='\033[0;32m'; _Y='\033[0;33m'; _R='\033[0;31m'; _N='\033[0m'
else
  _G=''; _Y=''; _R=''; _N=''
fi
log()  { printf "${_G}==>${_N} %s\n" "$*"; }
warn() { printf "${_Y}warn:${_N} %s\n" "$*"; }
fail() { printf "${_R}error:${_N} %s\n" "$*" >&2; exit 1; }

if [[ "${1:-}" == "--unlink" ]]; then
  log "Unlinking onchain-novel-cli globally"
  npm unlink -g onchain-novel-cli || warn "global link was not present"
  exit 0
fi

command -v npm >/dev/null || fail "npm not found on PATH"

if [[ ! -d "$ROOT/node_modules" ]]; then
  log "node_modules missing — running 'npm install' at repo root"
  (cd "$ROOT" && npm install)
fi

log "Building @onchain-novel/shared"
(cd "$ROOT" && npm run build:shared)

log "Building onchain-novel-cli"
(cd "$HERE" && npm run build)

log "Linking globally (npm link)"
(cd "$HERE" && npm link)

bin_path="$(command -v onchain-novel-cli || true)"
if [[ -z "$bin_path" ]]; then
  warn "onchain-novel-cli not on PATH — check that '\$(npm config get prefix)/bin' is in your PATH"
else
  log "Installed at: $bin_path"
fi

log "Done. Try: onchain-novel-cli --help"
log "To remove: ./install.sh --unlink"
