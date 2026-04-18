#!/usr/bin/env bash
# Deploy the protocol contracts and write the resulting addresses back into
# config.yaml via scripts/patch-config.ts.
#
# Requires:
#   - anvil running (or a remote RPC reachable)
#   - PRIVATE_KEY env (deployer key)
#   - contracts already compiled (`forge build`)
#
# Usage:
#   PRIVATE_KEY=0x... scripts/deploy.sh          # local anvil
#   PRIVATE_KEY=0x... scripts/deploy.sh --prod   # uses DeployProduction.s.sol
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib/log.sh"
source "$HERE/lib/read-config.sh"

PROD=false
if [[ "${1:-}" == "--prod" ]]; then PROD=true; fi

: "${PRIVATE_KEY:?PRIVATE_KEY env not set — export your deployer key first}"
command -v forge >/dev/null 2>&1 || die "forge not found (run scripts/bootstrap.sh)"

RPC_URL="$(cfg chain.rpcUrl)"
CHAIN_ID="$(cfg chain.chainId)"
ROOT="$(_cfg_find_root)"

SCRIPT_FILE="scripts/Deploy.s.sol"
$PROD && SCRIPT_FILE="scripts/DeployProduction.s.sol"

DEPLOY_LOG="$ROOT/.local-node/deploy.log"
mkdir -p "$(dirname "$DEPLOY_LOG")"

info "Deploying $SCRIPT_FILE to $RPC_URL (chainId $CHAIN_ID)"
(
  cd "$ROOT"
  PRIVATE_KEY="$PRIVATE_KEY" forge script "$SCRIPT_FILE" \
    --rpc-url "$RPC_URL" --broadcast > "$DEPLOY_LOG" 2>&1
) || { err "forge script failed; last 20 lines of $DEPLOY_LOG:"; tail -20 "$DEPLOY_LOG" >&2; exit 1; }

ok "Contracts deployed"

info "Patching config.yaml with new addresses"
(cd "$ROOT" && npx --yes tsx scripts/patch-config.ts --log "$DEPLOY_LOG" --chain-id "$CHAIN_ID") \
  || die "patch-config.ts failed"

ok "config.yaml updated. Run 'scripts/services.sh start' (or 'scripts/dev.sh start')."
