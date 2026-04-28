#!/usr/bin/env bash
# Deploy the protocol contracts via CREATE2 (deterministic addresses) and write
# the resulting NovelCore proxy address back into config.yaml via
# scripts/patch-config.ts.
#
# Addresses are a function of (deployer, salt, init code). With the same
# PRIVATE_KEY and DEPLOY_SALT, every fresh chain produces the same addresses —
# bump DEPLOY_SALT (or change deployer) for a new namespace, or
# `scripts/anvil.sh reset` to wipe state before redeploying to the same one.
#
# Requires:
#   - anvil running (or a remote RPC reachable)
#   - PRIVATE_KEY env (deployer key)
#   - contracts already compiled (`forge build`)
#
# Optional env:
#   DEPLOY_SALT — bytes32 hex (default keccak256("onchain-novel.v1") inside the script)
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
# chain.chainId is optional in config.yaml; backend / CLI auto-detect via
# eth_chainId. Mirror that here so the deploy log + patch-config call don't
# print/pass "null".
CHAIN_ID="$(cfg chain.chainId)"
if [[ -z "$CHAIN_ID" || "$CHAIN_ID" == "null" ]]; then
  CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
fi
ROOT="$(_cfg_find_root)"

SCRIPT_FILE="scripts/Deploy.s.sol"
$PROD && SCRIPT_FILE="scripts/DeployProduction.s.sol"

DEPLOY_LOG="$ROOT/.local-node/deploy.log"
mkdir -p "$(dirname "$DEPLOY_LOG")"

if [[ -n "${DEPLOY_SALT:-}" ]]; then
  info "Deploying $SCRIPT_FILE to $RPC_URL (chainId $CHAIN_ID, salt=$DEPLOY_SALT)"
else
  info "Deploying $SCRIPT_FILE to $RPC_URL (chainId $CHAIN_ID, salt=default)"
fi
# Only export DEPLOY_SALT when caller set it — passing "" to vm.envOr(bytes32)
# would fail to parse. Unset means the script falls back to its default salt.
(
  cd "$ROOT"
  if [[ -n "${DEPLOY_SALT:-}" ]]; then
    PRIVATE_KEY="$PRIVATE_KEY" DEPLOY_SALT="$DEPLOY_SALT" forge script "$SCRIPT_FILE" \
      --rpc-url "$RPC_URL" --broadcast > "$DEPLOY_LOG" 2>&1
  else
    PRIVATE_KEY="$PRIVATE_KEY" forge script "$SCRIPT_FILE" \
      --rpc-url "$RPC_URL" --broadcast > "$DEPLOY_LOG" 2>&1
  fi
) || { err "forge script failed; last 20 lines of $DEPLOY_LOG:"; tail -20 "$DEPLOY_LOG" >&2; exit 1; }

ok "Contracts deployed"

info "Patching config.yaml with new addresses"
(cd "$ROOT" && npx --yes tsx scripts/patch-config.ts --log "$DEPLOY_LOG" --chain-id "$CHAIN_ID") \
  || die "patch-config.ts failed"

ok "config.yaml updated. Run 'scripts/services.sh start' (or 'scripts/dev.sh start')."
