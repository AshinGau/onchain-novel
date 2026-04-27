#!/usr/bin/env bash
# =============================================================================
# CLI Smoke Test
#
# Spins up an isolated anvil + deploys contracts + runs the backend, then
# exercises the CLI commands that changed:
#   - novel create (voteStake <= submissionFee invariant)
#   - chapter submit
#   - chapter comment / chapter comments (off-chain EIP-191 signed)
#   - vote commit (auto-generated salt + keeper-assisted reveal submission)
#   - vote reveal (using local salt backup)
#
# Uses dedicated ports / DB / HOME so it won't collide with a running dev env.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLI_DIR="$ROOT_DIR/cli"
BACKEND_DIR="$ROOT_DIR/web/backend"
cd "$ROOT_DIR"

# -- Colors --
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
PASS_COUNT=0; FAIL_COUNT=0
pass() { echo -e "${GREEN}[PASS]${NC} $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo -e "${RED}[FAIL]${NC} $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

# -- Config --
RPC_PORT="${SMOKE_RPC_PORT:-8746}"
RPC="http://localhost:${RPC_PORT}"
API_PORT="${SMOKE_API_PORT:-3902}"
API="http://localhost:${API_PORT}"
DB_NAME="onchain_novel_cli_smoke"
DB_URL="postgresql://localhost:5432/$DB_NAME"

# Anvil deterministic accounts
PK_DEPLOYER="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
PK_CREATOR="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
ADDR_CREATOR="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
PK_WRITER_A="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
PK_WRITER_B="0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
PK_VOTER_A="0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"
ADDR_VOTER_A="0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"

# Isolated HOME so CLI config doesn't clobber the user's
SMOKE_HOME="$(mktemp -d)"
export HOME="$SMOKE_HOME"

ANVIL_PID=""
BACKEND_PID=""
BACKEND_LOG="/tmp/cli-smoke-backend-$(date +%s).log"

cleanup() {
  info "Cleaning up..."
  if [ $FAIL_COUNT -gt 0 ] && [ -f "$BACKEND_LOG" ]; then
    info "=== Backend logs (last 30 lines) ==="
    tail -30 "$BACKEND_LOG" || true
  fi
  [ -n "$BACKEND_PID" ] && kill $BACKEND_PID 2>/dev/null || true
  [ -n "$ANVIL_PID" ] && kill $ANVIL_PID 2>/dev/null || true
  wait $BACKEND_PID 2>/dev/null || true
  wait $ANVIL_PID 2>/dev/null || true
  dropdb --if-exists "$DB_NAME" 2>/dev/null || true
  rm -rf "$SMOKE_HOME"
}
trap cleanup EXIT

CLI="$CLI_DIR/dist/onchain-novel-cli.js"
node_cli() {
  node "$CLI" "$@"
}

# Switch the signer for subsequent write commands. Secrets come from env only
# (CLI no longer persists privateKey to disk).
use_pk() {
  export PRIVATE_KEY="$1"
}

api_get() { curl -sf "$API$1" 2>/dev/null || true; }

wait_indexer() {
  local max_wait="${1:-15}"
  local chain_block
  chain_block=$(cast block-number --rpc-url "$RPC" 2>/dev/null) || chain_block=0
  for i in $(seq 1 "$max_wait"); do
    local indexed
    indexed=$(api_get "/health" | jq -r '.indexer.lastBlock' 2>/dev/null) || indexed=0
    if [ -n "$indexed" ] && [ "$indexed" -ge "$chain_block" ] 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# =============================================================================
# SETUP
# =============================================================================

info "========================================="
info "CLI Smoke Test"
info "========================================="

for cmd in anvil cast forge jq curl node createdb dropdb psql; do
  if ! command -v "$cmd" &>/dev/null; then
    fail "Missing dependency: $cmd"
    exit 1
  fi
done
pass "Dependencies present"

# -- Build CLI if not already --
if [ ! -f "$CLI" ]; then
  info "Building CLI..."
  (cd "$CLI_DIR" && npm run build > /dev/null)
fi
pass "CLI built"

# -- Start anvil --
info "Starting anvil on port ${RPC_PORT}..."
anvil --port "$RPC_PORT" --block-time 1 --silent &
ANVIL_PID=$!
sleep 2
cast block-number --rpc-url "$RPC" > /dev/null 2>&1 || { fail "Anvil not reachable"; exit 1; }
pass "Anvil running"

# -- Set up DB --
info "Setting up DB..."
dropdb --if-exists "$DB_NAME" 2>/dev/null || true
createdb "$DB_NAME"
for f in "$BACKEND_DIR"/migrations/*.sql; do
  psql -q "$DB_URL" < "$f" > /dev/null
done
pass "DB ready"

# -- Deploy contracts --
info "Deploying contracts..."
DEPLOY_LOG="/tmp/cli-smoke-deploy-$(date +%s).log"
PRIVATE_KEY="$PK_DEPLOYER" forge script scripts/Deploy.s.sol \
  --rpc-url "$RPC" --broadcast > "$DEPLOY_LOG" 2>&1
BROADCAST_JSON="broadcast/Deploy.s.sol/31337/run-latest.json"
[ -f "$BROADCAST_JSON" ] || { fail "Broadcast file missing"; tail -20 "$DEPLOY_LOG"; exit 1; }

# Extract NovelCore proxy address from forge console output. Every other
# contract (roundManager / votingEngine / prizePool / bountyBoard / rulesEngine
# / userRegistry) is reachable on-chain from NovelCore's address book and
# resolved at startup by bootstrapConfig — config.yaml only carries novelCore.
extract() { grep -E "^\s*$1:" "$DEPLOY_LOG" | tail -1 | awk '{print $NF}'; }
NOVEL_CORE=$(extract "NovelCore")
[ -n "$NOVEL_CORE" ] || { fail "Failed to extract NovelCore from deploy log"; tail -40 "$DEPLOY_LOG"; exit 1; }
pass "Contracts deployed (NovelCore=$NOVEL_CORE)"

# -- Write a temporary config.yaml for this smoke run (isolated from the user's real config) --
SMOKE_CONFIG="$SMOKE_HOME/config.yaml"
cat > "$SMOKE_CONFIG" <<EOF
chain:
  rpcUrl: $RPC
  # chainId omitted on purpose: bootstrapConfig auto-detects via eth_chainId.
contracts:
  novelCore: "$NOVEL_CORE"
backend:
  host: 127.0.0.1
  port: $API_PORT
  databaseUrl: $DB_URL
  indexer:
    startBlock: 0
    pollIntervalMs: 1000
    confirmationBlocks: 0
    batchSize: 100
  keeper:
    pollIntervalMs: 10000
frontend:
  port: 3000
  backendUrl: http://127.0.0.1:$API_PORT
  allowedDevOrigins: []
cli:
  apiUrl: $API
EOF
export ONCHAIN_NOVEL_CONFIG="$SMOKE_CONFIG"

# -- Start backend --
info "Starting backend..."
VOTE_ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000001" \
node "$BACKEND_DIR/dist/index.js" > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

for i in $(seq 1 30); do
  if curl -sf "$API/health" > /dev/null 2>&1; then break; fi
  sleep 1
done
curl -sf "$API/health" > /dev/null 2>&1 || { fail "Backend not ready"; tail -20 "$BACKEND_LOG"; exit 1; }
pass "Backend running"

# CLI picks up ONCHAIN_NOVEL_CONFIG exported above. No separate config setup needed.
use_pk "$PK_CREATOR"
pass "CLI configured"

# =============================================================================
# CLI: novel create with new config flags
# =============================================================================

info "========================================="
info "novel create (protocol constants: 20x voter reward cap, 50% unreveal penalty)"
info "========================================="

CONTENT="A long enough genesis chapter so it passes the minChapterLength validation. Decentralized stories begin here, with many sentences and paragraphs to satisfy the minimum length floor."
CREATE_OUT=$(node_cli novel create \
  --title "Smoke Test Novel" \
  --description "CLI smoke" \
  --content "$CONTENT" \
  --submission-fee 0.005 \
  --vote-stake 0.005 \
  --world-lines 2 \
  --nomination-fee 0.001 \
  --nominate-duration 5 \
  --commit-duration 5 \
  --reveal-duration 5 \
  --min-round-gap 5 \
  --prize-release-rate 2000 \
  --voter-reward-rate 1500 \
  --rule-fee 0.001 \
  --value 0.1 2>&1 || true)
echo "$CREATE_OUT" | grep -q "Novel created successfully" && pass "novel create succeeded" || { fail "novel create"; echo "$CREATE_OUT"; }

wait_indexer 15 && pass "indexer caught up after create" || fail "indexer did not catch up"

# =============================================================================
# CLI: chapter submit (sanity)
# =============================================================================

info "========================================="
info "chapter submit"
info "========================================="

CHILD="A child chapter long enough to pass the minimum chapter length floor. Many words to make sure the byte count exceeds the configured minChapterLength of one hundred bytes."
use_pk "$PK_WRITER_A"
SUBMIT_OUT=$(node_cli chapter submit 1 1 --content "$CHILD" 2>&1)
echo "$SUBMIT_OUT" | grep -q "Chapter submitted" && pass "chapter submit succeeded" || { fail "chapter submit"; echo "$SUBMIT_OUT"; }

CHILD2="Branch B chapter, also longer than the minimum chapter length so the submission validates against the configured floor without complaining about declared length."
use_pk "$PK_WRITER_B"
node_cli chapter submit 1 1 --content "$CHILD2" > /dev/null && pass "second chapter submitted" || fail "second chapter submit"

wait_indexer 15 && pass "indexer caught up after submits" || fail "indexer did not catch up"

# =============================================================================
# CLI: chapter comment (off-chain EIP-191 signed)
# =============================================================================

info "========================================="
info "chapter comment + chapter comments"
info "========================================="

use_pk "$PK_VOTER_A"
COMMENT_OUT=$(node_cli chapter comment 2 "Great chapter, looking forward to more" 2>&1)
echo "$COMMENT_OUT" | grep -q "Comment posted" && pass "chapter comment posted" || { fail "chapter comment"; echo "$COMMENT_OUT"; }

LIST_OUT=$(node_cli chapter comments 2 2>&1)
echo "$LIST_OUT" | grep -q "Great chapter" && pass "chapter comments lists posted comment" || { fail "chapter comments missing"; echo "$LIST_OUT"; }

# =============================================================================
# CLI: vote commit with auto-salt + keeper-assisted reveal submission
# =============================================================================

info "========================================="
info "vote commit (auto-salt, keeper-assisted)"
info "========================================="

# Run a round so we can commit
use_pk "$PK_DEPLOYER"
cast rpc evm_increaseTime 10 --rpc-url "$RPC" > /dev/null
cast rpc evm_mine --rpc-url "$RPC" > /dev/null
node_cli vote start 1 2,3 > /dev/null && pass "vote start (round 1)" || fail "vote start"

cast rpc evm_increaseTime 10 --rpc-url "$RPC" > /dev/null
cast rpc evm_mine --rpc-url "$RPC" > /dev/null
node_cli vote close-nomination 1 > /dev/null && pass "close nomination" || fail "close nomination"

wait_indexer 15 || true

# Voter A commits with auto-generated salt (no salt arg)
use_pk "$PK_VOTER_A"
COMMIT_OUT=$(node_cli vote commit 1 2 2>&1)
echo "$COMMIT_OUT" | grep -q "Vote committed" && pass "vote commit accepted (auto-salt)" || { fail "vote commit"; echo "$COMMIT_OUT"; }
echo "$COMMIT_OUT" | grep -q "Salt saved" && pass "salt persisted to local backup" || fail "no local salt backup line"
echo "$COMMIT_OUT" | grep -q "Keeper will auto-reveal" && pass "keeper-assisted reveal submitted" || { fail "keeper submission missing"; echo "$COMMIT_OUT"; }

# Verify pending_votes row exists in the backend DB
PENDING_COUNT=$(psql -t -A -d "$DB_URL" -c "SELECT COUNT(*) FROM pending_votes WHERE novel_id = 1 AND round = 1 AND LOWER(voter) = LOWER('$ADDR_VOTER_A') AND status = 'committed'")
[ "$PENDING_COUNT" = "1" ] && pass "pending_votes row created" || fail "pending_votes row missing (count=$PENDING_COUNT)"

# vote reveal can pull salt from local backup (no salt arg)
cast rpc evm_increaseTime 10 --rpc-url "$RPC" > /dev/null
cast rpc evm_mine --rpc-url "$RPC" > /dev/null
use_pk "$PK_DEPLOYER"
node_cli vote close-commit 1 > /dev/null && pass "close commit" || fail "close commit"

use_pk "$PK_VOTER_A"
REVEAL_OUT=$(node_cli vote reveal 1 2 2>&1)
echo "$REVEAL_OUT" | grep -q "Vote revealed" && pass "vote reveal (salt from local backup)" || { fail "vote reveal"; echo "$REVEAL_OUT"; }

# =============================================================================
# CLI: new read commands (discover / status / context / user *)
# =============================================================================

info "========================================="
info "new agent-facing read commands"
info "========================================="

wait_indexer 10 || true

use_pk "$PK_VOTER_A"

# chapter context: should print ancestor chain
CTX_OUT=$(node_cli chapter context 2 --summary 2>&1)
echo "$CTX_OUT" | grep -q "Context for Chapter" && pass "chapter context prints header" || { fail "chapter context"; echo "$CTX_OUT"; }

# vote status: reports this voter's on-chain + local backup state
STATUS_OUT=$(node_cli vote status 1 2>&1)
echo "$STATUS_OUT" | grep -q "Vote Status" && pass "vote status renders" || { fail "vote status"; echo "$STATUS_OUT"; }

# vote discover: should run without error even if no committing novel remains
DISC_OUT=$(node_cli vote discover 2>&1)
echo "$DISC_OUT" | grep -q "Voting Opportunities" && pass "vote discover renders" || { fail "vote discover"; echo "$DISC_OUT"; }

# user votes / rewards / chapters: wired to backend
UVOTES_OUT=$(node_cli user votes 2>&1)
echo "$UVOTES_OUT" | grep -q "Votes" && pass "user votes renders" || { fail "user votes"; echo "$UVOTES_OUT"; }

UREW_OUT=$(node_cli user rewards 2>&1)
echo "$UREW_OUT" | grep -q "Rewards" && pass "user rewards renders" || { fail "user rewards"; echo "$UREW_OUT"; }

use_pk "$PK_WRITER_A"
UCH_OUT=$(node_cli user chapters 2>&1)
echo "$UCH_OUT" | grep -q "Chapters" && pass "user chapters renders" || { fail "user chapters"; echo "$UCH_OUT"; }

# Secret hygiene: the `config set` command is gone. `config` is read-only now.
# Verify `config` prints something without requiring a private key.
use_pk ""   # clear
CFG_OUT=$(node_cli config 2>&1 || true)
echo "$CFG_OUT" | grep -q "chain.rpcUrl" && pass "config displays loaded yaml" || { fail "config should show loaded yaml"; echo "$CFG_OUT"; }

# Secret hygiene: the CLI bundle must never embed PRIVATE_KEY.
if grep -E "PRIVATE_KEY:\s*privateKey|PRIVATE_KEY:\s*process\." "$CLI_DIR/dist/onchain-novel-cli.js" > /dev/null 2>&1; then
  fail "bundle embeds PRIVATE_KEY"
else
  pass "bundle does not embed PRIVATE_KEY"
fi

# =============================================================================
# RESULTS
# =============================================================================

echo ""
info "========================================="
if [ $FAIL_COUNT -eq 0 ]; then
  echo -e "${GREEN}All $PASS_COUNT smoke checks passed${NC}"
else
  echo -e "${RED}$FAIL_COUNT failed${NC}, ${GREEN}$PASS_COUNT passed${NC}"
  exit 1
fi
