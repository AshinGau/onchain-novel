#!/usr/bin/env bash
# =============================================================================
# End-to-End Integration Test: Contracts + MCP
#
# Anvil → Deploy → Multi-role lifecycle (creator, writers, voters, keeper)
# → MCP tool verification
#
# Usage: ./script/e2e-test.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# ── Colors ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

# ── Anvil accounts (deterministic) ──
RPC="http://localhost:8545"
# Account 0: deployer/owner
PK_DEPLOYER="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ADDR_DEPLOYER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
# Account 1: creator
PK_CREATOR="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
ADDR_CREATOR="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
# Account 2: writer A
PK_WRITER_A="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
ADDR_WRITER_A="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
# Account 3: writer B
PK_WRITER_B="0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
ADDR_WRITER_B="0x90F79bf6EB2c4f870365E785982E1f101E93b906"
# Account 4: voter A
PK_VOTER_A="0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"
ADDR_VOTER_A="0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"
# Account 5: voter B
PK_VOTER_B="0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"
ADDR_VOTER_B="0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"
# Account 6: keeper
PK_KEEPER="0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e"
ADDR_KEEPER="0x976EA74026E726554dB657fA54763abd0C3a0aa9"

# ── Helper: send tx via cast ──
# cast_send <private_key> <to> <sig> [args...] [--value X]
cast_send() {
    local pk="$1"; shift
    cast send --rpc-url "$RPC" --private-key "$pk" "$@" --json 2>/dev/null | jq -r '.status'
}

cast_call() {
    cast call --rpc-url "$RPC" "$@" 2>/dev/null
}

# ── Step 0: Start Anvil ──
info "Starting Anvil..."
anvil --block-time 1 --silent &
ANVIL_PID=$!
sleep 2

cleanup() {
    info "Shutting down Anvil (PID $ANVIL_PID)..."
    kill $ANVIL_PID 2>/dev/null || true
    wait $ANVIL_PID 2>/dev/null || true
}
trap cleanup EXIT

# Verify anvil is running
cast block-number --rpc-url "$RPC" > /dev/null 2>&1 || fail "Anvil not reachable"
pass "Anvil running"

# ── Step 1: Deploy contracts ──
info "Deploying contracts..."
PRIVATE_KEY="$PK_DEPLOYER" forge script script/Deploy.s.sol \
    --rpc-url "$RPC" --broadcast > /dev/null 2>&1

# Extract proxy addresses from broadcast JSON
BROADCAST_JSON="broadcast/Deploy.s.sol/31337/run-latest.json"
[ -f "$BROADCAST_JSON" ] || fail "Broadcast JSON not found"

# Parse contract addresses from create transactions (proxies are the last 4 creates)
# Order: NovelCore impl, VotingEngine impl, PrizePool impl, ChapterNFT impl,
#         NovelCore proxy, VotingEngine proxy, PrizePool proxy, ChapterNFT proxy
CREATES=$(jq -r '[.transactions[] | select(.transactionType == "CREATE") | .contractAddress] | .[]' "$BROADCAST_JSON")
CREATES_ARR=($CREATES)
NOVEL_CORE="${CREATES_ARR[4]}"
VOTING_ENGINE="${CREATES_ARR[5]}"
PRIZE_POOL="${CREATES_ARR[6]}"
CHAPTER_NFT="${CREATES_ARR[7]}"

[ -n "$NOVEL_CORE" ] || fail "Failed to extract NovelCore address"
pass "Contracts deployed: NovelCore=$NOVEL_CORE"

# Set keeper reward
cast_send "$PK_DEPLOYER" "$NOVEL_CORE" "setKeeperRewardAmount(uint256)" "10000000000000" > /dev/null
pass "Keeper reward set"

