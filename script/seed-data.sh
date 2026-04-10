#!/usr/bin/env bash
# =============================================================================
# Seed Local Node with Mock Data
#
# Populates the running local chain (started by ./script/local-node.sh start)
# with two test novels, multi-branch chapter trees, and two settled voting
# rounds per novel. This gives the frontend enough data to exercise the novel
# list, world line view, chapter reader, story tree, and round history UIs.
#
# Durations are short (5s) and time is warped forward with evm_increaseTime,
# so the whole script finishes in a few seconds of wall clock time.
#
# NOTE: Durations are kept at 5s rather than the bare minimum (1s) because the
# local node runs anvil with --block-time 1, so each tx gets a new block ~1s
# apart. A 5s phase leaves headroom for two back-to-back commits/reveals to
# land inside the same phase without racing the block timer.
#
# Usage: ./script/seed-data.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$ROOT_DIR/.local-node"
ENV_FILE="$DATA_DIR/env"
RPC="http://localhost:8545"

# ── Colors ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }
step() { echo -e "${CYAN}▸ $1${NC}"; }
die()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── Preflight ──
[ -f "$ENV_FILE" ] || die "Contracts not deployed. Run './script/local-node.sh start' first."
source "$ENV_FILE"
cast block-number --rpc-url "$RPC" > /dev/null 2>&1 \
    || die "Anvil not reachable at $RPC. Is './script/local-node.sh start' running?"

# ── Anvil deterministic accounts ──
PK_CREATOR="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
PK_WRITER_A="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
PK_WRITER_B="0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
PK_VOTER_A="0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"
PK_VOTER_B="0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"
PK_KEEPER="0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e"

# ── Helpers ──
cast_send() {
    local pk="$1"; shift
    local result
    result=$(cast send --rpc-url "$RPC" --private-key "$pk" "$@" --json 2>&1) \
        || { echo "$result" >&2; die "cast send failed: $*"; }
    local status
    status=$(echo "$result" | jq -r '.status' 2>/dev/null || echo "")
    [ "$status" = "0x1" ] || { echo "$result" >&2; die "tx reverted: $*"; }
}

cast_send_value() {
    local pk="$1" value="$2"; shift 2
    local result
    result=$(cast send --rpc-url "$RPC" --private-key "$pk" --value "$value" "$@" --json 2>&1) \
        || { echo "$result" >&2; die "cast send failed: $*"; }
    local status
    status=$(echo "$result" | jq -r '.status' 2>/dev/null || echo "")
    [ "$status" = "0x1" ] || { echo "$result" >&2; die "tx reverted: $*"; }
}

advance() {
    cast rpc --rpc-url "$RPC" evm_increaseTime "$1" > /dev/null
    cast rpc --rpc-url "$RPC" evm_mine > /dev/null
}

chapter_count() {
    cast call --rpc-url "$RPC" "$NOVEL_CORE_ADDRESS" "getChapterCount()(uint64)" 2>/dev/null \
        | awk '{print $1}'
}

novel_count() {
    cast call --rpc-url "$RPC" "$NOVEL_CORE_ADDRESS" "getNovelCount()(uint64)" 2>/dev/null \
        | awk '{print $1}'
}

# make_content "text" → sets CONTENT_TUPLE for ContentSubmission
make_content() {
    local text="$1"
    local hex
    hex="0x$(printf '%s' "$text" | xxd -p | tr -d '\n')"
    local hash
    hash=$(cast keccak256 "$hex")
    local len
    len=$(printf '%s' "$text" | wc -c | tr -d ' ')
    CONTENT_TUPLE="($hash,$len,$hex)"
}

# submit_chapter <pk> <novel_id> <parent_id> <text>
# After return: CHAPTER_ID holds the ID of the newly created chapter.
CHAPTER_ID=0
submit_chapter() {
    local pk="$1" novel_id="$2" parent_id="$3" text="$4"
    make_content "$text"
    cast_send_value "$pk" "0.01ether" "$NOVEL_CORE_ADDRESS" \
        "submitChapter(uint64,uint64,(bytes32,uint64,bytes))" \
        "$novel_id" "$parent_id" "$CONTENT_TUPLE"
    CHAPTER_ID=$(( CHAPTER_ID + 1 ))
}

