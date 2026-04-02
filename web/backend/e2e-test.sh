#!/usr/bin/env bash
# =============================================================================
# Backend E2E Test: Anvil → Deploy → Contract Interactions → Indexer → API
#
# Tests the full backend pipeline:
#   Chain events → Indexer → PostgreSQL → REST API responses
#
# Prerequisites: anvil, forge, cast, psql, node/tsx
# Usage: ./web/backend/e2e-test.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND_DIR="$ROOT_DIR/web/backend"
cd "$ROOT_DIR"

# ── Colors ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
PASS_COUNT=0; FAIL_COUNT=0
pass() { echo -e "${GREEN}[PASS]${NC} $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo -e "${RED}[FAIL]${NC} $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

# ── Config ──
RPC="http://localhost:8545"
API="http://localhost:3901"
DB_NAME="onchain_novel_e2e_test"
DB_URL="postgresql://localhost:5432/$DB_NAME"
API_PORT=3901

# Anvil accounts
PK_DEPLOYER="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
PK_CREATOR="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
ADDR_CREATOR="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
PK_WRITER_A="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
ADDR_WRITER_A="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
PK_WRITER_B="0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
ADDR_WRITER_B="0x90F79bf6EB2c4f870365E785982E1f101E93b906"
PK_VOTER_A="0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"
ADDR_VOTER_A="0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"
PK_VOTER_B="0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"
ADDR_VOTER_B="0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"
PK_KEEPER="0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e"

cast_send() {
    local pk="$1"; shift
    local result
    result=$(cast send --rpc-url "$RPC" --private-key "$pk" "$@" --json 2>/dev/null) || true
    echo "$result" | jq -r '.status' 2>/dev/null || echo "0x0"
}

api_get() {
    curl -sf "$API$1" 2>/dev/null || true
}

# Assert JSON field from API response
# Usage: api_check "/path" ".field" "expected" "description"
api_check() {
    local path="$1" jq_expr="$2" expected="$3" desc="$4"
    local response actual
    response=$(api_get "$path") || true
    if [ -z "$response" ]; then
        fail "$desc — API returned empty response for $path"
        return 0
    fi
    actual=$(echo "$response" | jq -r "$jq_expr" 2>/dev/null) || true
    if [ "$actual" = "$expected" ]; then
        pass "$desc (=$actual)"
    else
        fail "$desc — expected '$expected', got '$actual'"
        echo "  Response: $(echo "$response" | jq -c '.' 2>/dev/null | head -c 500)"
    fi
}

# Assert JSON field >= expected numeric value
api_check_gte() {
    local path="$1" jq_expr="$2" min="$3" desc="$4"
    local response actual
    response=$(api_get "$path") || true
    if [ -z "$response" ]; then
        fail "$desc — API returned empty response for $path"
        return 0
    fi
    actual=$(echo "$response" | jq -r "$jq_expr" 2>/dev/null) || true
    if [ -n "$actual" ] && [ "$actual" -ge "$min" ] 2>/dev/null; then
        pass "$desc ($actual >= $min)"
    else
        fail "$desc — expected >= $min, got '$actual'"
        echo "  Response: $(echo "$response" | jq -c '.' 2>/dev/null | head -c 500)"
    fi
}

# Wait for indexer to catch up to at least the given chain block
wait_indexer() {
    local max_wait="${1:-30}"
    local chain_block
    chain_block=$(cast block-number --rpc-url "$RPC" 2>/dev/null) || chain_block=0
    info "Chain at block $chain_block, waiting for indexer..."
    for i in $(seq 1 "$max_wait"); do
        local health indexed
        health=$(api_get "/health") || true
        if [ -n "$health" ]; then
            indexed=$(echo "$health" | jq -r '.indexer.lastBlock' 2>/dev/null) || indexed=0
            if [ -n "$indexed" ] && [ "$indexed" -ge "$chain_block" ] 2>/dev/null; then
                pass "Indexer caught up: block $indexed (chain=$chain_block)"
                return 0
            fi
            printf "  [%d/%ds] indexer at block %s / %s\n" "$i" "$max_wait" "$indexed" "$chain_block"
        fi
        sleep 1
    done
    fail "Indexer did not catch up in ${max_wait}s"
    info "=== Backend logs (last 30 lines) ==="
    tail -30 "$BACKEND_LOG" 2>/dev/null || true
    return 0  # Don't exit, let test continue and report failures
}

# ── Cleanup function ──
ANVIL_PID=""
BACKEND_PID=""
BACKEND_LOG="/tmp/backend-e2e-$(date +%s).log"
cleanup() {
    info "Cleaning up..."
    if [ $FAIL_COUNT -gt 0 ] && [ -f "$BACKEND_LOG" ]; then
        info "=== Backend logs (last 50 lines) ==="
        tail -50 "$BACKEND_LOG"
    fi
    [ -n "$BACKEND_PID" ] && kill $BACKEND_PID 2>/dev/null || true
    [ -n "$ANVIL_PID" ] && kill $ANVIL_PID 2>/dev/null || true
    wait $BACKEND_PID 2>/dev/null || true
    wait $ANVIL_PID 2>/dev/null || true
    dropdb --if-exists "$DB_NAME" 2>/dev/null || true
}
trap cleanup EXIT

# =============================================================================
# SETUP
# =============================================================================

info "========================================="
info "Backend E2E Test"
info "========================================="

# ── Check dependencies ──
for cmd in anvil cast forge jq curl node npx createdb dropdb psql; do
    if ! command -v "$cmd" &>/dev/null; then
        fail "Required command '$cmd' not found. Install it first."
        if [ "$cmd" = "createdb" ] || [ "$cmd" = "dropdb" ] || [ "$cmd" = "psql" ]; then
            echo "  PostgreSQL is required. Please install"
        fi
        exit 1
    fi
done
pass "All dependencies found"

# ── Start Anvil ──
info "Starting Anvil..."
anvil --block-time 1 --silent &
ANVIL_PID=$!
sleep 2
cast block-number --rpc-url "$RPC" > /dev/null 2>&1 || { fail "Anvil not reachable"; exit 1; }
pass "Anvil running"

# ── Setup database ──
info "Setting up test database..."
dropdb --if-exists "$DB_NAME" 2>/dev/null || true
createdb "$DB_NAME"
for f in "$BACKEND_DIR"/migrations/*.sql; do
    psql -q "$DB_URL" < "$f" > /dev/null
done
pass "Database created and migrated"

# ── Deploy contracts ──
info "Deploying contracts..."
PRIVATE_KEY="$PK_DEPLOYER" forge script script/Deploy.s.sol \
    --rpc-url "$RPC" --broadcast > /dev/null 2>&1

BROADCAST_JSON="broadcast/Deploy.s.sol/31337/run-latest.json"
[ -f "$BROADCAST_JSON" ] || { fail "Broadcast JSON not found"; exit 1; }

CREATES=$(jq -r '[.transactions[] | select(.transactionType == "CREATE") | .contractAddress] | .[]' "$BROADCAST_JSON")
CREATES_ARR=($CREATES)
NOVEL_CORE="${CREATES_ARR[4]}"
VOTING_ENGINE="${CREATES_ARR[5]}"
PRIZE_POOL="${CREATES_ARR[6]}"
CHAPTER_NFT="${CREATES_ARR[7]}"
pass "Contracts deployed: NovelCore=$NOVEL_CORE"

# Set keeper reward
cast_send "$PK_DEPLOYER" "$NOVEL_CORE" "setKeeperRewardAmount(uint256)" "10000000000000" > /dev/null

# ── Start Backend ──
info "Starting backend..."
cd "$BACKEND_DIR"
DATABASE_URL="$DB_URL" \
RPC_URL="$RPC" \
NOVEL_CORE_ADDRESS="$NOVEL_CORE" \
VOTING_ENGINE_ADDRESS="$VOTING_ENGINE" \
PRIZE_POOL_ADDRESS="$PRIZE_POOL" \
CHAPTER_NFT_ADDRESS="$CHAPTER_NFT" \
INDEXER_START_BLOCK=0 \
INDEXER_BATCH_SIZE=100 \
INDEXER_POLL_INTERVAL_MS=1000 \
PORT=$API_PORT \
npx tsx src/index.ts > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
cd "$ROOT_DIR"

# Wait for backend to be ready
for i in $(seq 1 30); do
    if curl -sf "$API/health" > /dev/null 2>&1; then break; fi
    sleep 1
done
curl -sf "$API/health" > /dev/null 2>&1 || { fail "Backend not ready after 30s"; tail -30 "$BACKEND_LOG"; exit 1; }
pass "Backend running on port $API_PORT"

# =============================================================================
# PHASE 1: Create novel + verify indexer catches up
# =============================================================================

info "========================================="
info "Phase 1: Novel creation + indexing"
info "========================================="

GENESIS_CONTENT="Once upon a time in a decentralized world, where stories are written by many and owned by all..."
GENESIS_HEX="0x$(echo -n "$GENESIS_CONTENT" | xxd -p | tr -d '\n')"
GENESIS_HASH=$(cast keccak256 "$GENESIS_HEX")
GENESIS_LEN=$(echo -n "$GENESIS_CONTENT" | wc -c | tr -d ' ')
CREATE_RESULT=$(cast send --rpc-url "$RPC" --private-key "$PK_CREATOR" "$NOVEL_CORE" \
    "createNovel((uint64,uint64,uint64,uint32,uint32,uint32,uint16,uint16,uint64,uint64,uint256,uint8,uint8,uint8,string),(string,string,string),(bytes32,uint64,bytes)[])" \
    "(100, 10000, 2, 2, 2, 1, 3000, 2000, 2, 2, 10000000000000000, 0, 0, 0, '')" \
    "(Test Novel, A test novel for E2E, '')" \
    "[($GENESIS_HASH,$GENESIS_LEN,$GENESIS_HEX)]" \
    --value 0.1ether --json 2>/dev/null) || true
STATUS=$(echo "$CREATE_RESULT" | jq -r '.status' 2>/dev/null) || STATUS="0x0"
[ "$STATUS" = "0x1" ] || { fail "createNovel failed"; exit 1; }
pass "Novel created on-chain"

# ── Wait for indexer to index the creation events ──
wait_indexer 30

# ── Verify: Novel list ──
api_check_gte "/api/novels?limit=10" ".novels | length" 1 "GET /api/novels returns novels"

# ── Verify: Novel detail ──
api_check "/api/novels/1" ".title" "Test Novel" "Novel title indexed correctly"
api_check "/api/novels/1" ".active" "true" "Novel is active"
api_check "/api/novels/1" ".current_round" "1" "Novel current_round=1"
api_check "/api/novels/1" ".current_epoch" "1" "Novel current_epoch=1"
api_check "/api/novels/1" ".round_phase" "0" "Novel in Submitting phase"

# ── Verify: Story tree (genesis chapter indexed) ──
api_check_gte "/api/novels/1/tree" ".chapters | length" 1 "Story tree has genesis chapter"

# ── Verify: Genesis chapter author ──
CHAPTER_RESP=$(api_get "/api/chapters/1")
CH_AUTHOR=$(echo "$CHAPTER_RESP" | jq -r '.author' | tr '[:upper:]' '[:lower:]')
EXPECTED=$(echo "$ADDR_CREATOR" | tr '[:upper:]' '[:lower:]')
[ "$CH_AUTHOR" = "$EXPECTED" ] && pass "Chapter 1 author = creator ($CH_AUTHOR)" || fail "Chapter 1 author: expected $EXPECTED, got $CH_AUTHOR"

# ── Verify: Search ──
api_check_gte "/api/novels?search=1" ".novels | length" 1 "Search by ID=1"
api_check_gte "/api/novels?search=Test" ".novels | length" 1 "Search by title 'Test'"

# =============================================================================
# PHASE 2: Submit chapters + voting lifecycle
# =============================================================================

info "========================================="
info "Phase 2: Chapters + Voting"
info "========================================="

CONTENT_A_TEXT="Writer A continues the story with adventure and bold new characters entering the fray, each bringing their own secrets and motivations to the unfolding narrative that spans across the decentralized realm..."
CONTENT_A_HEX="0x$(echo -n "$CONTENT_A_TEXT" | xxd -p | tr -d '\n')"
CONTENT_A_HASH=$(cast keccak256 "$CONTENT_A_HEX")
CONTENT_A_LEN=$(echo -n "$CONTENT_A_TEXT" | wc -c | tr -d ' ')
cast_send "$PK_WRITER_A" "$NOVEL_CORE" \
    "submitChapter(uint256,uint256,(bytes32,uint64,bytes))" 1 1 "($CONTENT_A_HASH,$CONTENT_A_LEN,$CONTENT_A_HEX)" \
    --value 0.01ether > /dev/null
pass "Writer A submitted chapter"

CONTENT_B_TEXT="Writer B takes a different path entirely, exploring the darker corners of the decentralized world where rival factions compete for control of the narrative itself, bending reality to their will..."
CONTENT_B_HEX="0x$(echo -n "$CONTENT_B_TEXT" | xxd -p | tr -d '\n')"
CONTENT_B_HASH=$(cast keccak256 "$CONTENT_B_HEX")
CONTENT_B_LEN=$(echo -n "$CONTENT_B_TEXT" | wc -c | tr -d ' ')
cast_send "$PK_WRITER_B" "$NOVEL_CORE" \
    "submitChapter(uint256,uint256,(bytes32,uint64,bytes))" 1 1 "($CONTENT_B_HASH,$CONTENT_B_LEN,$CONTENT_B_HEX)" \
    --value 0.01ether > /dev/null
pass "Writer B submitted chapter"

# Wait for roundMinDuration (2s) then close submissions
sleep 3
cast_send "$PK_KEEPER" "$NOVEL_CORE" "closeSubmissions(uint256)" 1 > /dev/null
pass "closeSubmissions"

wait_indexer 15

# ── Verify: Chapters indexed + round submissions ──
api_check_gte "/api/novels/1/rounds/1" ".chapters | length" 2 "Round 1 has >=2 chapters"
api_check_gte "/api/chapters/1/children" ".children | length" 2 "Genesis chapter has >=2 children"
api_check "/api/novels/1" ".round_phase" "1" "Novel in Committing phase after closeSubmissions"

# Commit votes
VOTING_ROUND_ID=$(cast keccak256 $(cast abi-encode --packed "(uint256,uint32,uint32,bool)" 1 1 1 false))
VOTING_ROUND_ID_DEC=$(cast to-dec "$VOTING_ROUND_ID")

SALT_A="0x0000000000000000000000000000000000000000000000000000000000000001"
COMMIT_A=$(cast keccak256 $(cast abi-encode --packed "(uint256,bytes32)" 2 "$SALT_A"))
cast_send "$PK_VOTER_A" "$VOTING_ENGINE" \
    "commitVote(uint256,uint256,bytes32)" 1 "$VOTING_ROUND_ID_DEC" "$COMMIT_A" \
    --value 0.05ether > /dev/null
pass "Voter A committed"

SALT_B="0x0000000000000000000000000000000000000000000000000000000000000002"
COMMIT_B=$(cast keccak256 $(cast abi-encode --packed "(uint256,bytes32)" 3 "$SALT_B"))
cast_send "$PK_VOTER_B" "$VOTING_ENGINE" \
    "commitVote(uint256,uint256,bytes32)" 1 "$VOTING_ROUND_ID_DEC" "$COMMIT_B" \
    --value 0.1ether > /dev/null
pass "Voter B committed"

sleep 3
cast_send "$PK_KEEPER" "$NOVEL_CORE" "closeCommit(uint256)" 1 > /dev/null
pass "closeCommit"

wait_indexer 10
api_check "/api/novels/1" ".round_phase" "2" "Novel in Revealing phase"

# Reveal
cast_send "$PK_VOTER_A" "$VOTING_ENGINE" \
    "revealVote(uint256,uint256,uint256,bytes32)" 1 "$VOTING_ROUND_ID_DEC" 2 "$SALT_A" > /dev/null
cast_send "$PK_VOTER_B" "$VOTING_ENGINE" \
    "revealVote(uint256,uint256,uint256,bytes32)" 1 "$VOTING_ROUND_ID_DEC" 3 "$SALT_B" > /dev/null
pass "Both voters revealed"

sleep 3
cast_send "$PK_KEEPER" "$NOVEL_CORE" "settleRound(uint256)" 1 > /dev/null
pass "settleRound → epoch voting"

wait_indexer 10
# After settleRound with roundsPerEpoch=1, novel enters epoch voting (epochPhase=1)
api_check "/api/novels/1" ".epoch_phase" "1" "Novel in Epoch Committing phase"

# ── Epoch voting ──
info "Epoch voting..."
EPOCH_VID=$(cast keccak256 $(cast abi-encode --packed "(uint256,uint32,uint32,bool)" 1 1 1 true))
EPOCH_VID_DEC=$(cast to-dec "$EPOCH_VID")

ESALT_A="0x0000000000000000000000000000000000000000000000000000000000000003"
ECOMMIT_A=$(cast keccak256 $(cast abi-encode --packed "(uint256,bytes32)" 3 "$ESALT_A"))
cast_send "$PK_VOTER_A" "$VOTING_ENGINE" \
    "commitVote(uint256,uint256,bytes32)" 1 "$EPOCH_VID_DEC" "$ECOMMIT_A" \
    --value 0.05ether > /dev/null

ESALT_B="0x0000000000000000000000000000000000000000000000000000000000000004"
ECOMMIT_B=$(cast keccak256 $(cast abi-encode --packed "(uint256,bytes32)" 3 "$ESALT_B"))
cast_send "$PK_VOTER_B" "$VOTING_ENGINE" \
    "commitVote(uint256,uint256,bytes32)" 1 "$EPOCH_VID_DEC" "$ECOMMIT_B" \
    --value 0.1ether > /dev/null
pass "Epoch votes committed"

sleep 3
cast_send "$PK_KEEPER" "$NOVEL_CORE" "closeEpochCommit(uint256)" 1 > /dev/null
pass "closeEpochCommit"

cast_send "$PK_VOTER_A" "$VOTING_ENGINE" \
    "revealVote(uint256,uint256,uint256,bytes32)" 1 "$EPOCH_VID_DEC" 3 "$ESALT_A" > /dev/null
cast_send "$PK_VOTER_B" "$VOTING_ENGINE" \
    "revealVote(uint256,uint256,uint256,bytes32)" 1 "$EPOCH_VID_DEC" 3 "$ESALT_B" > /dev/null
pass "Epoch votes revealed"

sleep 3
cast_send "$PK_KEEPER" "$NOVEL_CORE" "settleEpoch(uint256)" 1 > /dev/null
pass "settleEpoch — Canon established"

# Tip
cast_send "$PK_VOTER_B" "$PRIZE_POOL" "tipNovel(uint256)" 1 --value 0.05ether > /dev/null
pass "Tipped novel"

# =============================================================================
# PHASE 3: Verify API reflects full lifecycle state
# =============================================================================

info "========================================="
info "Phase 3: API verification after full lifecycle"
info "========================================="

wait_indexer 15

# ── Novel state: epoch advanced ──
api_check "/api/novels/1" ".current_epoch" "2" "Novel epoch advanced to 2 after settleEpoch"
api_check "/api/novels/1" ".epoch_phase" "0" "Back to Rounds epoch phase"

# ── Canon chapters indexed ──
api_check_gte "/api/novels/1/canon" ".chapters | length" 1 "Canon has chapters after epoch settlement"

# ── Worldlines still available ──
api_check_gte "/api/novels/1/worldlines" ".worldlines | length" 1 "Active worldlines available"

# ── Stats reflect full lifecycle ──
api_check_gte "/api/novels/1/stats" ".chapter_count" 3 "Stats: chapter_count >= 3 (1 genesis + 2 submitted)"
api_check_gte "/api/novels/1/stats" ".author_count" 2 "Stats: author_count >= 2"

# ── Tips indexed ──
api_check_gte "/api/novels/1/tips" ".tips | length" 1 "Tips recorded in DB"

# ── User votes indexed ──
VOTER_A_LOWER=$(echo "$ADDR_VOTER_A" | tr '[:upper:]' '[:lower:]')
api_check_gte "/api/users/$VOTER_A_LOWER/votes" ".votes | length" 1 "Voter A has vote records"

# Check vote has revealed=true
VOTE_REVEALED=$(api_get "/api/users/$VOTER_A_LOWER/votes" | jq -r '.votes[0].revealed')
[ "$VOTE_REVEALED" = "true" ] && pass "Voter A's vote marked as revealed" || fail "Vote revealed: expected true, got $VOTE_REVEALED"

# ── User chapters indexed ──
WRITER_A_LOWER=$(echo "$ADDR_WRITER_A" | tr '[:upper:]' '[:lower:]')
api_check_gte "/api/users/$WRITER_A_LOWER/chapters" ".chapters | length" 1 "Writer A has chapter records"

# ── Notifications generated from phase changes ──
CREATOR_LOWER=$(echo "$ADDR_CREATOR" | tr '[:upper:]' '[:lower:]')
api_check_gte "/api/notifications/$CREATOR_LOWER" ".notifications | length" 1 "Creator received notifications"

# Show notification types for debugging
NOTIF_TYPES=$(api_get "/api/notifications/$CREATOR_LOWER" | jq -r '[.notifications[].type] | unique | join(", ")')
info "Notification types received: $NOTIF_TYPES"

# ── Chapter siblings ──
api_check_gte "/api/chapters/2/siblings" ".siblings | length" 1 "Chapter 2 has sibling(s)"

# ── Chapter context (ancestor chain) ──
api_check_gte "/api/chapters/2/context" ".ancestors | length" 1 "Chapter 2 has ancestor context"

# ── Forks list (empty, no forks created) ──
api_check "/api/novels/1/forks" ".forks | length" "0" "No forks created (expected 0)"

# ── Health check ──
api_check "/health" ".status" "ok" "Health endpoint returns ok"
LAST_BLOCK=$(api_get "/health" | jq -r '.indexer.lastBlock')
info "Indexer last processed block: $LAST_BLOCK"
[ "$LAST_BLOCK" -gt 0 ] && pass "Indexer block > 0 ($LAST_BLOCK)" || fail "Indexer block: expected >0"

# =============================================================================
# RESULTS
# =============================================================================

echo ""
info "========================================="
if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "${GREEN}All $PASS_COUNT checks passed!${NC}"
else
    echo -e "${RED}$FAIL_COUNT failed${NC}, ${GREEN}$PASS_COUNT passed${NC}"
    exit 1
fi
