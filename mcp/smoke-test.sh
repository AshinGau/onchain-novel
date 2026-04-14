#!/usr/bin/env bash
# =============================================================================
# MCP Tool Smoke Test
#
# Spins up isolated anvil + contracts + backend, then runs smoke-mcp-tools.ts
# which spawns the MCP server in stdio mode and exercises the tool layer.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MCP_DIR="$ROOT_DIR/mcp"
BACKEND_DIR="$ROOT_DIR/web/backend"
cd "$ROOT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

RPC_PORT="${SMOKE_RPC_PORT:-8846}"
RPC="http://localhost:${RPC_PORT}"
API_PORT="${SMOKE_API_PORT:-3903}"
API="http://localhost:${API_PORT}"
DB_NAME="onchain_novel_mcp_smoke"
DB_URL="postgresql://localhost:5432/$DB_NAME"

# Anvil deterministic accounts
PK_DEPLOYER="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
PK_CREATOR="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
PK_WRITER_A="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
PK_VOTER_A="0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"
PK_KEEPER="0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"

ANVIL_PID=""
BACKEND_PID=""
BACKEND_LOG="/tmp/mcp-smoke-backend-$(date +%s).log"

cleanup() {
  info "Cleaning up..."
  if [ -n "${BACKEND_PID:-}" ]; then kill $BACKEND_PID 2>/dev/null || true; fi
  if [ -n "${ANVIL_PID:-}" ]; then kill $ANVIL_PID 2>/dev/null || true; fi
  wait $BACKEND_PID 2>/dev/null || true
  wait $ANVIL_PID 2>/dev/null || true
  dropdb --if-exists "$DB_NAME" 2>/dev/null || true
}
trap cleanup EXIT

info "========================================="
info "MCP Tool Smoke Test"
info "========================================="

for cmd in anvil cast forge node npx jq curl createdb dropdb psql; do
  command -v "$cmd" >/dev/null 2>&1 || { fail "Missing $cmd"; exit 1; }
done
pass "Dependencies present"

# Build MCP and backend
info "Building MCP..."
(cd "$MCP_DIR" && npm run build > /dev/null)
pass "MCP built"

# Start anvil
info "Starting anvil on $RPC_PORT..."
anvil --port "$RPC_PORT" --block-time 1 --silent &
ANVIL_PID=$!
sleep 2
cast block-number --rpc-url "$RPC" >/dev/null 2>&1 || { fail "Anvil unreachable"; exit 1; }
pass "Anvil running"

# DB
info "Setting up DB $DB_NAME..."
dropdb --if-exists "$DB_NAME" 2>/dev/null || true
createdb "$DB_NAME"
for f in "$BACKEND_DIR"/migrations/*.sql; do
  psql -q "$DB_URL" < "$f" > /dev/null
done
pass "DB ready"

# Deploy contracts
info "Deploying contracts..."
DEPLOY_LOG="/tmp/mcp-smoke-deploy-$(date +%s).log"
PRIVATE_KEY="$PK_DEPLOYER" forge script script/Deploy.s.sol \
  --rpc-url "$RPC" --broadcast > "$DEPLOY_LOG" 2>&1
BROADCAST_JSON="broadcast/Deploy.s.sol/31337/run-latest.json"
[ -f "$BROADCAST_JSON" ] || { fail "Broadcast file missing"; tail -20 "$DEPLOY_LOG"; exit 1; }

CREATES=$(jq -r '[.transactions[] | select(.transactionType == "CREATE") | .contractAddress] | .[]' "$BROADCAST_JSON")
CREATES_ARR=($CREATES)
VOTING_ENGINE="${CREATES_ARR[5]}"
PRIZE_POOL="${CREATES_ARR[6]}"
RULES_ENGINE="${CREATES_ARR[7]}"
NOVEL_CORE="${CREATES_ARR[8]}"
BOUNTY_BOARD="${CREATES_ARR[9]}"
pass "Contracts deployed (NovelCore=$NOVEL_CORE)"

# Start backend
info "Starting backend on $API_PORT..."
DATABASE_URL="$DB_URL" \
RPC_URL="$RPC" \
NOVEL_CORE_ADDRESS="$NOVEL_CORE" \
VOTING_ENGINE_ADDRESS="$VOTING_ENGINE" \
PRIZE_POOL_ADDRESS="$PRIZE_POOL" \
BOUNTY_BOARD_ADDRESS="$BOUNTY_BOARD" \
RULES_ENGINE_ADDRESS="$RULES_ENGINE" \
INDEXER_START_BLOCK=0 \
INDEXER_BATCH_SIZE=100 \
INDEXER_POLL_INTERVAL_MS=1000 \
INDEXER_CONFIRMATION_BLOCKS=0 \
PORT=$API_PORT \
VOTE_ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000001" \
node "$BACKEND_DIR/dist/index.js" > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

for i in $(seq 1 30); do
  if curl -sf "$API/health" > /dev/null 2>&1; then break; fi
  sleep 1
done
curl -sf "$API/health" > /dev/null 2>&1 || { fail "Backend not ready"; tail -30 "$BACKEND_LOG"; exit 1; }
pass "Backend running"

# Run the MCP tool smoke test
info "Running smoke-mcp-tools.ts..."
RPC_URL="$RPC" \
NOVEL_CORE_ADDRESS="$NOVEL_CORE" \
VOTING_ENGINE_ADDRESS="$VOTING_ENGINE" \
PRIZE_POOL_ADDRESS="$PRIZE_POOL" \
BOUNTY_BOARD_ADDRESS="$BOUNTY_BOARD" \
RULES_ENGINE_ADDRESS="$RULES_ENGINE" \
API_BASE_URL="$API" \
DATABASE_URL="$DB_URL" \
PK_CREATOR="$PK_CREATOR" \
PK_WRITER_A="$PK_WRITER_A" \
PK_VOTER_A="$PK_VOTER_A" \
PK_KEEPER="$PK_KEEPER" \
npx tsx "$MCP_DIR/smoke-mcp-tools.ts"
RESULT=$?

if [ $RESULT -eq 0 ]; then
  echo ""
  echo -e "${GREEN}MCP smoke test passed${NC}"
else
  echo ""
  echo -e "${RED}MCP smoke test failed${NC}"
  info "=== Backend tail ==="
  tail -30 "$BACKEND_LOG" || true
  exit 1
fi