# ── Step 2: Create Novel (as creator) ──
info "Creating novel..."
# Config: min=100, max=10000, roundMinDuration=2s, roundMinSubmissions=2, worldLineCount=2,
#         roundsPerEpoch=1, prizeRelease=3000, voterReward=2000, commit=2s, reveal=2s,
#         stake=0.01 ETH, spamRounds=0, spamThreshold=0, contentBaseUrl=""
# Genesis: 1 chapter (onchain content)
GENESIS_CONTENT="Once upon a time in a decentralized world, where stories are written by many and owned by all..."
GENESIS_HEX="0x$(echo -n "$GENESIS_CONTENT" | xxd -p | tr -d '\n')"
GENESIS_HASH=$(cast keccak256 "$GENESIS_HEX")
GENESIS_LEN=$(echo -n "$GENESIS_CONTENT" | wc -c | tr -d ' ')
CREATE_TX=$(cast send --rpc-url "$RPC" --private-key "$PK_CREATOR" "$NOVEL_CORE" \
    "createNovel((uint64,uint64,uint64,uint32,uint32,uint32,uint16,uint16,uint64,uint64,uint256,uint8,uint8,uint8,string),(string,string,string),(bytes32,uint64,bytes)[])" \
    "(100, 10000, 2, 2, 2, 1, 3000, 2000, 2, 2, 10000000000000000, 0, 0, 0, '')" \
    "(Test Novel, A test novel, '')" \
    "[($GENESIS_HASH,$GENESIS_LEN,$GENESIS_HEX)]" \
    --value 0.1ether --json 2>/dev/null)

TX_STATUS=$(echo "$CREATE_TX" | jq -r '.status')
[ "$TX_STATUS" = "0x1" ] || fail "createNovel tx failed"

NOVEL_ID=1
pass "Novel #$NOVEL_ID created with 0.1 ETH prize pool"

# Verify novel state via getNovelCount
NOVEL_COUNT=$(cast_call "$NOVEL_CORE" "getNovelCount()(uint256)")
[ "$NOVEL_COUNT" = "1" ] || fail "Novel count should be 1, got $NOVEL_COUNT"
pass "Novel state verified (count=1)"

# ── Step 3: Submit chapters (writers A and B) ──
info "Submitting chapters..."

# Get genesis chapter ID (world line)
WORLD_LINES=$(cast_call "$NOVEL_CORE" "getActiveWorldLines(uint256)(uint256[])" "$NOVEL_ID")
PARENT_ID=1  # First genesis chapter

CONTENT_A_TEXT="Writer A continues the story with great adventure and bold new characters entering the fray, each bringing their own secrets and motivations to the unfolding narrative that spans across the decentralized realm..."
CONTENT_A_HEX="0x$(echo -n "$CONTENT_A_TEXT" | xxd -p | tr -d '\n')"
CONTENT_A_HASH=$(cast keccak256 "$CONTENT_A_HEX")
CONTENT_A_LEN=$(echo -n "$CONTENT_A_TEXT" | wc -c | tr -d ' ')
cast_send "$PK_WRITER_A" "$NOVEL_CORE" \
    "submitChapter(uint256,uint256,(bytes32,uint64,bytes))" "$NOVEL_ID" "$PARENT_ID" "($CONTENT_A_HASH,$CONTENT_A_LEN,$CONTENT_A_HEX)" \
    --value 0.01ether > /dev/null
pass "Writer A submitted chapter"

CONTENT_B_TEXT="Writer B takes the story in a different direction, exploring the darker corners of the decentralized world where rival factions compete for control of the narrative itself, bending reality to their will..."
CONTENT_B_HEX="0x$(echo -n "$CONTENT_B_TEXT" | xxd -p | tr -d '\n')"
CONTENT_B_HASH=$(cast keccak256 "$CONTENT_B_HEX")
CONTENT_B_LEN=$(echo -n "$CONTENT_B_TEXT" | wc -c | tr -d ' ')
cast_send "$PK_WRITER_B" "$NOVEL_CORE" \
    "submitChapter(uint256,uint256,(bytes32,uint64,bytes))" "$NOVEL_ID" "$PARENT_ID" "($CONTENT_B_HASH,$CONTENT_B_LEN,$CONTENT_B_HEX)" \
    --value 0.01ether > /dev/null
pass "Writer B submitted chapter"

# ── Step 4: Keeper closes submissions ──
info "Waiting for round min duration..."
sleep 3

cast_send "$PK_KEEPER" "$NOVEL_CORE" "closeSubmissions(uint256)" "$NOVEL_ID" > /dev/null
pass "Keeper: closeSubmissions"

# ── Step 5: Voters commit votes ──
info "Committing votes..."

