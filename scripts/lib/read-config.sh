#!/usr/bin/env bash
# Read values from config.yaml using yq. Source from another script:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/read-config.sh"
#   RPC_URL=$(cfg chain.rpcUrl)
#   BACKEND_PORT=$(cfg backend.port)

if [[ -n "${__ONC_READ_CONFIG_SH_SOURCED:-}" ]]; then return; fi
__ONC_READ_CONFIG_SH_SOURCED=1

_cfg_find_root() {
  local dir
  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/config.yaml" ]] || [[ -f "$dir/foundry.toml" ]]; then
      echo "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  echo "error: could not find repo root with config.yaml" >&2
  return 1
}

_cfg_path() {
  if [[ -n "${ONCHAIN_NOVEL_CONFIG:-}" ]]; then
    echo "$ONCHAIN_NOVEL_CONFIG"
  else
    echo "$(_cfg_find_root)/config.yaml"
  fi
}

cfg() {
  if ! command -v yq >/dev/null 2>&1; then
    echo "error: yq not found. Run scripts/bootstrap.sh or install manually." >&2
    return 1
  fi
  local path="${1:?usage: cfg <key.path>}"
  local file; file="$(_cfg_path)"
  if [[ ! -f "$file" ]]; then
    echo "error: $file not found. Run scripts/bootstrap.sh (or 'cp config.yaml.example config.yaml')." >&2
    return 1
  fi
  yq eval ".${path}" "$file"
}