# run_round <novel_id> <cand_for_voter_a> <cand_for_voter_b> <salt_seed>
# Drives a full round: start → closeNomination → commits → closeCommit →
# reveals → settleRound, warping time between phases.
run_round() {
    local novel_id="$1" cand_a="$2" cand_b="$3" seed="$4"

    cast_send "$PK_KEEPER" "$NOVEL_CORE_ADDRESS" "startRound(uint64)" "$novel_id"
    advance 6
    cast_send "$PK_KEEPER" "$NOVEL_CORE_ADDRESS" "closeNomination(uint64)" "$novel_id"

    # Unique salts so we never accidentally reuse a (voter, commitHash) pair.
    local salt_a salt_b commit_a commit_b
    salt_a=$(printf '0x%064x' $(( seed * 2 + 1 )))
    salt_b=$(printf '0x%064x' $(( seed * 2 + 2 )))
    commit_a=$(cast keccak256 "$(cast abi-encode --packed "(uint64,bytes32)" "$cand_a" "$salt_a")")
    commit_b=$(cast keccak256 "$(cast abi-encode --packed "(uint64,bytes32)" "$cand_b" "$salt_b")")

    cast_send_value "$PK_VOTER_A" "0.01ether" "$NOVEL_CORE_ADDRESS" \
        "commitVote(uint64,bytes32)" "$novel_id" "$commit_a"
    cast_send_value "$PK_VOTER_B" "0.01ether" "$NOVEL_CORE_ADDRESS" \
        "commitVote(uint64,bytes32)" "$novel_id" "$commit_b"

    advance 6
    cast_send "$PK_KEEPER" "$NOVEL_CORE_ADDRESS" "closeCommit(uint64)" "$novel_id"

    cast_send "$PK_VOTER_A" "$NOVEL_CORE_ADDRESS" \
        "revealVote(uint64,uint64,bytes32)" "$novel_id" "$cand_a" "$salt_a"
    cast_send "$PK_VOTER_B" "$NOVEL_CORE_ADDRESS" \
        "revealVote(uint64,uint64,bytes32)" "$novel_id" "$cand_b" "$salt_b"

    advance 6
    cast_send "$PK_KEEPER" "$NOVEL_CORE_ADDRESS" "settleRound(uint64)" "$novel_id"
    advance 6   # minRoundGap
}

# NovelConfig (19 fields, matching DataTypes.sol NovelConfig struct):
#   minChapterLength, maxChapterLength, submissionFee,
#   worldLineCount, voteStake, nominationFee,
#   nominateDuration, commitDuration, revealDuration, minRoundGap,
#   prizeReleaseRate, voterRewardRate,
#   maxVoterReward, unrevealPenaltyFloor,
#   contentLocation, contentBaseUrl,
#   ruleFee, ruleVoteDuration, ruleQuorum
#
# Short 5s phases → rounds settle in seconds of warped time.
# worldLineCount=2 matches the two-branch mock tree below.
NOVEL_CONFIG="(50, 10000, 10000000000000000, 2, 1000000000000000, 100000000000000000, 5, 5, 5, 5, 2000, 500, 0, 0, 0, '', 10000000000000000, 86400, 2)"
CREATE_NOVEL_SIG="createNovel((uint64,uint64,uint256,uint32,uint256,uint256,uint64,uint64,uint64,uint64,uint16,uint16,uint256,uint256,uint8,string,uint256,uint64,uint32),(string,string,string),(bytes32,uint64,bytes))"

# ═══════════════════════════════════════════════════════════════
#  Novel 1: "The Chronicles of Chain"
# ═══════════════════════════════════════════════════════════════
step "Novel 1 · The Chronicles of Chain"

NOVEL1_METADATA="(The Chronicles of Chain,An epic tale of decentralized heroes chasing an ancient protocol hidden inside the blockchain itself.,'')"
make_content "In the year 2077, a mysterious protocol was discovered deep within the blockchain, promising to unite every decentralized world that had ever existed."

cast_send_value "$PK_CREATOR" "0.2ether" "$NOVEL_CORE_ADDRESS" \
    "$CREATE_NOVEL_SIG" "$NOVEL_CONFIG" "$NOVEL1_METADATA" "$CONTENT_TUPLE"
NOVEL1_ID=$(novel_count)
CHAPTER_ID=$(chapter_count)
N1_ROOT=$CHAPTER_ID
ok "Created novel #$NOVEL1_ID (root chapter #$N1_ROOT, 0.2 ETH genesis fund)"

submit_chapter "$PK_WRITER_A" "$NOVEL1_ID" "$N1_ROOT" \
    "Writer A: Our heroes entered the ancient server room. Holograms flickered to life, revealing the protocol's first secret woven into pale blue light."
N1_CH2=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL1_ID" "$N1_ROOT" \
    "Writer B: In a parallel lab, a rogue faction uncovered the same protocol, but with far darker intentions for every node on the living network."
N1_CH3=$CHAPTER_ID
submit_chapter "$PK_WRITER_A" "$NOVEL1_ID" "$N1_CH2" \
    "Writer A: The holograms coalesced into a guide, pointing toward a forgotten consensus algorithm buried inside the very first genesis block of all."
N1_CH4=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL1_ID" "$N1_CH3" \
    "Writer B: The rogue faction deployed their virus, infecting every node that so much as grazed the protocol's fragile surface layer, sowing slow panic."
