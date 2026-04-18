#!/usr/bin/env bash
# Bring the whole local dev stack up or down with one command. Thin
# orchestrator — delegates everything to the Layer-1 scripts.
#
# Semantics:
#   start   bring services up, RESUMING previous anvil state + DB data
#           (deploy only on first start; subsequent starts skip deploy)
#   stop    stop services + anvil (anvil flushes chain state to disk)
#   reset   destroy everything — wipe anvil state, drop DB, redeploy, then start
#   status  per-service status
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib/log.sh"
source "$HERE/lib/pidfile.sh"
source "$HERE/lib/read-config.sh"

# Next 16 tries to "patch" the frontend workspace's lockfile at build/start time
# by probing package managers (`npm config get registry`, …) from inside the
# web/frontend dir. In an npm-workspaces monorepo the subdir has no own
# lockfile, so npm bails with ENOWORKSPACES and Next prints a noisy (but
# harmless) "Failed to patch lockfile" error. Skip the whole probe.
export NEXT_IGNORE_INCORRECT_LOCKFILE=1

DEPLOYED_FLAG="$STATE_DIR/deployed"

# Ensure built artifacts exist for the services we're about to start. Shared
# is always required (backend/frontend resolve @onchain-novel/shared to its
# dist/). Backend + frontend builds are required only in release mode.
#
# IMPORTANT: The frontend build bakes config.yaml's contract addresses into the
# client bundle (see web/frontend/next.config.ts). Call this AFTER deploy so
# addresses are already in config.yaml, and pass force_frontend=true after a
# fresh deploy to invalidate any stale .next from a prior run.
_ensure_built() {
  local dev_mode="$1" no_frontend="$2" force_frontend="${3:-false}"
  local scripts=()
  [[ -f "$REPO_ROOT/packages/shared/dist/index.js" ]] || scripts+=(build:shared)
  if ! $dev_mode; then
    [[ -f "$REPO_ROOT/web/backend/dist/index.js" ]] || scripts+=(build:backend)
    if ! $no_frontend; then
      if $force_frontend; then
        rm -rf "$REPO_ROOT/web/frontend/.next"
      fi
      [[ -d "$REPO_ROOT/web/frontend/.next" ]] || scripts+=(build:frontend)
    fi
  fi
  (( ${#scripts[@]} == 0 )) && return 0
  info "Building missing artifacts: ${scripts[*]}"
  for s in "${scripts[@]}"; do
    (cd "$REPO_ROOT" && npm run "$s") || die "$s failed"
  done
}

_print_contracts() {
  echo ""
  info "Contract addresses (from config.yaml):"
  for key in novelCore roundManager votingEngine prizePool bountyBoard rulesEngine userRegistry; do
    local v; v="$(cfg "contracts.$key")"
    printf "  %-14s %s\n" "$key" "$v"
  done
  echo ""
}

# Default deployer key for local anvil (account #0). Override in env for a
# remote chain. On-chain keeper = deployer (see scripts/Deploy.s.sol), so
# `--keeper` reuses this same key; no separate DEFAULT_KEEPER_PK needed.
DEFAULT_PK="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

cmd_start() {
  # dev.sh defaults to RELEASE mode — runs built artifacts from dist/.next.
  # Pass --dev to opt into watch mode (tsx watch / next dev). Extra flags are
  # forwarded to services.sh (--keeper, --no-frontend). Unknown flags error out.
  local svc_flags=()
  local dev_mode=false
  local no_frontend=false
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dev)         svc_flags+=(--dev); dev_mode=true ;;
      --keeper)      svc_flags+=(--keeper) ;;
      --no-frontend) svc_flags+=(--no-frontend); no_frontend=true ;;
      *)             die "unknown flag for 'start': $1" ;;
    esac
    shift
  done

  info "Starting local dev stack"
  "$HERE/anvil.sh" start
  "$HERE/db.sh" create
  "$HERE/db.sh" migrate
  local addresses_changed=false
  if [[ -f "$DEPLOYED_FLAG" ]]; then
    ok "Contracts already deployed — reusing (run 'dev.sh reset' to redeploy)"
  else
    PRIVATE_KEY="${PRIVATE_KEY:-$DEFAULT_PK}" "$HERE/deploy.sh"
    touch "$DEPLOYED_FLAG"
    addresses_changed=true
  fi

  # Build AFTER deploy so next.config.ts picks up the real contract addresses.
  # If addresses just changed, force a frontend rebuild to replace the stale
  # client bundle (NEXT_PUBLIC_* are baked at build time).
  _ensure_built "$dev_mode" "$no_frontend" "$addresses_changed"

  # If --keeper was requested but no key in env, fall back to the deployer key
  # — Deploy.s.sol registers the deployer as the on-chain keeper, so any other
  # key would revert with NotKeeperYet inside the grace window.
  if [[ " ${svc_flags[*]+${svc_flags[*]}} " == *" --keeper "* ]] && [[ -z "${KEEPER_PRIVATE_KEY:-}" ]]; then
    export KEEPER_PRIVATE_KEY="$DEFAULT_PK"
    info "KEEPER_PRIVATE_KEY not set — using deployer key (on-chain keeper)"
  fi

  "$HERE/services.sh" start ${svc_flags[@]+"${svc_flags[@]}"}
  _print_contracts
  ok "stack ready"
}

cmd_stop() {
  info "Stopping local dev stack (chain state + DB preserved)"
  "$HERE/services.sh" stop || true
  "$HERE/anvil.sh" stop || true
  ok "stack stopped"
}

cmd_reset() {
  # reset forwards all start flags (--dev / --keeper / --no-frontend) to the
  # final cmd_start, so `dev.sh reset --dev` behaves like `dev.sh start --dev`.
  info "Resetting local dev stack — wiping all state"
  # Snapshot "$@" before cmd_stop clobbers it via its own calls. Use the
  # ${arr[@]+"${arr[@]}"} idiom so empty arrays don't trip `set -u` on bash 3.2.
  local forward=()
  (( $# > 0 )) && forward=("$@")
  cmd_stop
  rm -f "$STATE_DIR/anvil-state.json"     # wipe chain; start will resume from block 0
  "$HERE/db.sh" drop                      # start will recreate + migrate
  rm -f "$DEPLOYED_FLAG"                  # start will redeploy
  cmd_start ${forward[@]+"${forward[@]}"}
}

cmd_status() {
  "$HERE/anvil.sh" status || true
  "$HERE/services.sh" status || true
  [[ -f "$DEPLOYED_FLAG" ]] && echo "contracts: deployed" || echo "contracts: not deployed"
}

main() {
  local action="${1:-}"; shift || true
  case "$action" in
    start)  cmd_start "$@" ;;
    stop)   cmd_stop ;;
    reset)  cmd_reset "$@" ;;
    status) cmd_status ;;
    *)      die "usage: $0 {start|stop|reset|status} [--dev] [--keeper] [--no-frontend]" ;;
  esac
}

main "$@"