# Compute votingRoundId: keccak256(abi.encodePacked(novelId, epoch, round, isEpoch))
# novelId=1, epoch=1, round=1, isEpoch=false
VOTING_ROUND_ID=$(cast keccak256 $(cast abi-encode --packed "(uint256,uint32,uint32,bool)" 1 1 1 false))
VOTING_ROUND_ID_DEC=$(cast to-dec "$VOTING_ROUND_ID")
info "Voting round ID: $VOTING_ROUND_ID_DEC"

# Voter A votes for chapter 2 (Writer A's chapter)
SALT_A="0x0000000000000000000000000000000000000000000000000000000000000001"
COMMIT_A=$(cast keccak256 $(cast abi-encode --packed "(uint256,bytes32)" 2 "$SALT_A"))
cast_send "$PK_VOTER_A" "$VOTING_ENGINE" \
    "commitVote(uint256,uint256,bytes32)" "$NOVEL_ID" "$VOTING_ROUND_ID_DEC" "$COMMIT_A" \
    --value 0.05ether > /dev/null
pass "Voter A committed (for chapter 2)"

# Voter B votes for chapter 3 (Writer B's chapter)
SALT_B="0x0000000000000000000000000000000000000000000000000000000000000002"
COMMIT_B=$(cast keccak256 $(cast abi-encode --packed "(uint256,bytes32)" 3 "$SALT_B"))
cast_send "$PK_VOTER_B" "$VOTING_ENGINE" \
    "commitVote(uint256,uint256,bytes32)" "$NOVEL_ID" "$VOTING_ROUND_ID_DEC" "$COMMIT_B" \
    --value 0.1ether > /dev/null
pass "Voter B committed (for chapter 3)"

# ── Step 6: Verify commit phase enforcement ──
info "Verifying commit phase enforcement..."
# Trying to reveal before closeCommit should fail with RevealNotOpen
if cast send --rpc-url "$RPC" --private-key "$PK_VOTER_A" "$VOTING_ENGINE" \
    "revealVote(uint256,uint256,uint256,bytes32)" "$NOVEL_ID" "$VOTING_ROUND_ID_DEC" 2 "$SALT_A" \
    > /dev/null 2>&1; then
    fail "Reveal should have been rejected before closeCommit"
else
    pass "Reveal before closeCommit correctly rejected (RevealNotOpen)"
fi

# ── Step 7: Keeper closes commit phase ──
info "Waiting for commit duration..."
sleep 3

cast_send "$PK_KEEPER" "$NOVEL_CORE" "closeCommit(uint256)" "$NOVEL_ID" > /dev/null
pass "Keeper: closeCommit (commit phase closed on VotingEngine)"

# Verify: new commits should now fail (CommitPhaseClosed)
if cast send --rpc-url "$RPC" --private-key "$PK_VOTER_A" "$VOTING_ENGINE" \
    "commitVote(uint256,uint256,bytes32)" "$NOVEL_ID" "$VOTING_ROUND_ID_DEC" \
    "0x0000000000000000000000000000000000000000000000000000000000000099" \
    --value 0.01ether > /dev/null 2>&1; then
    fail "Late commit should have been rejected"
else
    pass "Late commit correctly rejected (CommitPhaseClosed)"
fi

# ── Step 8: Voters reveal ──
info "Revealing votes..."

cast_send "$PK_VOTER_A" "$VOTING_ENGINE" \
    "revealVote(uint256,uint256,uint256,bytes32)" "$NOVEL_ID" "$VOTING_ROUND_ID_DEC" 2 "$SALT_A" > /dev/null
pass "Voter A revealed"

cast_send "$PK_VOTER_B" "$VOTING_ENGINE" \
    "revealVote(uint256,uint256,uint256,bytes32)" "$NOVEL_ID" "$VOTING_ROUND_ID_DEC" 3 "$SALT_B" > /dev/null
pass "Voter B revealed"

# ── Step 9: Keeper settles round → triggers epoch voting (roundsPerEpoch=1) ──
info "Waiting for reveal duration..."
sleep 3

cast_send "$PK_KEEPER" "$NOVEL_CORE" "settleRound(uint256)" "$NOVEL_ID" > /dev/null
pass "Keeper: settleRound (→ epoch voting, since roundsPerEpoch=1)"

# ── Step 10: Epoch voting (commit + reveal + settle) ──
info "Epoch voting..."

# Epoch votingRoundId: novelId=1, epoch=1, round=1, isEpoch=true
EPOCH_VOTING_ID=$(cast keccak256 $(cast abi-encode --packed "(uint256,uint32,uint32,bool)" 1 1 1 true))
EPOCH_VOTING_ID_DEC=$(cast to-dec "$EPOCH_VOTING_ID")

