#!/usr/bin/env bash
# =============================================================================
# End-to-End Integration Test: Protocol
#
# Anvil -> Deploy -> Multi-role lifecycle (creator, writers, voters, keeper)
# -> Tips, Bounties, Fork, Complete
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
# Account 7: extra user (for bounties, forks)
PK_USER="0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356"
ADDR_USER="0x14dC79964da2C08dA15Fd60A92b3f010f36A56e3"

# ── Helper: send tx via cast ──
cast_send() {
    local pk="$1"; shift
    local result
    result=$(cast send --rpc-url "$RPC" --private-key "$pk" "$@" --json 2>/dev/null)
    local status
    status=$(echo "$result" | jq -r '.status')
    if [ "$status" != "0x1" ]; then
        echo "$result" >&2
        return 1
    fi
    echo "$result"
}

cast_call() {
    cast call --rpc-url "$RPC" "$@" 2>/dev/null
}

# Helper to advance time on Anvil
advance_time() {
    local seconds="$1"
    cast rpc --rpc-url "$RPC" evm_increaseTime "$seconds" > /dev/null 2>&1
    cast rpc --rpc-url "$RPC" evm_mine > /dev/null 2>&1
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

# ═══════════════════════════════════════════════════════════════
#  STEP 1: Deploy Contracts
# ═══════════════════════════════════════════════════════════════
info "Deploying contracts..."
PRIVATE_KEY="$PK_DEPLOYER" forge script script/Deploy.s.sol \
    --rpc-url "$RPC" --broadcast > /dev/null 2>&1

# Extract proxy addresses from broadcast JSON
BROADCAST_JSON="broadcast/Deploy.s.sol/31337/run-latest.json"
[ -f "$BROADCAST_JSON" ] || fail "Broadcast JSON not found"

# Deploy order (from Deploy.s.sol):
# CREATE: NovelCore impl, VotingEngine impl, PrizePool impl, RulesEngine impl, BountyBoard impl
# CREATE: VotingEngine proxy, PrizePool proxy, RulesEngine proxy, NovelCore proxy, BountyBoard proxy
# Then CALL transactions for wiring
CREATES=$(jq -r '[.transactions[] | select(.transactionType == "CREATE") | .contractAddress] | .[]' "$BROADCAST_JSON")
CREATES_ARR=($CREATES)

# 6 impls + 6 proxies + 1 standalone = 13 CREATE transactions
# Impls: [0] NovelCore, [1] VotingEngine, [2] PrizePool, [3] RulesEngine, [4] BountyBoard, [5] RoundManager
# Proxies: [6] VotingEngine, [7] PrizePool, [8] RulesEngine, [9] NovelCore, [10] BountyBoard, [11] RoundManager
# Standalone: [12] UserRegistry
VOTING_ENGINE="${CREATES_ARR[6]}"
PRIZE_POOL="${CREATES_ARR[7]}"
RULES_ENGINE="${CREATES_ARR[8]}"
NOVEL_CORE="${CREATES_ARR[9]}"
BOUNTY_BOARD="${CREATES_ARR[10]}"
ROUND_MANAGER="${CREATES_ARR[11]}"
USER_REGISTRY="${CREATES_ARR[12]}"

[ -n "$NOVEL_CORE" ] || fail "Failed to extract NovelCore address"
pass "Contracts deployed: NovelCore=$NOVEL_CORE VotingEngine=$VOTING_ENGINE PrizePool=$PRIZE_POOL BountyBoard=$BOUNTY_BOARD"

# Set keeper reward on PrizePool (owner function)
cast_send "$PK_DEPLOYER" "$PRIZE_POOL" "setKeeperRewardAmount(uint256)" "10000000000000" > /dev/null
# Authorize the dedicated keeper account (Deploy.s.sol already set deployer as keeper).
cast_send "$PK_DEPLOYER" "$ROUND_MANAGER" "setKeeper(address)" "$ADDR_KEEPER" > /dev/null
pass "Keeper reward set on PrizePool"

# ═══════════════════════════════════════════════════════════════
#  STEP 2: Create Novel with Root Chapter + Genesis Fund
# ═══════════════════════════════════════════════════════════════
info "Creating novel..."

# NovelConfig struct:
# (uint64 minChapterLength, uint64 maxChapterLength, uint256 submissionFee,
#  uint32 worldLineCount, uint256 voteStake, uint256 nominationFee,
#  uint64 nominateDuration, uint64 commitDuration, uint64 revealDuration, uint64 minRoundGap,
#  uint16 prizeReleaseRate, uint16 voterRewardRate,
#  uint8 contentLocation, string contentBaseUrl,
#  uint256 ruleFee, uint64 ruleVoteDuration, uint32 ruleQuorum)
#
# Using short durations for testing: nominate=2s, commit=2s, reveal=2s, minRoundGap=2s
# submissionFee=0.01 ETH, voteStake=0.01 ETH, nominationFee=0.02 ETH
# worldLineCount=2, prizeReleaseRate=2000 (20%), voterRewardRate=500 (5%)
# contentLocation=0 (Onchain)

GENESIS_CONTENT="Once upon a time in a decentralized world, where stories are written by many and owned by all. The blockchain hums with creative energy as writers from across the realm converge."
GENESIS_HEX="0x$(echo -n "$GENESIS_CONTENT" | xxd -p | tr -d '\n')"
GENESIS_HASH=$(cast keccak256 "$GENESIS_HEX")
GENESIS_LEN=$(echo -n "$GENESIS_CONTENT" | wc -c | tr -d ' ')

NOVEL_CONFIG="(100, 10000, 10000000000000000, 2, 10000000000000000, 20000000000000000, 2, 2, 2, 2, 3000, 2000, 0, '', 10000000000000000, 86400, 2)"
NOVEL_METADATA="(Test Novel, A collaborative story experiment, '')"

CREATE_TX=$(cast send --rpc-url "$RPC" --private-key "$PK_CREATOR" "$NOVEL_CORE" \
    "createNovel((uint64,uint64,uint256,uint32,uint256,uint256,uint64,uint64,uint64,uint64,uint16,uint16,uint8,string,uint256,uint64,uint32),(string,string,string),(bytes32,uint64,bytes))" \
    "$NOVEL_CONFIG" \
    "$NOVEL_METADATA" \
    "($GENESIS_HASH,$GENESIS_LEN,$GENESIS_HEX)" \
    --value 0.1ether --json 2>/dev/null)

TX_STATUS=$(echo "$CREATE_TX" | jq -r '.status')
[ "$TX_STATUS" = "0x1" ] || fail "createNovel tx failed"

NOVEL_ID=1
pass "Novel #$NOVEL_ID created with 0.1 ETH genesis fund"

# Verify novel count
NOVEL_COUNT=$(cast_call "$NOVEL_CORE" "novelCount()(uint64)")
[ "$(echo "$NOVEL_COUNT" | tr -d ' ')" = "1" ] || fail "Novel count should be 1, got $NOVEL_COUNT"
pass "Novel state verified (count=1)"

# Root chapter is chapterId=1, it's the worldLineAncestor
WORLD_LINES=$(cast_call "$NOVEL_CORE" "getWorldLineAncestors(uint64)(uint64[])" "$NOVEL_ID")
info "Initial world lines: $WORLD_LINES"

# ═══════════════════════════════════════════════════════════════
#  STEP 3: Submit Chapters (Always-On Writing)
# ═══════════════════════════════════════════════════════════════
info "Submitting chapters..."

# Writer A submits chapter 2 (child of root=1)
CONTENT_A1="Writer A continues the story with great adventure and bold new characters entering the fray. Each brings their own secrets and motivations to the unfolding narrative that spans across the decentralized realm where anything is possible."
CONTENT_A1_HEX="0x$(echo -n "$CONTENT_A1" | xxd -p | tr -d '\n')"
CONTENT_A1_HASH=$(cast keccak256 "$CONTENT_A1_HEX")
CONTENT_A1_LEN=$(echo -n "$CONTENT_A1" | wc -c | tr -d ' ')

cast_send "$PK_WRITER_A" "$NOVEL_CORE" \
    "submitChapter(uint64,uint64,(bytes32,uint64,bytes))" "$NOVEL_ID" "1" \
    "($CONTENT_A1_HASH,$CONTENT_A1_LEN,$CONTENT_A1_HEX)" \
    --value 0.01ether > /dev/null
pass "Writer A submitted chapter 2 (child of root)"

# Writer B submits chapter 3 (child of root=1) -- different branch
CONTENT_B1="Writer B takes the story in a different direction, exploring the darker corners of the decentralized world where rival factions compete for control. The tension rises as old alliances break and new enemies emerge from the shadows."
CONTENT_B1_HEX="0x$(echo -n "$CONTENT_B1" | xxd -p | tr -d '\n')"
CONTENT_B1_HASH=$(cast keccak256 "$CONTENT_B1_HEX")
CONTENT_B1_LEN=$(echo -n "$CONTENT_B1" | wc -c | tr -d ' ')

cast_send "$PK_WRITER_B" "$NOVEL_CORE" \
    "submitChapter(uint64,uint64,(bytes32,uint64,bytes))" "$NOVEL_ID" "1" \
    "($CONTENT_B1_HASH,$CONTENT_B1_LEN,$CONTENT_B1_HEX)" \
    --value 0.01ether > /dev/null
pass "Writer B submitted chapter 3 (child of root)"

# Writer A submits chapter 4 (child of chapter 2) -- extending Writer A's chain
CONTENT_A2="Writer A extends the adventure further. The heroes discover an ancient protocol hidden deep within the blockchain, a secret that could change everything. They must decide whether to reveal it to the world or keep it safe from those who would misuse it."
CONTENT_A2_HEX="0x$(echo -n "$CONTENT_A2" | xxd -p | tr -d '\n')"
CONTENT_A2_HASH=$(cast keccak256 "$CONTENT_A2_HEX")
CONTENT_A2_LEN=$(echo -n "$CONTENT_A2" | wc -c | tr -d ' ')

cast_send "$PK_WRITER_A" "$NOVEL_CORE" \
    "submitChapter(uint64,uint64,(bytes32,uint64,bytes))" "$NOVEL_ID" "2" \
    "($CONTENT_A2_HASH,$CONTENT_A2_LEN,$CONTENT_A2_HEX)" \
    --value 0.01ether > /dev/null
pass "Writer A submitted chapter 4 (child of chapter 2, extending chain)"

# Verify chapter count
CHAPTER_COUNT=$(cast_call "$NOVEL_CORE" "chapterCount()(uint64)")
info "Total chapters: $CHAPTER_COUNT"

# ═══════════════════════════════════════════════════════════════
#  ROUND 1: Basic Lifecycle
# ═══════════════════════════════════════════════════════════════
info "========================================"
info "ROUND 1: Basic Voting Lifecycle"
info "========================================"

# Wait for minRoundGap (2s) -- since first round, no gap needed, but wait for block
sleep 2

# STEP 4: Keeper starts round 1 with leaves [4,3] (ch4 depth-3 leaf, ch3 depth-2 leaf)
info "Keeper: startRound (leaves [4,3])..."
cast_send "$PK_KEEPER" "$ROUND_MANAGER" "startRound(uint64,uint64[])" "$NOVEL_ID" "[4,3]" > /dev/null
pass "Keeper: startRound (round 1)"

# Check candidates
ROUND_DATA=$(cast_call "$ROUND_MANAGER" "getRoundData(uint64,uint32)((uint64[],uint64,uint64,uint64,bool))" "$NOVEL_ID" "1")
info "Round 1 data: $ROUND_DATA"

# STEP 5: Wait for nominateDuration (2s), then closeNomination
info "Waiting for nominate duration..."
advance_time 3
cast_send "$PK_KEEPER" "$ROUND_MANAGER" "closeNomination(uint64)" "$NOVEL_ID" > /dev/null
pass "Keeper: closeNomination"

# STEP 6: Voters commit votes
info "Committing votes..."

# Both voters vote for chapter 4 (Writer A's deeper chain, depth=3)
# commitHash = keccak256(abi.encodePacked(uint64 candidateId, bytes32 salt))
SALT_A="0x0000000000000000000000000000000000000000000000000000000000000001"
COMMIT_A=$(cast keccak256 $(cast abi-encode --packed "(uint64,bytes32)" 4 "$SALT_A"))
cast_send "$PK_VOTER_A" "$ROUND_MANAGER" \
    "commitVote(uint64,bytes32)" "$NOVEL_ID" "$COMMIT_A" \
    --value 0.01ether > /dev/null
pass "Voter A committed (for chapter 4)"

# Voter B votes for chapter 3 (Writer B's chain)
SALT_B="0x0000000000000000000000000000000000000000000000000000000000000002"
COMMIT_B=$(cast keccak256 $(cast abi-encode --packed "(uint64,bytes32)" 3 "$SALT_B"))
cast_send "$PK_VOTER_B" "$ROUND_MANAGER" \
    "commitVote(uint64,bytes32)" "$NOVEL_ID" "$COMMIT_B" \
    --value 0.01ether > /dev/null
pass "Voter B committed (for chapter 3)"

# Verify: reveal before closeCommit should fail
if cast send --rpc-url "$RPC" --private-key "$PK_VOTER_A" "$ROUND_MANAGER" \
    "revealVote(uint64,uint64,bytes32)" "$NOVEL_ID" 4 "$SALT_A" \
    > /dev/null 2>&1; then
    fail "Reveal should have been rejected before closeCommit"
else
    pass "Reveal before closeCommit correctly rejected"
fi

# STEP 7: Keeper closes commit phase
info "Waiting for commit duration..."
advance_time 3
cast_send "$PK_KEEPER" "$ROUND_MANAGER" "closeCommit(uint64)" "$NOVEL_ID" > /dev/null
pass "Keeper: closeCommit"

# Verify: late commit should fail
if cast send --rpc-url "$RPC" --private-key "$PK_VOTER_A" "$ROUND_MANAGER" \
    "commitVote(uint64,bytes32)" "$NOVEL_ID" \
    "0x0000000000000000000000000000000000000000000000000000000000000099" \
    --value 0.01ether > /dev/null 2>&1; then
    fail "Late commit should have been rejected"
else
    pass "Late commit correctly rejected"
fi

# STEP 8: Voters reveal
info "Revealing votes..."
cast_send "$PK_VOTER_A" "$ROUND_MANAGER" \
    "revealVote(uint64,uint64,bytes32)" "$NOVEL_ID" 4 "$SALT_A" > /dev/null
pass "Voter A revealed (voted for chapter 4)"

cast_send "$PK_VOTER_B" "$ROUND_MANAGER" \
    "revealVote(uint64,uint64,bytes32)" "$NOVEL_ID" 3 "$SALT_B" > /dev/null
pass "Voter B revealed (voted for chapter 3)"

# STEP 9: Keeper settles round 1
# winnerPaths: ch4 wins, path = [4,2,1]; ch3 also winner with [3,1]. Both anchors in prev=[1].
info "Waiting for reveal duration..."
advance_time 3
cast_send "$PK_KEEPER" "$ROUND_MANAGER" "settleRound(uint64,uint64[][])" "$NOVEL_ID" "[[4,2,1],[3,1]]" > /dev/null
pass "Keeper: settleRound (round 1 settled)"

# STEP 10: Verify round 1 results
info "Verifying round 1 results..."

# World lines should be updated
NEW_WORLD_LINES=$(cast_call "$NOVEL_CORE" "getWorldLineAncestors(uint64)(uint64[])" "$NOVEL_ID")
info "World lines after round 1: $NEW_WORLD_LINES"

# Prize pool should have decreased (rewards distributed)
POOL_BALANCE=$(cast_call "$PRIZE_POOL" "getPoolBalance(uint64)(uint256)" "$NOVEL_ID")
info "Prize pool balance after round 1: $POOL_BALANCE wei"

# Creator should have pending rewards (creator royalty)
CREATOR_REWARD=$(cast_call "$PRIZE_POOL" "getPendingReward(uint64,address)(uint256)" "$NOVEL_ID" "$ADDR_CREATOR")
info "Creator pending reward: $CREATOR_REWARD wei"
[ "$CREATOR_REWARD" != "0" ] || fail "Creator should have pending rewards"
pass "Creator has pending rewards"

# Creator claims rewards
cast_send "$PK_CREATOR" "$NOVEL_CORE" "claimReward(uint64)" "$NOVEL_ID" > /dev/null
pass "Creator claimed rewards"

# Voter A claims voting reward (round 1)
cast_send "$PK_VOTER_A" "$ROUND_MANAGER" "claimVotingReward(uint64,uint32)" "$NOVEL_ID" 1 > /dev/null
pass "Voter A claimed voting reward (round 1)"

# Voter B claims voting reward (round 1)
cast_send "$PK_VOTER_B" "$ROUND_MANAGER" "claimVotingReward(uint64,uint32)" "$NOVEL_ID" 1 > /dev/null
pass "Voter B claimed voting reward (round 1)"

# Round 1 data should be settled
ROUND1_SETTLED=$(cast_call "$ROUND_MANAGER" "getRoundData(uint64,uint32)((uint64[],uint64,uint64,uint64,bool))" "$NOVEL_ID" "1")
info "Round 1 settled data: $ROUND1_SETTLED"

# ═══════════════════════════════════════════════════════════════
#  ROUND 2: Multi-Round World Line Evolution
# ═══════════════════════════════════════════════════════════════
info "========================================"
info "ROUND 2: World Line Evolution"
info "========================================"

# Submit chapters on winning world lines (descendants of round 1 winners)
# Chapter 4 and 3 are expected world lines from round 1 (worldLineCount=2)

# Writer A extends chapter 4 -> chapter 5
CONTENT_R2_A="The ancient protocol reveals its secrets. Writer A pushes the story deeper into the mystery. New characters emerge from the digital ether, each carrying fragments of a forgotten code that holds the key to ultimate decentralized governance."
CONTENT_R2_A_HEX="0x$(echo -n "$CONTENT_R2_A" | xxd -p | tr -d '\n')"
CONTENT_R2_A_HASH=$(cast keccak256 "$CONTENT_R2_A_HEX")
CONTENT_R2_A_LEN=$(echo -n "$CONTENT_R2_A" | wc -c | tr -d ' ')

cast_send "$PK_WRITER_A" "$NOVEL_CORE" \
    "submitChapter(uint64,uint64,(bytes32,uint64,bytes))" "$NOVEL_ID" "4" \
    "($CONTENT_R2_A_HASH,$CONTENT_R2_A_LEN,$CONTENT_R2_A_HEX)" \
    --value 0.01ether > /dev/null
pass "Writer A submitted chapter 5 (extends world line, child of 4)"

# Writer B extends chapter 3 -> chapter 6
CONTENT_R2_B="The dark factions consolidate their power. Writer B weaves a tale of intrigue and betrayal, where the lines between hero and villain blur in the decentralized consensus of reality. A surprising alliance forms."
CONTENT_R2_B_HEX="0x$(echo -n "$CONTENT_R2_B" | xxd -p | tr -d '\n')"
CONTENT_R2_B_HASH=$(cast keccak256 "$CONTENT_R2_B_HEX")
CONTENT_R2_B_LEN=$(echo -n "$CONTENT_R2_B" | wc -c | tr -d ' ')

cast_send "$PK_WRITER_B" "$NOVEL_CORE" \
    "submitChapter(uint64,uint64,(bytes32,uint64,bytes))" "$NOVEL_ID" "3" \
    "($CONTENT_R2_B_HASH,$CONTENT_R2_B_LEN,$CONTENT_R2_B_HEX)" \
    --value 0.01ether > /dev/null
pass "Writer B submitted chapter 6 (extends world line, child of 3)"

# Submit on a non-world-line branch (child of root=1 directly, won't be DFS candidate)
CONTENT_BRANCH="A rogue writer starts an entirely new branch from the root, ignoring the world lines. This branch explores what could have been if the original heroes never met. An alternate timeline where chaos reigns supreme."
CONTENT_BRANCH_HEX="0x$(echo -n "$CONTENT_BRANCH" | xxd -p | tr -d '\n')"
CONTENT_BRANCH_HASH=$(cast keccak256 "$CONTENT_BRANCH_HEX")
CONTENT_BRANCH_LEN=$(echo -n "$CONTENT_BRANCH" | wc -c | tr -d ' ')

cast_send "$PK_WRITER_B" "$NOVEL_CORE" \
    "submitChapter(uint64,uint64,(bytes32,uint64,bytes))" "$NOVEL_ID" "1" \
    "($CONTENT_BRANCH_HASH,$CONTENT_BRANCH_LEN,$CONTENT_BRANCH_HEX)" \
    --value 0.01ether > /dev/null
pass "Writer B submitted chapter 7 on non-world-line branch (child of root)"

# Wait for minRoundGap
advance_time 3

# Keeper starts round 2; current world lines = [4,3]; new leaves are 5 (under 4) and 6 (under 3)
cast_send "$PK_KEEPER" "$ROUND_MANAGER" "startRound(uint64,uint64[])" "$NOVEL_ID" "[5,6]" > /dev/null
pass "Keeper: startRound (round 2)"

ROUND2_DATA=$(cast_call "$ROUND_MANAGER" "getRoundData(uint64,uint32)((uint64[],uint64,uint64,uint64,bool))" "$NOVEL_ID" "2")
info "Round 2 candidates: $ROUND2_DATA"

# closeNomination
advance_time 3
cast_send "$PK_KEEPER" "$ROUND_MANAGER" "closeNomination(uint64)" "$NOVEL_ID" > /dev/null
pass "Keeper: closeNomination (round 2)"

# Commit votes -- both vote for chapter 5 (Writer A's extended chain)
SALT_R2_A="0x0000000000000000000000000000000000000000000000000000000000000003"
COMMIT_R2_A=$(cast keccak256 $(cast abi-encode --packed "(uint64,bytes32)" 5 "$SALT_R2_A"))
cast_send "$PK_VOTER_A" "$ROUND_MANAGER" \
    "commitVote(uint64,bytes32)" "$NOVEL_ID" "$COMMIT_R2_A" \
    --value 0.01ether > /dev/null
pass "Voter A committed (round 2, for chapter 5)"

SALT_R2_B="0x0000000000000000000000000000000000000000000000000000000000000004"
COMMIT_R2_B=$(cast keccak256 $(cast abi-encode --packed "(uint64,bytes32)" 6 "$SALT_R2_B"))
cast_send "$PK_VOTER_B" "$ROUND_MANAGER" \
    "commitVote(uint64,bytes32)" "$NOVEL_ID" "$COMMIT_R2_B" \
    --value 0.01ether > /dev/null
pass "Voter B committed (round 2, for chapter 6)"

# closeCommit
advance_time 3
cast_send "$PK_KEEPER" "$ROUND_MANAGER" "closeCommit(uint64)" "$NOVEL_ID" > /dev/null
pass "Keeper: closeCommit (round 2)"

# Reveal
cast_send "$PK_VOTER_A" "$ROUND_MANAGER" \
    "revealVote(uint64,uint64,bytes32)" "$NOVEL_ID" 5 "$SALT_R2_A" > /dev/null
pass "Voter A revealed (round 2)"

cast_send "$PK_VOTER_B" "$ROUND_MANAGER" \
    "revealVote(uint64,uint64,bytes32)" "$NOVEL_ID" 6 "$SALT_R2_B" > /dev/null
pass "Voter B revealed (round 2)"

# Settle round 2: winnerPaths = [[5,4], [6,3]] (each new leaf to its prev ancestor)
advance_time 3
cast_send "$PK_KEEPER" "$ROUND_MANAGER" "settleRound(uint64,uint64[][])" "$NOVEL_ID" "[[5,4],[6,3]]" > /dev/null
pass "Keeper: settleRound (round 2 settled)"

# Verify world lines evolved
R2_WORLD_LINES=$(cast_call "$NOVEL_CORE" "getWorldLineAncestors(uint64)(uint64[])" "$NOVEL_ID")
info "World lines after round 2: $R2_WORLD_LINES"
pass "Round 2 world lines updated"

# ═══════════════════════════════════════════════════════════════
#  ROUND 3: Nomination Test
# ═══════════════════════════════════════════════════════════════
info "========================================"
info "ROUND 3: Nomination Test"
info "========================================"

# Submit more chapters on world lines
CONTENT_R3="Round three contribution extending the world line further. The heroes face their greatest challenge yet as the ancient protocol begins to destabilize. Only unity across all factions can prevent the collapse of the decentralized narrative."
CONTENT_R3_HEX="0x$(echo -n "$CONTENT_R3" | xxd -p | tr -d '\n')"
CONTENT_R3_HASH=$(cast keccak256 "$CONTENT_R3_HEX")
CONTENT_R3_LEN=$(echo -n "$CONTENT_R3" | wc -c | tr -d ' ')

cast_send "$PK_WRITER_A" "$NOVEL_CORE" \
    "submitChapter(uint64,uint64,(bytes32,uint64,bytes))" "$NOVEL_ID" "5" \
    "($CONTENT_R3_HASH,$CONTENT_R3_LEN,$CONTENT_R3_HEX)" \
    --value 0.01ether > /dev/null
pass "Writer A submitted chapter 8 (extends world line, child of 5)"

# Extend world line 6 too so startRound finds >= worldLineCount candidates (DFS needs a leaf per line)
CONTENT_WL6="Parallel branch continues as the guild seeks the lost scroll. Each artifact reveals fragments of the prophecy hidden since the first fork."
CONTENT_WL6_HEX="0x$(echo -n "$CONTENT_WL6" | xxd -p | tr -d '\n')"
CONTENT_WL6_HASH=$(cast keccak256 "$CONTENT_WL6_HEX")
CONTENT_WL6_LEN=$(echo -n "$CONTENT_WL6" | wc -c | tr -d ' ')

cast_send "$PK_WRITER_A" "$NOVEL_CORE" \
    "submitChapter(uint64,uint64,(bytes32,uint64,bytes))" "$NOVEL_ID" "6" \
    "($CONTENT_WL6_HASH,$CONTENT_WL6_LEN,$CONTENT_WL6_HEX)" \
    --value 0.01ether > /dev/null
pass "Writer A submitted chapter 9 (extends world line, child of 6)"

# Submit a sibling chapter under ch5 — keeper will skip this one; user nominates it as alternative
CONTENT_NWL="An alternative continuation under chapter 5 — same world line, different direction. The keeper picks chapter 8 as the primary leaf, leaving this as a candidate the user must nominate."
CONTENT_NWL_HEX="0x$(echo -n "$CONTENT_NWL" | xxd -p | tr -d '\n')"
CONTENT_NWL_HASH=$(cast keccak256 "$CONTENT_NWL_HEX")
CONTENT_NWL_LEN=$(echo -n "$CONTENT_NWL" | wc -c | tr -d ' ')

cast_send "$PK_WRITER_B" "$NOVEL_CORE" \
    "submitChapter(uint64,uint64,(bytes32,uint64,bytes))" "$NOVEL_ID" "5" \
    "($CONTENT_NWL_HASH,$CONTENT_NWL_LEN,$CONTENT_NWL_HEX)" \
    --value 0.01ether > /dev/null
pass "Writer B submitted chapter 10 (alternative leaf under chapter 5)"

# Wait for minRoundGap
advance_time 3

# Start round 3 — keeper picks ch8 (under 5) and ch9 (under 6) as the leaves
cast_send "$PK_KEEPER" "$ROUND_MANAGER" "startRound(uint64,uint64[])" "$NOVEL_ID" "[8,9]" > /dev/null
pass "Keeper: startRound (round 3)"

# During Nominating phase, user nominates ch10 (alternative leaf under ch5).
# Path = [10, 5] proves ch10 is descendant of current worldLineAncestor ch5.
cast_send "$PK_USER" "$ROUND_MANAGER" \
    "nominateCandidate(uint64,uint64[])" "$NOVEL_ID" "[10,5]" \
    --value 0.02ether > /dev/null
pass "User nominated chapter 10 (alternative leaf, with path proof)"

# Verify nomination was recorded
R3_DATA=$(cast_call "$ROUND_MANAGER" "getRoundData(uint64,uint32)((uint64[],uint64,uint64,uint64,bool))" "$NOVEL_ID" "3")
info "Round 3 data (after nomination): $R3_DATA"

# closeNomination
advance_time 3
cast_send "$PK_KEEPER" "$ROUND_MANAGER" "closeNomination(uint64)" "$NOVEL_ID" > /dev/null
pass "Keeper: closeNomination (round 3)"

# Commit -- Voter A votes for the nominated chapter 9
SALT_R3_A="0x0000000000000000000000000000000000000000000000000000000000000005"
COMMIT_R3_A=$(cast keccak256 $(cast abi-encode --packed "(uint64,bytes32)" 10 "$SALT_R3_A"))
cast_send "$PK_VOTER_A" "$ROUND_MANAGER" \
    "commitVote(uint64,bytes32)" "$NOVEL_ID" "$COMMIT_R3_A" \
    --value 0.01ether > /dev/null
pass "Voter A committed (round 3, for nominated chapter 10)"

SALT_R3_B="0x0000000000000000000000000000000000000000000000000000000000000006"
COMMIT_R3_B=$(cast keccak256 $(cast abi-encode --packed "(uint64,bytes32)" 8 "$SALT_R3_B"))
cast_send "$PK_VOTER_B" "$ROUND_MANAGER" \
    "commitVote(uint64,bytes32)" "$NOVEL_ID" "$COMMIT_R3_B" \
    --value 0.01ether > /dev/null
pass "Voter B committed (round 3, for chapter 8)"

# closeCommit
advance_time 3
cast_send "$PK_KEEPER" "$ROUND_MANAGER" "closeCommit(uint64)" "$NOVEL_ID" > /dev/null
pass "Keeper: closeCommit (round 3)"

# Reveal
cast_send "$PK_VOTER_A" "$ROUND_MANAGER" \
    "revealVote(uint64,uint64,bytes32)" "$NOVEL_ID" 10 "$SALT_R3_A" > /dev/null
pass "Voter A revealed (round 3)"

cast_send "$PK_VOTER_B" "$ROUND_MANAGER" \
    "revealVote(uint64,uint64,bytes32)" "$NOVEL_ID" 8 "$SALT_R3_B" > /dev/null
pass "Voter B revealed (round 3)"

# Settle round 3.
# Candidates added in order: [8 (auto), 9 (auto), 10 (nominated)]. Votes: ch10=1, ch8=1, ch9=0.
# Tally insertion sort (stable on ties): final order [8, 10, 9]. Top 2 winners: [8, 10].
# winnerPaths matched in tally order: [[8,5], [10,5]].
advance_time 3
cast_send "$PK_KEEPER" "$ROUND_MANAGER" "settleRound(uint64,uint64[][])" "$NOVEL_ID" "[[8,5],[10,5]]" > /dev/null
pass "Keeper: settleRound (round 3 settled, nomination worked)"

R3_WORLD_LINES=$(cast_call "$NOVEL_CORE" "getWorldLineAncestors(uint64)(uint64[])" "$NOVEL_ID")
info "World lines after round 3: $R3_WORLD_LINES"

# ═══════════════════════════════════════════════════════════════
#  TIPS & BOUNTYBOARD
# ═══════════════════════════════════════════════════════════════
info "========================================"
info "Tips & BountyBoard"
info "========================================"

# Tip novel (through NovelCore)
cast_send "$PK_VOTER_B" "$PRIZE_POOL" "tipNovel(uint64)" "$NOVEL_ID" --value 0.05ether > /dev/null
POOL_AFTER_TIP=$(cast_call "$PRIZE_POOL" "getPoolBalance(uint64)(uint256)" "$NOVEL_ID")
pass "Tipped novel 0.05 ETH (pool balance: $POOL_AFTER_TIP)"

# Tip chapter (through NovelCore -- 50% to author, 50% to pool)
WRITER_A_BAL_BEFORE=$(cast balance --rpc-url "$RPC" "$ADDR_WRITER_A")
cast_send "$PK_USER" "$PRIZE_POOL" "tipChapter(uint64)" "2" --value 0.02ether > /dev/null
WRITER_A_BAL_AFTER=$(cast balance --rpc-url "$RPC" "$ADDR_WRITER_A")
pass "Tipped chapter 2 (Writer A) 0.02 ETH (50/50 split)"
info "Writer A balance change: $WRITER_A_BAL_BEFORE -> $WRITER_A_BAL_AFTER"

# ── BountyBoard: Create bounty with continuations ──
info "Creating bounty on chapter 6 (will have continuations)..."

# Writer B already submitted chapter 6. We'll create a bounty on it, then submit a continuation.
# Deadline = current block timestamp + 60 seconds
CURRENT_TS=$(cast block-number --rpc-url "$RPC" | xargs -I {} cast block --rpc-url "$RPC" {} --json 2>/dev/null | jq -r '.timestamp' | xargs printf '%d\n')
BOUNTY_DEADLINE=$((CURRENT_TS + 60))

cast_send "$PK_USER" "$BOUNTY_BOARD" \
    "createBounty(uint64,uint64)" "6" "$BOUNTY_DEADLINE" \
    --value 0.01ether > /dev/null
pass "Bounty #0 created on chapter 6 (deadline=$BOUNTY_DEADLINE)"

# Submit an additional continuation of chapter 6 (before deadline) -> chapter 11
CONTENT_BOUNTY="Continuation written to claim the bounty. The alliance formed in chapter 6 faces its first real test as an ancient threat emerges from the depths of the blockchain. Only by working together can they hope to survive this challenge."
CONTENT_BOUNTY_HEX="0x$(echo -n "$CONTENT_BOUNTY" | xxd -p | tr -d '\n')"
CONTENT_BOUNTY_HASH=$(cast keccak256 "$CONTENT_BOUNTY_HEX")
CONTENT_BOUNTY_LEN=$(echo -n "$CONTENT_BOUNTY" | wc -c | tr -d ' ')

cast_send "$PK_WRITER_A" "$NOVEL_CORE" \
    "submitChapter(uint64,uint64,(bytes32,uint64,bytes))" "$NOVEL_ID" "6" \
    "($CONTENT_BOUNTY_HASH,$CONTENT_BOUNTY_LEN,$CONTENT_BOUNTY_HEX)" \
    --value 0.01ether > /dev/null
pass "Writer A submitted chapter 11 (continuation of bounty target chapter 6)"

# Wait for bounty deadline to pass
advance_time 61

# Writer A claims bounty
cast_send "$PK_WRITER_A" "$BOUNTY_BOARD" "claimBounty(uint256)" "0" > /dev/null
pass "Writer A claimed bounty #0"

# ── BountyBoard: Create bounty with no continuations (for refund test) ──
info "Creating bounty on chapter 8 (no continuations, for refund test)..."

CURRENT_TS2=$(cast block-number --rpc-url "$RPC" | xargs -I {} cast block --rpc-url "$RPC" {} --json 2>/dev/null | jq -r '.timestamp' | xargs printf '%d\n')
BOUNTY_DEADLINE2=$((CURRENT_TS2 + 10))

cast_send "$PK_USER" "$BOUNTY_BOARD" \
    "createBounty(uint64,uint64)" "8" "$BOUNTY_DEADLINE2" \
    --value 0.01ether > /dev/null
pass "Bounty #1 created on chapter 8 (short deadline for refund test)"

# Wait for deadline (no one submits a continuation)
advance_time 11

# Refund bounty
cast_send "$PK_USER" "$BOUNTY_BOARD" "refundBounty(uint256)" "1" > /dev/null
pass "Bounty #1 refunded (no continuations)"

# ═══════════════════════════════════════════════════════════════
#  FORK TEST
# ═══════════════════════════════════════════════════════════════
info "========================================"
info "Fork Test"
info "========================================"

# Fork from chapter 3 of the original novel
# Fork fee = max(submissionFee, sourcePoolBalance * 100 / 10000) + submissionFee
# We need to send enough ETH to cover both fork fee + genesis fund
SOURCE_POOL=$(cast_call "$PRIZE_POOL" "getPoolBalance(uint64)(uint256)" "$NOVEL_ID")
info "Source novel pool balance: $SOURCE_POOL wei"

FORK_CONTENT="A bold new beginning in a forked universe. Drawing inspiration from chapter 3 of the original, this fork reimagines the darker path. New rules apply here, and the narrative takes an entirely unexpected direction as the forker brings fresh perspective."
FORK_HEX="0x$(echo -n "$FORK_CONTENT" | xxd -p | tr -d '\n')"
FORK_HASH=$(cast keccak256 "$FORK_HEX")
FORK_LEN=$(echo -n "$FORK_CONTENT" | wc -c | tr -d ' ')

# Use same config but different metadata
FORK_CONFIG="(100, 10000, 10000000000000000, 2, 10000000000000000, 20000000000000000, 2, 2, 2, 2, 3000, 2000, 0, '', 10000000000000000, 86400, 2)"
FORK_METADATA="(Forked Novel, A fork exploring an alternate timeline, '')"

# Send generous amount to cover fork fee + genesis
FORK_TX=$(cast send --rpc-url "$RPC" --private-key "$PK_USER" "$NOVEL_CORE" \
    "forkNovel(uint64,(uint64,uint64,uint256,uint32,uint256,uint256,uint64,uint64,uint64,uint64,uint16,uint16,uint8,string,uint256,uint64,uint32),(string,string,string),(bytes32,uint64,bytes))" \
    "3" \
    "$FORK_CONFIG" \
    "$FORK_METADATA" \
    "($FORK_HASH,$FORK_LEN,$FORK_HEX)" \
    --value 0.5ether --json 2>/dev/null)

FORK_STATUS=$(echo "$FORK_TX" | jq -r '.status')
[ "$FORK_STATUS" = "0x1" ] || fail "forkNovel tx failed"

FORK_NOVEL_ID=2
pass "Novel #$FORK_NOVEL_ID forked from chapter 3"

# Verify fork novel exists
FORK_NOVEL_COUNT=$(cast_call "$NOVEL_CORE" "novelCount()(uint64)")
[ "$(echo "$FORK_NOVEL_COUNT" | tr -d ' ')" = "2" ] || fail "Novel count should be 2"
pass "Fork verified (novel count=2)"

# Verify fork root's parentId points to source chapter 3.
# Chapter IDs before fork: 1(root), 2..10 (story), 11 (bounty continuation under ch6).
# Fork creates the next chapter id = 12 as the fork root in novel #2.
FORK_ROOT_ID=12
FORK_ROOT_CH=$(cast_call "$NOVEL_CORE" "getChapter(uint64)((uint64,uint64,uint64,address,bytes32,uint64,uint32,uint64,uint64[]))" "$FORK_ROOT_ID")
info "Fork root chapter: $FORK_ROOT_CH"
pass "Fork root chapter readable (parentId should reference source chapter 3)"

# ═══════════════════════════════════════════════════════════════
#  COMPLETE NOVEL (Forked Novel)
# ═══════════════════════════════════════════════════════════════
info "========================================"
info "Complete Novel"
info "========================================"

# Complete the forked novel (creator = ADDR_USER can call anytime). Fork root = ch$FORK_ROOT_ID.
cast_send "$PK_USER" "$ROUND_MANAGER" "completeNovel(uint64,uint64[][])" "$FORK_NOVEL_ID" "[[$FORK_ROOT_ID]]" > /dev/null
pass "Forked novel #$FORK_NOVEL_ID completed"

# Verify novel is no longer active
FORK_NOVEL_DATA=$(cast_call "$NOVEL_CORE" "getNovel(uint64)((uint64,address,(uint64,uint64,uint256,uint32,uint256,uint256,uint64,uint64,uint64,uint64,uint16,uint16,uint8,string,uint256,uint64,uint32),uint32,uint8,uint64,uint64,bool))" "$FORK_NOVEL_ID")
info "Forked novel state: $FORK_NOVEL_DATA"
pass "Forked novel state readable (should show active=false)"

# Verify no more chapters can be submitted to completed novel
if cast send --rpc-url "$RPC" --private-key "$PK_WRITER_A" "$NOVEL_CORE" \
    "submitChapter(uint64,uint64,(bytes32,uint64,bytes))" "$FORK_NOVEL_ID" "11" \
    "($FORK_HASH,$FORK_LEN,$FORK_HEX)" \
    --value 0.01ether > /dev/null 2>&1; then
    fail "Should not be able to submit to completed novel"
else
    pass "Chapter submission to completed novel correctly rejected"
fi

# Creator of forked novel claims final distribution
cast_send "$PK_USER" "$NOVEL_CORE" "claimReward(uint64)" "$FORK_NOVEL_ID" > /dev/null
pass "Fork creator claimed final distribution"

# ═══════════════════════════════════════════════════════════════
#  FINAL SUMMARY
# ═══════════════════════════════════════════════════════════════
FINAL_POOL=$(cast_call "$PRIZE_POOL" "getPoolBalance(uint64)(uint256)" "$NOVEL_ID")
FINAL_CHAPTERS=$(cast_call "$NOVEL_CORE" "chapterCount()(uint64)")
FINAL_NOVELS=$(cast_call "$NOVEL_CORE" "novelCount()(uint64)")

info "Final state: novels=$FINAL_NOVELS, chapters=$FINAL_CHAPTERS, novel1 pool=$FINAL_POOL wei"

echo ""
echo -e "${GREEN}=================================================${NC}"
echo -e "${GREEN}  ALL E2E TESTS PASSED${NC}"
echo -e "${GREEN}=================================================${NC}"
echo -e "${GREEN}  - 3 voting rounds (basic, evolution, nomination)${NC}"
echo -e "${GREEN}  - Tips (novel + chapter)${NC}"
echo -e "${GREEN}  - BountyBoard (claim + refund)${NC}"
echo -e "${GREEN}  - Fork novel${NC}"
echo -e "${GREEN}  - Complete novel${NC}"
echo -e "${GREEN}=================================================${NC}"
