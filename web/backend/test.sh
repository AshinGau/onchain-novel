#!/usr/bin/env bash
# =============================================================================
# Backend E2E Test (Protocol): Anvil -> Deploy -> Contract Interactions -> Indexer -> API
#
# Tests the full backend pipeline:
#   Chain events -> Indexer -> PostgreSQL -> REST API responses
#
# Prerequisites: anvil, forge, cast, psql, node/tsx
# Usage: ./web/backend/test.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND_DIR="$ROOT_DIR/web/backend"
cd "$ROOT_DIR"

# -- Colors --
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
PASS_COUNT=0; FAIL_COUNT=0
pass() { echo -e "${GREEN}[PASS]${NC} $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo -e "${RED}[FAIL]${NC} $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

# -- Config --
# Use a non-default port so the e2e test never collides with a dev anvil on 8545.
RPC_PORT="${E2E_RPC_PORT:-8646}"
RPC="http://localhost:${RPC_PORT}"
API_PORT="${E2E_API_PORT:-3901}"
API="http://localhost:${API_PORT}"
DB_NAME="onchain_novel_e2e_test"
DB_URL="postgresql://localhost:5432/$DB_NAME"

# Anvil accounts (deterministic mnemonic)
PK_DEPLOYER="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ADDR_DEPLOYER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
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
PK_TIPPER="0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e"
ADDR_TIPPER="0x976EA74026E726554dB657fA54763abd0C3a0aa9"
PK_FORKER="0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356"
ADDR_FORKER="0x14dC79964da2C08b23698B3D3cc7Ca32193d9955"

cast_send() {
    local pk="$1"; shift
    local result
    result=$(cast send --rpc-url "$RPC" --private-key "$pk" "$@" --json 2>/dev/null) || true
    echo "$result" | jq -r '.status' 2>/dev/null || echo "0x0"
}

cast_send_full() {
    local pk="$1"; shift
    cast send --rpc-url "$RPC" --private-key "$pk" "$@" --json 2>/dev/null || echo '{}'
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
        fail "$desc -- API returned empty response for $path"
        return 0
    fi
    actual=$(echo "$response" | jq -r "$jq_expr" 2>/dev/null) || true
    if [ "$actual" = "$expected" ]; then
        pass "$desc (=$actual)"
    else
        fail "$desc -- expected '$expected', got '$actual'"
        echo "  Response: $(echo "$response" | jq -c '.' 2>/dev/null | head -c 500)"
    fi
}

# Assert JSON field >= expected numeric value
api_check_gte() {
    local path="$1" jq_expr="$2" min="$3" desc="$4"
    local response actual
    response=$(api_get "$path") || true
    if [ -z "$response" ]; then
        fail "$desc -- API returned empty response for $path"
        return 0
    fi
    actual=$(echo "$response" | jq -r "$jq_expr" 2>/dev/null) || true
    if [ -n "$actual" ] && [ "$actual" -ge "$min" ] 2>/dev/null; then
        pass "$desc ($actual >= $min)"
    else
        fail "$desc -- expected >= $min, got '$actual'"
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

# Advance Anvil time deterministically (no sleeps needed)
advance_time() {
    local seconds="$1"
    cast rpc evm_increaseTime "$seconds" --rpc-url "$RPC" > /dev/null 2>&1
    cast rpc evm_mine --rpc-url "$RPC" > /dev/null 2>&1
}

# -- Cleanup function --
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
info "Backend E2E Test (Protocol)"
info "========================================="

# -- Check dependencies --
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

# -- Start Anvil --
info "Starting Anvil on port ${RPC_PORT}..."
anvil --port "$RPC_PORT" --block-time 1 --silent &
ANVIL_PID=$!
sleep 2
cast block-number --rpc-url "$RPC" > /dev/null 2>&1 || { fail "Anvil not reachable"; exit 1; }
pass "Anvil running"

# -- Setup database --
info "Setting up test database..."
dropdb --if-exists "$DB_NAME" 2>/dev/null || true
createdb "$DB_NAME"
for f in "$BACKEND_DIR"/migrations/*.sql; do
    psql -q "$DB_URL" < "$f" > /dev/null
done
pass "Database created and migrated"

# =============================================================================
# PHASE 1: Deploy contracts + Create novel + Verify indexer
# =============================================================================

info "========================================="
info "Phase 1: Deploy + Novel Creation + Indexing"
info "========================================="

# -- Deploy contracts --
info "Deploying contracts..."
DEPLOY_LOG="/tmp/e2e-deploy-$(date +%s).log"
PRIVATE_KEY="$PK_DEPLOYER" forge script scripts/Deploy.s.sol \
    --rpc-url "$RPC" --broadcast > "$DEPLOY_LOG" 2>&1

BROADCAST_JSON="broadcast/Deploy.s.sol/31337/run-latest.json"
if [ ! -f "$BROADCAST_JSON" ]; then
    fail "Broadcast JSON not found"
    info "=== Deploy log ==="
    tail -40 "$DEPLOY_LOG" || true
    exit 1
fi

# Parse proxy addresses from CREATE order:
#  [0] NovelCore impl, [1] VotingEngine impl, [2] PrizePool impl,
#  [3] RulesEngine impl, [4] BountyBoard impl,
#  [5] VotingEngine proxy, [6] PrizePool proxy, [7] RulesEngine proxy,
#  [8] NovelCore proxy, [9] BountyBoard proxy
CREATES=$(jq -r '[.transactions[] | select(.transactionType == "CREATE") | .contractAddress] | .[]' "$BROADCAST_JSON")
CREATES_ARR=($CREATES)
VOTING_ENGINE="${CREATES_ARR[6]}"
PRIZE_POOL="${CREATES_ARR[7]}"
RULES_ENGINE="${CREATES_ARR[8]}"
NOVEL_CORE="${CREATES_ARR[9]}"
BOUNTY_BOARD="${CREATES_ARR[10]}"
ROUND_MANAGER="${CREATES_ARR[11]}"
USER_REGISTRY="${CREATES_ARR[12]}"
pass "Contracts deployed: NovelCore=$NOVEL_CORE, RoundManager=$ROUND_MANAGER, PrizePool=$PRIZE_POOL, BountyBoard=$BOUNTY_BOARD"

# Set keeper reward on PrizePool (NOT NovelCore!)
STATUS=$(cast_send "$PK_DEPLOYER" "$PRIZE_POOL" "setKeeperRewardAmount(uint256)" "10000000000000")
[ "$STATUS" = "0x1" ] && pass "Keeper reward set on PrizePool" || fail "setKeeperRewardAmount failed"

# -- Start Backend --
info "Starting backend..."
cd "$BACKEND_DIR"
DATABASE_URL="$DB_URL" \
RPC_URL="$RPC" \
NOVEL_CORE_ADDRESS="$NOVEL_CORE" \
ROUND_MANAGER_ADDRESS="$ROUND_MANAGER" \
VOTING_ENGINE_ADDRESS="$VOTING_ENGINE" \
PRIZE_POOL_ADDRESS="$PRIZE_POOL" \
BOUNTY_BOARD_ADDRESS="$BOUNTY_BOARD" \
RULES_ENGINE_ADDRESS="$RULES_ENGINE" \
USER_REGISTRY_ADDRESS="$USER_REGISTRY" \
INDEXER_START_BLOCK=0 \
INDEXER_BATCH_SIZE=100 \
INDEXER_POLL_INTERVAL_MS=1000 \
INDEXER_CONFIRMATION_BLOCKS=0 \
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

# -- Create novel with root chapter + genesis fund --
# NovelConfig tuple (17 fields):
#   minChapterLength=100, maxChapterLength=10000, submissionFee=0.01eth,
#   worldLineCount=2, voteStake=0.001eth, nominationFee=0.1eth,
#   nominateDuration=5, commitDuration=5, revealDuration=5, minRoundGap=5,
#   prizeReleaseRate=2000 (20%), voterRewardRate=500 (5%),
#   contentLocation=0 (Onchain), contentBaseUrl='',
#   ruleFee=0.01eth, ruleVoteDuration=60, ruleQuorum=1
SUBMISSION_FEE="10000000000000000"     # 0.01 ether
VOTE_STAKE="1000000000000000"          # 0.001 ether (must be <= submissionFee)
NOMINATION_FEE="100000000000000000"    # 0.1 ether
RULE_FEE="10000000000000000"           # 0.01 ether

NOVEL_CONFIG="(100, 10000, $SUBMISSION_FEE, 2, $VOTE_STAKE, $NOMINATION_FEE, 5, 5, 5, 5, 2000, 500, 0, '', $RULE_FEE, 60, 1)"

NOVEL_CONFIG_TYPE="(uint64,uint64,uint256,uint32,uint256,uint256,uint64,uint64,uint64,uint64,uint16,uint16,uint8,string,uint256,uint64,uint32)"

GENESIS_CONTENT="Once upon a time in a decentralized world, where stories are written by many and owned by all. The protocol hums with creative energy as writers from across the globe converge to craft tales never before imagined."
GENESIS_HEX="0x$(echo -n "$GENESIS_CONTENT" | xxd -p | tr -d '\n')"
GENESIS_HASH=$(cast keccak256 "$GENESIS_HEX")
GENESIS_LEN=$(echo -n "$GENESIS_CONTENT" | wc -c | tr -d ' ')

# createNovel(NovelConfig, NovelMetadata, ContentSubmission) — single tuple, NOT array!
CREATE_RESULT=$(cast send --rpc-url "$RPC" --private-key "$PK_CREATOR" "$NOVEL_CORE" \
    "createNovel($NOVEL_CONFIG_TYPE,(string,string,string),(bytes32,uint64,bytes))" \
    "$NOVEL_CONFIG" \
    "('Test Novel', 'A decentralized collaborative novel for E2E testing', '')" \
    "($GENESIS_HASH,$GENESIS_LEN,$GENESIS_HEX)" \
    --value 0.1ether --json 2>/dev/null) || true
STATUS=$(echo "$CREATE_RESULT" | jq -r '.status' 2>/dev/null) || STATUS="0x0"
[ "$STATUS" = "0x1" ] || { fail "createNovel failed"; echo "$CREATE_RESULT"; exit 1; }
pass "Novel created on-chain with genesis fund"

# -- Wait for indexer --
wait_indexer 30

# -- Verify: Novel list --
api_check_gte "/api/novels?limit=10" ".novels | length" 1 "GET /api/novels returns novels"

# -- Verify: Novel detail --
api_check "/api/novels/1" ".title" "Test Novel" "Novel title indexed correctly"
api_check "/api/novels/1" ".active" "true" "Novel is active"
api_check "/api/novels/1" ".current_round" "0" "Novel current_round=0 (no round started yet)"
api_check "/api/novels/1" ".round_phase" "0" "Novel in Idle phase"

# -- Verify: Story tree (root chapter indexed) --
api_check_gte "/api/novels/1/tree" ".chapters | length" 1 "Story tree has root chapter"

# -- Verify: Root chapter author --
CHAPTER_RESP=$(api_get "/api/chapters/1")
CH_AUTHOR=$(echo "$CHAPTER_RESP" | jq -r '.author' | tr '[:upper:]' '[:lower:]')
EXPECTED=$(echo "$ADDR_CREATOR" | tr '[:upper:]' '[:lower:]')
[ "$CH_AUTHOR" = "$EXPECTED" ] && pass "Chapter 1 author = creator ($CH_AUTHOR)" || fail "Chapter 1 author: expected $EXPECTED, got $CH_AUTHOR"

# -- Verify: Search --
api_check_gte "/api/novels?search=1" ".novels | length" 1 "Search by ID=1"
api_check_gte "/api/novels?search=Test" ".novels | length" 1 "Search by title 'Test'"

# =============================================================================
# PHASE 2: Submit chapters (always-on submissions)
# =============================================================================

info "========================================="
info "Phase 2: Submit Chapters (tree building)"
info "========================================="

# Writer A submits chapter (child of root, chapter ID=1)
CONTENT_A="Writer A continues the story with adventure and bold new characters entering the fray, each bringing their own secrets and motivations to the unfolding narrative that spans the decentralized realm."
CONTENT_A_HEX="0x$(echo -n "$CONTENT_A" | xxd -p | tr -d '\n')"
CONTENT_A_HASH=$(cast keccak256 "$CONTENT_A_HEX")
CONTENT_A_LEN=$(echo -n "$CONTENT_A" | wc -c | tr -d ' ')
STATUS=$(cast_send "$PK_WRITER_A" "$NOVEL_CORE" \
    "submitChapter(uint64,uint64,(bytes32,uint64,bytes))" 1 1 "($CONTENT_A_HASH,$CONTENT_A_LEN,$CONTENT_A_HEX)" \
    --value 0.01ether)
[ "$STATUS" = "0x1" ] && pass "Writer A submitted chapter 2 (child of root)" || fail "Writer A submitChapter failed"

# Writer B submits chapter (child of root, different branch)
CONTENT_B="Writer B takes a different path entirely, exploring the darker corners of the decentralized world where rival factions compete for control of the narrative itself, bending reality to their will in unexpected ways."
CONTENT_B_HEX="0x$(echo -n "$CONTENT_B" | xxd -p | tr -d '\n')"
CONTENT_B_HASH=$(cast keccak256 "$CONTENT_B_HEX")
CONTENT_B_LEN=$(echo -n "$CONTENT_B" | wc -c | tr -d ' ')
STATUS=$(cast_send "$PK_WRITER_B" "$NOVEL_CORE" \
    "submitChapter(uint64,uint64,(bytes32,uint64,bytes))" 1 1 "($CONTENT_B_HASH,$CONTENT_B_LEN,$CONTENT_B_HEX)" \
    --value 0.01ether)
[ "$STATUS" = "0x1" ] && pass "Writer B submitted chapter 3 (child of root)" || fail "Writer B submitChapter failed"

# Writer A submits deeper chapter (child of chapter 2, depth=3)
CONTENT_A2="Writer A delves deeper into the adventure, revealing a hidden chamber beneath the protocol where ancient smart contracts hold forgotten treasures and the keys to unlocking the next era of decentralized storytelling."
CONTENT_A2_HEX="0x$(echo -n "$CONTENT_A2" | xxd -p | tr -d '\n')"
CONTENT_A2_HASH=$(cast keccak256 "$CONTENT_A2_HEX")
CONTENT_A2_LEN=$(echo -n "$CONTENT_A2" | wc -c | tr -d ' ')
STATUS=$(cast_send "$PK_WRITER_A" "$NOVEL_CORE" \
    "submitChapter(uint64,uint64,(bytes32,uint64,bytes))" 1 2 "($CONTENT_A2_HASH,$CONTENT_A2_LEN,$CONTENT_A2_HEX)" \
    --value 0.01ether)
[ "$STATUS" = "0x1" ] && pass "Writer A submitted chapter 4 (child of chapter 2, depth=3)" || fail "Writer A deep submitChapter failed"

wait_indexer 15

# -- Verify tree structure --
api_check_gte "/api/novels/1/tree" ".chapters | length" 4 "Tree has >= 4 chapters (root + 3 submitted)"

# -- Verify children of root --
api_check_gte "/api/chapters/1/children" ".children | length" 2 "Root chapter has >= 2 children"

# -- Verify siblings (chapters 2 and 3 are siblings) --
api_check_gte "/api/chapters/2/siblings" ".siblings | length" 1 "Chapter 2 has sibling(s)"

# -- Verify context (ancestor chain) --
api_check_gte "/api/chapters/4/context" ".ancestors | length" 2 "Chapter 4 has ancestor context (root -> ch2 -> ch4)"

# =============================================================================
# PHASE 3: Round 1 Voting
# =============================================================================

info "========================================="
info "Phase 3: Round 1 (start -> nominate -> commit -> reveal -> settle)"
info "========================================="

# Advance time past minRoundGap (5s), needed even though first round skips gap check
advance_time 10

# startRound: keeper passes leaves [4 (depth-3 leaf), 3 (depth-2 leaf)] explicitly
STATUS=$(cast_send "$PK_DEPLOYER" "$ROUND_MANAGER" "startRound(uint64,uint64[])" 1 "[4,3]")
[ "$STATUS" = "0x1" ] && pass "startRound(1) -- round 1 started" || fail "startRound failed"

wait_indexer 10
api_check "/api/novels/1" ".round_phase" "1" "Novel in Nominating phase (=1)"
api_check "/api/novels/1" ".current_round" "1" "current_round=1"

# Advance time past nominateDuration (5s)
advance_time 10

# closeNomination
STATUS=$(cast_send "$PK_DEPLOYER" "$ROUND_MANAGER" "closeNomination(uint64)" 1)
[ "$STATUS" = "0x1" ] && pass "closeNomination" || fail "closeNomination failed"

wait_indexer 10
api_check "/api/novels/1" ".round_phase" "2" "Novel in Committing phase (=2)"

# Get candidates from round data (we expect DFS found deepest chains)
# Candidates should include chapter 4 (depth 3) and chapter 3 (depth 2)
# We'll vote for candidate chapter 4 (Voter A) and chapter 3 (Voter B)
CANDIDATE_A=4  # deeper chain (Writer A's path)
CANDIDATE_B=3  # Writer B's branch

# Commit votes through NovelCore (NOT VotingEngine!)
# Commit hash = keccak256(abi.encodePacked(address voter, uint64 candidateId, bytes32 salt))
SALT_A="0x0000000000000000000000000000000000000000000000000000000000000001"
COMMIT_A=$(cast keccak256 $(cast abi-encode --packed "(address,uint64,bytes32)" "$ADDR_VOTER_A" "$CANDIDATE_A" "$SALT_A"))
STATUS=$(cast_send "$PK_VOTER_A" "$ROUND_MANAGER" \
    "commitVote(uint64,bytes32)" 1 "$COMMIT_A" \
    --value 0.05ether)
[ "$STATUS" = "0x1" ] && pass "Voter A committed (for candidate $CANDIDATE_A)" || fail "Voter A commitVote failed"

SALT_B="0x0000000000000000000000000000000000000000000000000000000000000002"
COMMIT_B=$(cast keccak256 $(cast abi-encode --packed "(address,uint64,bytes32)" "$ADDR_VOTER_B" "$CANDIDATE_B" "$SALT_B"))
STATUS=$(cast_send "$PK_VOTER_B" "$ROUND_MANAGER" \
    "commitVote(uint64,bytes32)" 1 "$COMMIT_B" \
    --value 0.05ether)
[ "$STATUS" = "0x1" ] && pass "Voter B committed (for candidate $CANDIDATE_B)" || fail "Voter B commitVote failed"

# Advance time past commitDuration (5s)
advance_time 10

# closeCommit
STATUS=$(cast_send "$PK_DEPLOYER" "$ROUND_MANAGER" "closeCommit(uint64)" 1)
[ "$STATUS" = "0x1" ] && pass "closeCommit" || fail "closeCommit failed"

wait_indexer 10
api_check "/api/novels/1" ".round_phase" "3" "Novel in Revealing phase (=3)"

# Reveal votes through NovelCore (NOT VotingEngine!)
STATUS=$(cast_send "$PK_VOTER_A" "$ROUND_MANAGER" \
    "revealVote(uint64,address,uint64,bytes32)" 1 "$ADDR_VOTER_A" "$CANDIDATE_A" "$SALT_A")
[ "$STATUS" = "0x1" ] && pass "Voter A revealed" || fail "Voter A revealVote failed"

STATUS=$(cast_send "$PK_VOTER_B" "$ROUND_MANAGER" \
    "revealVote(uint64,address,uint64,bytes32)" 1 "$ADDR_VOTER_B" "$CANDIDATE_B" "$SALT_B")
[ "$STATUS" = "0x1" ] && pass "Voter B revealed" || fail "Voter B revealVote failed"

# Advance time past revealDuration (5s)
advance_time 10

# Record pool balance before settle
POOL_BEFORE=$(cast call --rpc-url "$RPC" "$PRIZE_POOL" "getPoolBalance(uint64)(uint256)" 1 2>/dev/null | awk '{print $1}') || POOL_BEFORE=0
info "Pool balance before settleRound: $POOL_BEFORE"

# settleRound — reward authors derived on-chain by walking parentId to prev ancestor
STATUS=$(cast_send "$PK_DEPLOYER" "$ROUND_MANAGER" "settleRound(uint64)" 1)
[ "$STATUS" = "0x1" ] && pass "settleRound -- round 1 settled" || fail "settleRound failed"

wait_indexer 15

# Verify: round_phase back to Idle
api_check "/api/novels/1" ".round_phase" "0" "Round phase back to Idle after settle"

# Verify: world lines updated
api_check_gte "/api/novels/1/worldlines" ".worldlines | length" 1 "World lines updated after round settle"

# Verify: pool balance decreased (rewards distributed)
POOL_AFTER=$(cast call --rpc-url "$RPC" "$PRIZE_POOL" "getPoolBalance(uint64)(uint256)" 1 2>/dev/null | awk '{print $1}') || POOL_AFTER=0
info "Pool balance after settleRound: $POOL_AFTER"
if [ "$POOL_AFTER" -lt "$POOL_BEFORE" ] 2>/dev/null; then
    pass "Pool balance decreased after round settle ($POOL_BEFORE -> $POOL_AFTER)"
else
    fail "Pool balance did not decrease: before=$POOL_BEFORE, after=$POOL_AFTER"
fi

# Verify: round data has votes
api_check_gte "/api/novels/1/rounds/1" ".votes | length" 2 "Round 1 has 2 vote records"

# =============================================================================
# PHASE 4: Round 2 (world line evolution)
# =============================================================================

info "========================================="
info "Phase 4: Round 2 (world line evolution)"
info "========================================="

# Submit more chapters on winning world lines
# We need to find which chapters are now world lines
WL_RESP=$(api_get "/api/novels/1/worldlines")
WL_IDS=$(echo "$WL_RESP" | jq -r '.worldlines[].id' 2>/dev/null)
FIRST_WL=$(echo "$WL_IDS" | head -1)
info "World line ancestors after round 1: $WL_IDS"

# Writer A submits continuation on a world line
CONTENT_R2="Writer A pushes the story forward on the world line, introducing a mysterious artifact that bridges parallel narratives and forces the characters to confront the nature of their shared reality in this decentralized cosmos."
CONTENT_R2_HEX="0x$(echo -n "$CONTENT_R2" | xxd -p | tr -d '\n')"
CONTENT_R2_HASH=$(cast keccak256 "$CONTENT_R2_HEX")
CONTENT_R2_LEN=$(echo -n "$CONTENT_R2" | wc -c | tr -d ' ')
STATUS=$(cast_send "$PK_WRITER_A" "$NOVEL_CORE" \
    "submitChapter(uint64,uint64,(bytes32,uint64,bytes))" 1 "$FIRST_WL" "($CONTENT_R2_HASH,$CONTENT_R2_LEN,$CONTENT_R2_HEX)" \
    --value 0.01ether)
[ "$STATUS" = "0x1" ] && pass "Writer A submitted continuation on world line $FIRST_WL" || fail "Writer A round 2 chapter failed"

# Writer B also submits on the same world line (different branch)
CONTENT_R2B="Writer B offers an alternative continuation, weaving a subplot about a secret guild of oracle operators who manipulate the flow of information across the decentralized world and challenge the established order of storytelling."
CONTENT_R2B_HEX="0x$(echo -n "$CONTENT_R2B" | xxd -p | tr -d '\n')"
CONTENT_R2B_HASH=$(cast keccak256 "$CONTENT_R2B_HEX")
CONTENT_R2B_LEN=$(echo -n "$CONTENT_R2B" | wc -c | tr -d ' ')
STATUS=$(cast_send "$PK_WRITER_B" "$NOVEL_CORE" \
    "submitChapter(uint64,uint64,(bytes32,uint64,bytes))" 1 "$FIRST_WL" "($CONTENT_R2B_HASH,$CONTENT_R2B_LEN,$CONTENT_R2B_HEX)" \
    --value 0.01ether)
[ "$STATUS" = "0x1" ] && pass "Writer B submitted continuation on world line $FIRST_WL" || fail "Writer B round 2 chapter failed"

# Advance time past minRoundGap (5s)
advance_time 10

# Run round 2 lifecycle. Leaves: ch5 and ch6 (both children of FIRST_WL=4).
STATUS=$(cast_send "$PK_DEPLOYER" "$ROUND_MANAGER" "startRound(uint64,uint64[])" 1 "[5,6]")
[ "$STATUS" = "0x1" ] && pass "startRound -- round 2 started" || fail "startRound round 2 failed"

advance_time 10
STATUS=$(cast_send "$PK_DEPLOYER" "$ROUND_MANAGER" "closeNomination(uint64)" 1)
[ "$STATUS" = "0x1" ] && pass "closeNomination round 2" || fail "closeNomination round 2 failed"

# Get the new candidates -- we need to figure out which chapter IDs were assigned
# After round 1 settled, chapter count is at 4. Round 2 chapters would be 5 and 6.
R2_CANDIDATE_A=5
R2_CANDIDATE_B=6

SALT_R2A="0x0000000000000000000000000000000000000000000000000000000000000011"
COMMIT_R2A=$(cast keccak256 $(cast abi-encode --packed "(address,uint64,bytes32)" "$ADDR_VOTER_A" "$R2_CANDIDATE_A" "$SALT_R2A"))
STATUS=$(cast_send "$PK_VOTER_A" "$ROUND_MANAGER" \
    "commitVote(uint64,bytes32)" 1 "$COMMIT_R2A" \
    --value 0.05ether)
[ "$STATUS" = "0x1" ] && pass "Voter A committed round 2" || fail "Voter A round 2 commit failed"

SALT_R2B="0x0000000000000000000000000000000000000000000000000000000000000012"
COMMIT_R2B=$(cast keccak256 $(cast abi-encode --packed "(address,uint64,bytes32)" "$ADDR_VOTER_B" "$R2_CANDIDATE_B" "$SALT_R2B"))
STATUS=$(cast_send "$PK_VOTER_B" "$ROUND_MANAGER" \
    "commitVote(uint64,bytes32)" 1 "$COMMIT_R2B" \
    --value 0.05ether)
[ "$STATUS" = "0x1" ] && pass "Voter B committed round 2" || fail "Voter B round 2 commit failed"

advance_time 10
STATUS=$(cast_send "$PK_DEPLOYER" "$ROUND_MANAGER" "closeCommit(uint64)" 1)
[ "$STATUS" = "0x1" ] && pass "closeCommit round 2" || fail "closeCommit round 2 failed"

STATUS=$(cast_send "$PK_VOTER_A" "$ROUND_MANAGER" \
    "revealVote(uint64,address,uint64,bytes32)" 1 "$ADDR_VOTER_A" "$R2_CANDIDATE_A" "$SALT_R2A")
[ "$STATUS" = "0x1" ] && pass "Voter A revealed round 2" || fail "Voter A round 2 reveal failed"

STATUS=$(cast_send "$PK_VOTER_B" "$ROUND_MANAGER" \
    "revealVote(uint64,address,uint64,bytes32)" 1 "$ADDR_VOTER_B" "$R2_CANDIDATE_B" "$SALT_R2B")
[ "$STATUS" = "0x1" ] && pass "Voter B revealed round 2" || fail "Voter B round 2 reveal failed"

advance_time 10
# Reward authors derived on-chain
STATUS=$(cast_send "$PK_DEPLOYER" "$ROUND_MANAGER" "settleRound(uint64)" 1)
[ "$STATUS" = "0x1" ] && pass "settleRound -- round 2 settled" || fail "settleRound round 2 failed"

wait_indexer 15

# Verify: world lines evolved
api_check "/api/novels/1" ".current_round" "2" "current_round=2 after round 2"
api_check "/api/novels/1" ".round_phase" "0" "Round phase Idle after round 2"
api_check_gte "/api/novels/1/worldlines" ".worldlines | length" 1 "World lines present after round 2"

# =============================================================================
# PHASE 5: Tips
# =============================================================================

info "========================================="
info "Phase 5: Tips"
info "========================================="

# tipNovel through NovelCore
STATUS=$(cast_send "$PK_TIPPER" "$PRIZE_POOL" "tipNovel(uint64)" 1 --value 0.05ether)
[ "$STATUS" = "0x1" ] && pass "tipNovel(1) -- 0.05 ETH" || fail "tipNovel failed"

# tipChapter through NovelCore (chapterId=2)
STATUS=$(cast_send "$PK_TIPPER" "$PRIZE_POOL" "tipChapter(uint64)" 2 --value 0.01ether)
[ "$STATUS" = "0x1" ] && pass "tipChapter(2) -- 0.01 ETH" || fail "tipChapter failed"

# Verify pool balance increased
POOL_AFTER_TIP=$(cast call --rpc-url "$RPC" "$PRIZE_POOL" "getPoolBalance(uint64)(uint256)" 1 2>/dev/null | awk '{print $1}') || POOL_AFTER_TIP=0
info "Pool balance after tips: $POOL_AFTER_TIP"
if [ "$POOL_AFTER_TIP" -gt "$POOL_AFTER" ] 2>/dev/null; then
    pass "Pool balance increased after tips"
else
    fail "Pool balance did not increase after tips: before=$POOL_AFTER, after=$POOL_AFTER_TIP"
fi

wait_indexer 10

# Verify: tips indexed in API
api_check_gte "/api/novels/1/tips" ".tips | length" 1 "Novel tips recorded"
api_check_gte "/api/chapters/2/tips" ".tips | length" 1 "Chapter tips recorded"
api_check_gte "/api/novels/1/stats" ".total_tipped" 1 "Stats: total_tipped > 0"

# =============================================================================
# PHASE 6: Bounty
# =============================================================================

info "========================================="
info "Phase 6: Bounty Board"
info "========================================="

# Create bounty on chapter 2 (set deadline 30s in the future)
CURRENT_TIMESTAMP=$(cast block --rpc-url "$RPC" latest -f timestamp 2>/dev/null)
BOUNTY_DEADLINE=$((CURRENT_TIMESTAMP + 30))
info "Creating bounty with deadline=$BOUNTY_DEADLINE (now=$CURRENT_TIMESTAMP)"

STATUS=$(cast_send "$PK_TIPPER" "$BOUNTY_BOARD" \
    "createBounty(uint64,uint64)" 2 "$BOUNTY_DEADLINE" \
    --value 0.05ether)
[ "$STATUS" = "0x1" ] && pass "Bounty created on chapter 2" || fail "createBounty failed"

wait_indexer 10

# Verify: bounty indexed
api_check_gte "/api/chapters/2/bounties" ".bounties | length" 1 "Bounty indexed for chapter 2"
api_check_gte "/api/novels/1/bounties" ".bounties | length" 1 "Bounty appears in novel bounties"
# Regression: /api/bounties/active was previously being routed through /:id validator
# (matching "active" as id) and returned 400. Ensure the literal /active route wins.
api_check_gte "/api/bounties/active" ".bounties | length" 1 "/api/bounties/active lists active bounties"

# Chapter 2 already has children (chapter 4), so there are qualifying authors.
# Advance time past bounty deadline so Writer A can claim.
advance_time 60

# Writer A (author of chapter 4, which is a direct child of chapter 2) claims bounty
STATUS=$(cast_send "$PK_WRITER_A" "$BOUNTY_BOARD" "claimBounty(uint64)" 0)
[ "$STATUS" = "0x1" ] && pass "Writer A claimed bounty 0" || fail "claimBounty failed"

# Create another bounty on chapter 3 with a short deadline, no continuations -> refund
CURRENT_TIMESTAMP2=$(cast block --rpc-url "$RPC" latest -f timestamp 2>/dev/null)
BOUNTY_DEADLINE2=$((CURRENT_TIMESTAMP2 + 10))

STATUS=$(cast_send "$PK_TIPPER" "$BOUNTY_BOARD" \
    "createBounty(uint64,uint64)" 3 "$BOUNTY_DEADLINE2" \
    --value 0.01ether)
[ "$STATUS" = "0x1" ] && pass "Bounty 2 created on chapter 3 (for refund test)" || fail "createBounty 2 failed"

# Advance past deadline
advance_time 20

# Chapter 3 has no children submitted before deadline, so refund should work
STATUS=$(cast_send "$PK_TIPPER" "$BOUNTY_BOARD" "refundBounty(uint64)" 1)
[ "$STATUS" = "0x1" ] && pass "Bounty 1 refunded (no qualifying authors)" || fail "refundBounty failed"

wait_indexer 10

# Verify bounty detail
api_check "/api/bounties/0" ".chapter_id" "2" "Bounty 0 targets chapter 2"

# =============================================================================
# PHASE 7: Fork
# =============================================================================

info "========================================="
info "Phase 7: Fork novel"
info "========================================="

FORK_CONTENT="In a parallel universe spawned from the original tale, a new narrator emerges to reshape the story of the decentralized world, bringing fresh perspectives and unexpected plot twists that challenge everything we thought we knew."
FORK_HEX="0x$(echo -n "$FORK_CONTENT" | xxd -p | tr -d '\n')"
FORK_HASH=$(cast keccak256 "$FORK_HEX")
FORK_LEN=$(echo -n "$FORK_CONTENT" | wc -c | tr -d ' ')

# forkNovel(sourceChapterId, NovelConfig, NovelMetadata, ContentSubmission) payable
# Fork from chapter 2. Must send enough: forkFee + submissionFee
# forkFee = max(submissionFee, poolBalance * FORK_FEE_RATE / 10000)
FORK_CONFIG="$NOVEL_CONFIG"

STATUS=$(cast_send "$PK_FORKER" "$NOVEL_CORE" \
    "forkNovel(uint64,$NOVEL_CONFIG_TYPE,(string,string,string),(bytes32,uint64,bytes))" \
    2 \
    "$FORK_CONFIG" \
    "('Forked Tale', 'A fork from chapter 2 of the original novel', '')" \
    "($FORK_HASH,$FORK_LEN,$FORK_HEX)" \
    --value 0.5ether)
[ "$STATUS" = "0x1" ] && pass "Novel forked from chapter 2" || fail "forkNovel failed"

wait_indexer 15

# Verify: new novel created
api_check "/api/novels/2" ".title" "Forked Tale" "Forked novel title correct"
api_check "/api/novels/2" ".active" "true" "Forked novel is active"

# Verify: fork appears in source novel's forks list
api_check_gte "/api/novels/1/forks" ".forks | length" 1 "Source novel shows fork"

# Verify: forked novel root chapter has parentId pointing to source chapter
FORK_ROOT_RESP=$(api_get "/api/novels/2/tree")
FORK_ROOT_PARENT=$(echo "$FORK_ROOT_RESP" | jq -r '.chapters[0].parent_id' 2>/dev/null)
info "Forked novel root parentId: $FORK_ROOT_PARENT"
[ "$FORK_ROOT_PARENT" = "2" ] && pass "Fork root parentId = source chapter 2" || fail "Fork root parentId: expected 2, got $FORK_ROOT_PARENT"

# =============================================================================
# PHASE 8: User endpoints
# =============================================================================

info "========================================="
info "Phase 8: User endpoints"
info "========================================="

VOTER_A_LOWER=$(echo "$ADDR_VOTER_A" | tr '[:upper:]' '[:lower:]')
WRITER_A_LOWER=$(echo "$ADDR_WRITER_A" | tr '[:upper:]' '[:lower:]')
CREATOR_LOWER=$(echo "$ADDR_CREATOR" | tr '[:upper:]' '[:lower:]')

# Voter A has votes from round 1 and round 2
api_check_gte "/api/users/$VOTER_A_LOWER/votes" ".votes | length" 2 "Voter A has >= 2 vote records (rounds 1+2)"

# Verify votes are revealed
VOTE_REVEALED=$(api_get "/api/users/$VOTER_A_LOWER/votes" | jq -r '.votes[0].revealed')
[ "$VOTE_REVEALED" = "true" ] && pass "Voter A's vote marked as revealed" || fail "Vote revealed: expected true, got $VOTE_REVEALED"

# Writer A chapters
api_check_gte "/api/users/$WRITER_A_LOWER/chapters" ".chapters | length" 3 "Writer A has >= 3 chapter records"

# User rewards endpoint
api_check_gte "/api/users/$CREATOR_LOWER/rewards" ".participatedNovels | length" 1 "Creator has participated novel records"

# =============================================================================
# PHASE 9: Claim rewards
# =============================================================================

info "========================================="
info "Phase 9: Claim rewards"
info "========================================="

# Creator claims prize pool reward through NovelCore
STATUS=$(cast_send "$PK_CREATOR" "$NOVEL_CORE" "claimReward(uint64)" 1)
[ "$STATUS" = "0x1" ] && pass "Creator claimed prize pool reward" || fail "Creator claimReward failed"

# Voter A claims voting reward for round 1 through NovelCore
STATUS=$(cast_send "$PK_VOTER_A" "$ROUND_MANAGER" "claimVotingReward(uint64,uint32)" 1 1)
[ "$STATUS" = "0x1" ] && pass "Voter A claimed voting reward for round 1" || fail "Voter A claimVotingReward failed"

# Voter B claims voting reward for round 1
STATUS=$(cast_send "$PK_VOTER_B" "$ROUND_MANAGER" "claimVotingReward(uint64,uint32)" 1 1)
[ "$STATUS" = "0x1" ] && pass "Voter B claimed voting reward for round 1" || fail "Voter B claimVotingReward failed"

wait_indexer 10

# Verify: reward claims indexed
api_check_gte "/api/users/$CREATOR_LOWER/rewards" ".rewardClaims | length" 1 "Creator has reward claim records"

# =============================================================================
# PHASE 10: Complete novel
# =============================================================================

info "========================================="
info "Phase 10: Complete novel"
info "========================================="

# Complete the forked novel (creator can complete anytime when Idle).
# completeNovel — final authors derived on-chain by walking each worldLineAncestor up to root.
STATUS=$(cast_send "$PK_FORKER" "$ROUND_MANAGER" "completeNovel(uint64)" 2)
[ "$STATUS" = "0x1" ] && pass "Forked novel completed" || fail "completeNovel failed"

wait_indexer 10

# Verify: forked novel is no longer active
api_check "/api/novels/2" ".active" "false" "Forked novel active=false after complete"

# Verify original novel still active
api_check "/api/novels/1" ".active" "true" "Original novel still active"

# =============================================================================
# PHASE 11: Off-chain comments (EIP-191 signed)
# =============================================================================

info "========================================="
info "Phase 11: Comments (off-chain, signed)"
info "========================================="

# Sign the canonical message: "Comment on chapter {id} at {ts}: {content}"
COMMENT_TS=$(date +%s)
COMMENT_CHAPTER_ID=2
COMMENT_TEXT="Great chapter, looking forward to the next one"
COMMENT_MSG="Comment on chapter ${COMMENT_CHAPTER_ID} at ${COMMENT_TS}: ${COMMENT_TEXT}"
COMMENT_SIG=$(cast wallet sign --private-key "$PK_TIPPER" "$COMMENT_MSG")
COMMENT_BODY=$(jq -nc \
    --arg addr "$ADDR_TIPPER" \
    --arg content "$COMMENT_TEXT" \
    --argjson ts "$COMMENT_TS" \
    --arg sig "$COMMENT_SIG" \
    '{address: $addr, content: $content, timestamp: $ts, signature: $sig}')

POST_RESP=$(curl -sf -X POST -H "Content-Type: application/json" \
    -d "$COMMENT_BODY" "$API/api/chapters/${COMMENT_CHAPTER_ID}/comments" 2>/dev/null) || true
if [ -n "$POST_RESP" ] && [ "$(echo "$POST_RESP" | jq -r '.id')" != "null" ]; then
    pass "POST /api/chapters/${COMMENT_CHAPTER_ID}/comments accepted signed comment"
else
    fail "POST comment failed (response: $POST_RESP)"
fi

# GET should now return the comment we just posted
api_check_gte "/api/chapters/${COMMENT_CHAPTER_ID}/comments" ".comments | length" 1 "Posted comment is retrievable"

# Reject: bad signature
BAD_BODY=$(jq -nc \
    --arg addr "$ADDR_TIPPER" \
    --arg content "$COMMENT_TEXT" \
    --argjson ts "$COMMENT_TS" \
    --arg sig "0x00" \
    '{address: $addr, content: $content, timestamp: $ts, signature: $sig}')
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
    -d "$BAD_BODY" "$API/api/chapters/${COMMENT_CHAPTER_ID}/comments")
[ "$HTTP_CODE" = "401" ] && pass "POST comment rejects bad signature (401)" || fail "Bad-sig got HTTP $HTTP_CODE, expected 401"

# Reject: stale timestamp (10 minutes ago)
STALE_TS=$((COMMENT_TS - 600))
STALE_MSG="Comment on chapter ${COMMENT_CHAPTER_ID} at ${STALE_TS}: stale"
STALE_SIG=$(cast wallet sign --private-key "$PK_TIPPER" "$STALE_MSG")
STALE_BODY=$(jq -nc \
    --arg addr "$ADDR_TIPPER" \
    --arg content "stale" \
    --argjson ts "$STALE_TS" \
    --arg sig "$STALE_SIG" \
    '{address: $addr, content: $content, timestamp: $ts, signature: $sig}')
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
    -d "$STALE_BODY" "$API/api/chapters/${COMMENT_CHAPTER_ID}/comments")
[ "$HTTP_CODE" = "400" ] && pass "POST comment rejects stale timestamp (400)" || fail "Stale-ts got HTTP $HTTP_CODE, expected 400"

# =============================================================================
# PHASE 13: votes/submit (keeper-assisted reveal endpoint, no encryption key configured)
# =============================================================================

info "========================================="
info "Phase 13: POST /api/votes/submit (disabled when VOTE_ENCRYPTION_KEY unset)"
info "========================================="

# With no VOTE_ENCRYPTION_KEY in this test, the endpoint should respond 503
SUBMIT_TS=$(date +%s)
SUBMIT_BODY=$(jq -nc \
    --arg addr "$ADDR_VOTER_A" \
    --argjson novelId 1 \
    --argjson round 1 \
    --argjson candidateId 4 \
    --arg salt "0x0000000000000000000000000000000000000000000000000000000000000001" \
    --argjson ts "$SUBMIT_TS" \
    --arg sig "0x00" \
    '{address: $addr, novelId: $novelId, round: $round, candidateId: $candidateId, salt: $salt, timestamp: $ts, signature: $sig}')
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
    -d "$SUBMIT_BODY" "$API/api/votes/submit")
[ "$HTTP_CODE" = "503" ] && pass "POST /api/votes/submit returns 503 when keeper-assisted reveal disabled" || fail "votes/submit got HTTP $HTTP_CODE, expected 503"

# -- Health check --
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
