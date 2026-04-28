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
  info "NovelCore address (the only one to put in config.yaml; every other contract is reachable on-chain from here):"
  printf "  %s\n" "$(cfg "contracts.novelCore")"
  echo ""
}

# Anvil's default deterministic accounts (mnemonic: "test test test test test
# test test test test test test junk"). Each account holds 10000 ETH. #0 is the
# deployer/keeper; the rest are free for multi-identity CLI testing. These are
# PUBLIC well-known keys — never use on a real network.
ANVIL_ACCOUNTS=(
  "0xf39Fd6e51aad88F6F4ce6aB8827279cfFFb92266:0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80:deployer/keeper"
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8:0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d:"
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC:0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a:"
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906:0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6:"
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65:0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a:"
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc:0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba:"
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9:0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e:"
  "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955:0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356:"
  "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f:0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97:"
  "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720:0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dfd8d60c8d:"
)

_print_test_accounts() {
  info "Anvil test accounts (local use only — well-known keys):"
  local i=0
  for entry in "${ANVIL_ACCOUNTS[@]}"; do
    local addr="${entry%%:*}"; local rest="${entry#*:}"
    local pk="${rest%%:*}";    local label="${rest#*:}"
    if [[ -n "$label" ]]; then
      printf "  #%d  %s  %s  (%s)\n" "$i" "$addr" "$pk" "$label"
    else
      printf "  #%d  %s  %s\n" "$i" "$addr" "$pk"
    fi
    i=$((i + 1))
  done
  echo ""
  info "Switch identity per command:  PRIVATE_KEY=0x... onchain-novel-cli <cmd>"
  echo ""
}

# Default deployer key for local anvil (account #0, same as ANVIL_ACCOUNTS[0]
# above). Override in env for a remote chain. On-chain keeper = deployer (see
# scripts/Deploy.s.sol), so `--keeper` reuses this same key.
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
  _print_test_accounts
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