N1_CH5=$CHAPTER_ID
ok "Submitted chapters #$N1_CH2, #$N1_CH3, #$N1_CH4, #$N1_CH5 across two branches"

info "Novel 1: running round 1..."
run_round "$NOVEL1_ID" "$N1_CH4" "$N1_CH5" 1
ok "Novel 1: round 1 settled"

submit_chapter "$PK_WRITER_A" "$NOVEL1_ID" "$N1_CH4" \
    "Writer A: The guide revealed a key hidden in plain sight — woven into the very opcodes of the EVM itself, waiting patiently for the right witness."
N1_CH6=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL1_ID" "$N1_CH5" \
    "Writer B: Resistance fighters rallied, armed with countermeasures forged from zero-knowledge proofs, borrowed courage, and a great deal of stubborn hope."
N1_CH7=$CHAPTER_ID
ok "Extended winning world lines with chapters #$N1_CH6 and #$N1_CH7"

info "Novel 1: running round 2..."
run_round "$NOVEL1_ID" "$N1_CH6" "$N1_CH7" 2
ok "Novel 1: round 2 settled"

# ═══════════════════════════════════════════════════════════════
#  Novel 2: "Echoes of the Ledger"
# ═══════════════════════════════════════════════════════════════
step "Novel 2 · Echoes of the Ledger"

NOVEL2_METADATA="(Echoes of the Ledger,A quieter mystery about archivist librarians who preserve forgotten on-chain transactions and the secrets hidden inside them.,'')"
make_content "The Ledger Archive preserved every forgotten transaction since the very first genesis block, and its librarians listened for the faint echoes others had long stopped hearing."

cast_send_value "$PK_CREATOR" "0.2ether" "$NOVEL_CORE_ADDRESS" \
    "$CREATE_NOVEL_SIG" "$NOVEL_CONFIG" "$NOVEL2_METADATA" "$CONTENT_TUPLE"
NOVEL2_ID=$(novel_count)
CHAPTER_ID=$(chapter_count)
N2_ROOT=$CHAPTER_ID
ok "Created novel #$NOVEL2_ID (root chapter #$N2_ROOT, 0.2 ETH genesis fund)"

submit_chapter "$PK_WRITER_A" "$NOVEL2_ID" "$N2_ROOT" \
    "Writer A: Elena the apprentice archivist stumbled on a stray transaction hash that pointed nowhere — or at least, nowhere she had ever been taught to look."
N2_CH2=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL2_ID" "$N2_ROOT" \
    "Writer B: Meanwhile, the chief librarian received a quiet warning: someone outside the archive was searching for the exact same transaction hash, and moving fast."
N2_CH3=$CHAPTER_ID
submit_chapter "$PK_WRITER_A" "$NOVEL2_ID" "$N2_CH2" \
    "Writer A: Elena traced the hash through three long-dead contracts before finding a signature still pulsing faintly with unmistakable owner activity."
N2_CH4=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL2_ID" "$N2_CH3" \
    "Writer B: The chief closed the archive's great doors and began an audit she knew, with painful clarity, she was not authorized to perform."
N2_CH5=$CHAPTER_ID
ok "Submitted chapters #$N2_CH2, #$N2_CH3, #$N2_CH4, #$N2_CH5 across two branches"

info "Novel 2: running round 1..."
run_round "$NOVEL2_ID" "$N2_CH4" "$N2_CH5" 3
ok "Novel 2: round 1 settled"

submit_chapter "$PK_WRITER_A" "$NOVEL2_ID" "$N2_CH4" \
    "Writer A: The signature resolved to a name Elena recognized from an old lecture — a supposedly long-retired chain surveyor with a reputation for uncomfortable questions."
N2_CH6=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL2_ID" "$N2_CH5" \
    "Writer B: The audit revealed a pattern of careful deletions, evenly spaced across decades, and every last one of them pointed straight back to the archive's own keys."
N2_CH7=$CHAPTER_ID
ok "Extended winning world lines with chapters #$N2_CH6 and #$N2_CH7"

info "Novel 2: running round 2..."
run_round "$NOVEL2_ID" "$N2_CH6" "$N2_CH7" 4
ok "Novel 2: round 2 settled"

# ═══════════════════════════════════════════════════════════════
#  Summary
# ═══════════════════════════════════════════════════════════════
TOTAL_NOVELS=$(novel_count)
TOTAL_CHAPTERS=$(chapter_count)

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Seed data loaded${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Novels on chain:    $TOTAL_NOVELS"
echo -e "  Chapters on chain:  $TOTAL_CHAPTERS"
echo -e "  Rounds settled:     2 per novel (4 total)"
echo ""
echo -e "  Frontend:  http://localhost:3000"
echo -e "  Indexer:   http://localhost:3001/health  (wait a few seconds for events)"
echo ""
