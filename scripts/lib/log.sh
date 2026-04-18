#!/usr/bin/env bash
# Shared color + log helpers. Source this from other scripts:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/log.sh"

# Guard against double-sourcing.
if [[ -n "${__ONC_LOG_SH_SOURCED:-}" ]]; then return; fi
__ONC_LOG_SH_SOURCED=1

if [[ -t 1 ]]; then
  _C_RED='\033[0;31m'
  _C_GREEN='\033[0;32m'
  _C_YELLOW='\033[1;33m'
  _C_BLUE='\033[0;34m'
  _C_DIM='\033[2m'
  _C_RESET='\033[0m'
else
  _C_RED=; _C_GREEN=; _C_YELLOW=; _C_BLUE=; _C_DIM=; _C_RESET=
fi

info()  { echo -e "${_C_BLUE}==>${_C_RESET} $*" >&2; }
ok()    { echo -e "${_C_GREEN}[ok]${_C_RESET} $*" >&2; }
warn()  { echo -e "${_C_YELLOW}[warn]${_C_RESET} $*" >&2; }
err()   { echo -e "${_C_RED}[err]${_C_RESET} $*" >&2; }
die()   { err "$*"; exit 1; }
step()  { echo -e "${_C_DIM}  - $*${_C_RESET}" >&2; }