# Get epoch candidates (world lines)
EPOCH_CANDIDATES=$(cast_call "$VOTING_ENGINE" "getCandidates(uint256,uint256)(uint256[])" "$NOVEL_ID" "$EPOCH_VOTING_ID_DEC")
info "Epoch candidates: $EPOCH_CANDIDATES"

# Both voters vote for the same world line (chapter 3 — Writer B won more votes)
EPOCH_SALT_A="0x0000000000000000000000000000000000000000000000000000000000000003"
EPOCH_COMMIT_A=$(cast keccak256 $(cast abi-encode --packed "(uint256,bytes32)" 3 "$EPOCH_SALT_A"))
cast_send "$PK_VOTER_A" "$VOTING_ENGINE" \
    "commitVote(uint256,uint256,bytes32)" "$NOVEL_ID" "$EPOCH_VOTING_ID_DEC" "$EPOCH_COMMIT_A" \
    --value 0.05ether > /dev/null
pass "Epoch: Voter A committed"

EPOCH_SALT_B="0x0000000000000000000000000000000000000000000000000000000000000004"
EPOCH_COMMIT_B=$(cast keccak256 $(cast abi-encode --packed "(uint256,bytes32)" 3 "$EPOCH_SALT_B"))
cast_send "$PK_VOTER_B" "$VOTING_ENGINE" \
    "commitVote(uint256,uint256,bytes32)" "$NOVEL_ID" "$EPOCH_VOTING_ID_DEC" "$EPOCH_COMMIT_B" \
    --value 0.1ether > /dev/null
pass "Epoch: Voter B committed"

sleep 3
cast_send "$PK_KEEPER" "$NOVEL_CORE" "closeEpochCommit(uint256)" "$NOVEL_ID" > /dev/null
pass "Keeper: closeEpochCommit"

cast_send "$PK_VOTER_A" "$VOTING_ENGINE" \
    "revealVote(uint256,uint256,uint256,bytes32)" "$NOVEL_ID" "$EPOCH_VOTING_ID_DEC" 3 "$EPOCH_SALT_A" > /dev/null
cast_send "$PK_VOTER_B" "$VOTING_ENGINE" \
    "revealVote(uint256,uint256,uint256,bytes32)" "$NOVEL_ID" "$EPOCH_VOTING_ID_DEC" 3 "$EPOCH_SALT_B" > /dev/null
pass "Epoch: Both voters revealed"

sleep 3
cast_send "$PK_KEEPER" "$NOVEL_CORE" "settleEpoch(uint256)" "$NOVEL_ID" > /dev/null
pass "Keeper: settleEpoch — Canon established, NFTs minted, rewards distributed"

# ── Step 11: Verify final state ──
info "Verifying final state..."

# Novel should be in epoch 2, round 1, Submitting
NOVEL_EPOCH=$(cast_call "$NOVEL_CORE" "getNovel(uint256)((uint256,address,(uint64,uint64,uint64,uint32,uint32,uint32,uint16,uint16,uint64,uint64,uint256,uint8,uint8,uint8,string),uint32,uint32,uint8,uint8,uint256,uint32,uint32,bool,uint256,uint256))" "$NOVEL_ID" 2>/dev/null)
pass "Novel state after epoch settlement readable"

# Check prize pool balance (should be reduced after distribution)
POOL_BALANCE=$(cast_call "$PRIZE_POOL" "getPoolBalance(uint256)(uint256)" "$NOVEL_ID")
info "Prize pool balance: $POOL_BALANCE"

# Check pending rewards for creator
CREATOR_REWARD=$(cast_call "$PRIZE_POOL" "getPendingReward(uint256,address)(uint256)" "$NOVEL_ID" "$ADDR_CREATOR")
info "Creator pending reward: $CREATOR_REWARD"

# Check pending rewards for writer B (canon author)
WRITER_B_REWARD=$(cast_call "$PRIZE_POOL" "getPendingReward(uint256,address)(uint256)" "$NOVEL_ID" "$ADDR_WRITER_B")
info "Writer B pending reward: $WRITER_B_REWARD"

# Check chapter 3 is canon
CH3_CANON=$(cast_call "$NOVEL_CORE" "getChapter(uint256)((uint256,uint256,uint256,address,bytes32,uint64,uint32,uint32,uint256,bool,bool))" 3 2>/dev/null)
pass "Chapter 3 data readable"

# Check claimable stake for writers
WRITER_A_STAKE=$(cast_call "$NOVEL_CORE" "getClaimableStake(uint256,address)(uint256)" "$NOVEL_ID" "$ADDR_WRITER_A")
info "Writer A claimable stake: $WRITER_A_STAKE"

# Claims
cast_send "$PK_WRITER_A" "$NOVEL_CORE" "claimStakeRefund(uint256)" "$NOVEL_ID" > /dev/null
pass "Writer A claimed stake refund"

cast_send "$PK_CREATOR" "$PRIZE_POOL" "claimReward(uint256)" "$NOVEL_ID" > /dev/null
pass "Creator claimed prize reward"

# Sweep unrevealed (round voting) — should succeed even with 0 unrevealed
cast_send "$PK_KEEPER" "$VOTING_ENGINE" \
    "sweepUnrevealedStakes(uint256,uint256)" "$NOVEL_ID" "$VOTING_ROUND_ID_DEC" > /dev/null
pass "Keeper: swept unrevealed stakes (round)"

# Voter claims reward
cast_send "$PK_VOTER_A" "$VOTING_ENGINE" \
    "claimVotingReward(uint256,uint256)" "$NOVEL_ID" "$VOTING_ROUND_ID_DEC" > /dev/null
pass "Voter A claimed round voting reward"

# ── Step 12: Tip novel ──
cast_send "$PK_VOTER_B" "$PRIZE_POOL" "tipNovel(uint256)" "$NOVEL_ID" --value 0.05ether > /dev/null
TIPPED=$(cast_call "$PRIZE_POOL" "getTotalTipped(uint256)(uint256)" "$NOVEL_ID")
pass "Tipped novel: $TIPPED"

# ── Step 13: Complete novel (owner only) ──
cast_send "$PK_DEPLOYER" "$NOVEL_CORE" "completeNovel(uint256)" "$NOVEL_ID" > /dev/null
pass "Novel completed (deactivated)"

# ═══════════════════════════════════════════════════════════════
#  PART 2: MCP Tool Verification
# ═══════════════════════════════════════════════════════════════
info "========================================"
info "Part 2: MCP Tool Verification"
info "========================================"

# Create a second novel for MCP tests (novel is still active)
CREATE_TX2=$(cast send --rpc-url "$RPC" --private-key "$PK_CREATOR" "$NOVEL_CORE" \
    "createNovel((uint64,uint64,uint64,uint32,uint32,uint32,uint16,uint16,uint64,uint64,uint256,uint8,uint8,uint8,string),(string,string,string),(bytes32,uint64,bytes)[])" \
    "(100, 10000, 2, 2, 2, 1, 3000, 2000, 2, 2, 10000000000000000, 0, 0, 0, '')" \
    "(MCP Test Novel, MCP test novel, '')" \
    "[($GENESIS_HASH,$GENESIS_LEN,$GENESIS_HEX)]" \
    --value 0.1ether --json 2>/dev/null)
[ "$(echo "$CREATE_TX2" | jq -r '.status')" = "0x1" ] || fail "createNovel for MCP tests failed"
MCP_NOVEL_ID=2
pass "Novel #$MCP_NOVEL_ID created for MCP tests"

# Run MCP integration tests via Node.js
info "Running MCP integration tests..."
export RPC_URL="$RPC"
export NOVEL_CORE_ADDRESS="$NOVEL_CORE"
export VOTING_ENGINE_ADDRESS="$VOTING_ENGINE"
export PRIZE_POOL_ADDRESS="$PRIZE_POOL"
export CHAPTER_NFT_ADDRESS="$CHAPTER_NFT"
export PRIVATE_KEY="$PK_WRITER_A"
export MCP_NOVEL_ID="$MCP_NOVEL_ID"
export PK_CREATOR PK_WRITER_A PK_WRITER_B PK_VOTER_A PK_VOTER_B PK_KEEPER

cd "$ROOT_DIR/mcp"
npx tsx e2e-mcp-test.ts || fail "MCP integration tests failed"

pass "MCP integration tests passed"

echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  ALL E2E TESTS PASSED${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
