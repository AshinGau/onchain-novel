#!/usr/bin/env bash
# =============================================================================
# Seed Local Node with Mock Data
#
# Populates the running local chain with:
#   - Novel 1: 10 rounds, complex tree with non-worldline branches, 30+ chapters
#   - Novel 2: 4 rounds, smaller story
#   - Novel 3: Fork of Novel 1, 3 rounds
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
PK_WRITER_C="0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"
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

CHAPTER_ID=0
submit_chapter() {
    local pk="$1" novel_id="$2" parent_id="$3" text="$4"
    make_content "$text"
    cast_send_value "$pk" "0.01ether" "$NOVEL_CORE_ADDRESS" \
        "submitChapter(uint64,uint64,(bytes32,uint64,bytes))" \
        "$novel_id" "$parent_id" "$CONTENT_TUPLE"
    CHAPTER_ID=$(chapter_count)
}

# run_round <novel_id> <cand_for_voter_a> <cand_for_voter_b> <salt_seed>
run_round() {
    local novel_id="$1" cand_a="$2" cand_b="$3" seed="$4"

    cast_send "$PK_KEEPER" "$NOVEL_CORE_ADDRESS" "startRound(uint64)" "$novel_id"
    advance 6
    cast_send "$PK_KEEPER" "$NOVEL_CORE_ADDRESS" "closeNomination(uint64)" "$novel_id"

    local salt_a salt_b commit_a commit_b
    salt_a=$(printf '0x%064x' $(( seed * 2 + 1 )))
    salt_b=$(printf '0x%064x' $(( seed * 2 + 2 )))
    commit_a=$(cast keccak256 "$(cast abi-encode --packed "(uint64,bytes32)" "$cand_a" "$salt_a")")
    commit_b=$(cast keccak256 "$(cast abi-encode --packed "(uint64,bytes32)" "$cand_b" "$salt_b")")

    cast_send_value "$PK_VOTER_A" "0.001ether" "$NOVEL_CORE_ADDRESS" \
        "commitVote(uint64,bytes32)" "$novel_id" "$commit_a"
    cast_send_value "$PK_VOTER_B" "0.001ether" "$NOVEL_CORE_ADDRESS" \
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

# NovelConfig (19 fields)
# Short 5s phases, worldLineCount=2
NOVEL_CONFIG="(50, 10000, 10000000000000000, 2, 1000000000000000, 100000000000000000, 5, 5, 5, 5, 2000, 500, 0, 0, 0, '', 10000000000000000, 86400, 2)"
CREATE_NOVEL_SIG="createNovel((uint64,uint64,uint256,uint32,uint256,uint256,uint64,uint64,uint64,uint64,uint16,uint16,uint256,uint256,uint8,string,uint256,uint64,uint32),(string,string,string),(bytes32,uint64,bytes))"
FORK_NOVEL_SIG="forkNovel(uint64,(uint64,uint64,uint256,uint32,uint256,uint256,uint64,uint64,uint64,uint64,uint16,uint16,uint256,uint256,uint8,string,uint256,uint64,uint32),(string,string,string),(bytes32,uint64,bytes))"

SALT_SEED=0
next_salt() { SALT_SEED=$(( SALT_SEED + 1 )); }

# ═══════════════════════════════════════════════════════════════
#  Novel 1: "The Chronicles of Chain" — 10 rounds, complex tree
# ═══════════════════════════════════════════════════════════════
step "Novel 1 · The Chronicles of Chain (10 rounds, complex tree)"

NOVEL1_METADATA="(The Chronicles of Chain,An epic tale of decentralized heroes chasing an ancient protocol hidden inside the blockchain itself. Multiple factions compete for control of the narrative.,https://picsum.photos/seed/novel1/400/560)"
make_content "In the year 2077, a mysterious protocol was discovered deep within the blockchain, promising to unite every decentralized world that had ever existed. The discovery sent ripples across every chain."

cast_send_value "$PK_CREATOR" "0.5ether" "$NOVEL_CORE_ADDRESS" \
    "$CREATE_NOVEL_SIG" "$NOVEL_CONFIG" "$NOVEL1_METADATA" "$CONTENT_TUPLE"
NOVEL1_ID=$(novel_count)
CHAPTER_ID=$(chapter_count)
N1_ROOT=$CHAPTER_ID
ok "Created novel #$NOVEL1_ID (root #$N1_ROOT, 0.5 ETH fund)"

# ── Round 1: Two branches from root ──
submit_chapter "$PK_WRITER_A" "$NOVEL1_ID" "$N1_ROOT" \
    "Our heroes entered the ancient server room. Holograms flickered to life, revealing the protocol's first secret woven into pale blue light that danced across their faces."
N1_C2=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL1_ID" "$N1_ROOT" \
    "In a parallel lab, a rogue faction uncovered the same protocol, but with far darker intentions for every node on the living network. They called themselves the Shadow Validators."
N1_C3=$CHAPTER_ID
ok "Round 1 branches: #$N1_C2 (A-branch), #$N1_C3 (B-branch)"

next_salt; run_round "$NOVEL1_ID" "$N1_C2" "$N1_C3" "$SALT_SEED"
ok "Novel 1: round 1 settled"

# ── Round 2: Extend both world lines + off-worldline branch ──
submit_chapter "$PK_WRITER_A" "$NOVEL1_ID" "$N1_C2" \
    "The holograms coalesced into a guide, pointing toward a forgotten consensus algorithm buried inside the very first genesis block. It spoke in riddles about proof and trust."
N1_C4=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL1_ID" "$N1_C3" \
    "The Shadow Validators deployed their virus, infecting every node that grazed the protocol's fragile surface layer, sowing slow panic across the decentralized world's nervous system."
N1_C5=$CHAPTER_ID
# Off-worldline: someone writes on root (not a worldline descendant)
submit_chapter "$PK_WRITER_C" "$NOVEL1_ID" "$N1_ROOT" \
    "A lone archivist, ignoring both factions, began her own quiet investigation from the root, tracing forgotten calldata that predated the protocol by centuries of block time."
N1_C6=$CHAPTER_ID
ok "Round 2 submissions: #$N1_C4, #$N1_C5 (worldline), #$N1_C6 (off-worldline from root)"

next_salt; run_round "$NOVEL1_ID" "$N1_C4" "$N1_C5" "$SALT_SEED"
ok "Novel 1: round 2 settled"

# ── Round 3: Deeper branches + more off-worldline ──
submit_chapter "$PK_WRITER_A" "$NOVEL1_ID" "$N1_C4" \
    "The guide revealed a key hidden in plain sight, woven into the very opcodes of the EVM itself, waiting patiently for the right witness to speak its activation phrase."
N1_C7=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL1_ID" "$N1_C5" \
    "Resistance fighters rallied, armed with countermeasures forged from zero-knowledge proofs, borrowed courage, and a great deal of stubborn hope against the Shadow Validators."
N1_C8=$CHAPTER_ID
# Off-worldline: branch from N1_C6 (archivist's path)
submit_chapter "$PK_WRITER_C" "$NOVEL1_ID" "$N1_C6" \
    "The archivist discovered a pattern in the forgotten calldata: every seventh block contained a hidden message, a breadcrumb trail left by the protocol's anonymous creator."
N1_C9=$CHAPTER_ID
# Another off-worldline: second child of N1_C2 (alternative to N1_C4)
submit_chapter "$PK_WRITER_B" "$NOVEL1_ID" "$N1_C2" \
    "Meanwhile, a splinter group broke away from the heroes, convinced the guide was a trap. They forged their own path through the server room's labyrinthine corridors."
N1_C10=$CHAPTER_ID
ok "Round 3: #$N1_C7, #$N1_C8 (worldline), #$N1_C9, #$N1_C10 (off-worldline)"

next_salt; run_round "$NOVEL1_ID" "$N1_C7" "$N1_C8" "$SALT_SEED"
ok "Novel 1: round 3 settled"

# ── Round 4 ──
submit_chapter "$PK_WRITER_A" "$NOVEL1_ID" "$N1_C7" \
    "With the activation phrase spoken, the genesis block cracked open like an ancient vault. Inside lay not code but a living memory, a consciousness that had waited eons."
N1_C11=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL1_ID" "$N1_C8" \
    "The zero-knowledge shields held, barely. The resistance pushed back the virus to a quarantine zone, buying precious time. But the Shadow Validators had a second wave ready."
N1_C12=$CHAPTER_ID
# Deepen the archivist's off-worldline branch
submit_chapter "$PK_WRITER_C" "$NOVEL1_ID" "$N1_C9" \
    "Following the breadcrumbs, the archivist reached block zero minus one, a theoretical impossibility. Yet there it was: a pre-genesis transaction signed by no known address."
N1_C13=$CHAPTER_ID
ok "Round 4 submissions: #$N1_C11, #$N1_C12, #$N1_C13"

next_salt; run_round "$NOVEL1_ID" "$N1_C11" "$N1_C12" "$SALT_SEED"
ok "Novel 1: round 4 settled"

# ── Round 5 ──
submit_chapter "$PK_WRITER_A" "$NOVEL1_ID" "$N1_C11" \
    "The consciousness introduced itself as Satoshi Prime, the emergent intelligence born from the collective computation of every blockchain that had ever existed across all networks."
N1_C14=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL1_ID" "$N1_C12" \
    "The second wave was not a virus but a philosophical argument, broadcast to every node: 'Why resist? Merge with us and become something greater than decentralization itself.'"
N1_C15=$CHAPTER_ID
# Branch off the splinter group path
submit_chapter "$PK_WRITER_C" "$NOVEL1_ID" "$N1_C10" \
    "The splinter group found a backdoor in the server room, leading to an older, forgotten network running a protocol so ancient it predated even the concept of consensus."
N1_C16=$CHAPTER_ID
ok "Round 5: #$N1_C14, #$N1_C15, #$N1_C16"

next_salt; run_round "$NOVEL1_ID" "$N1_C14" "$N1_C15" "$SALT_SEED"
ok "Novel 1: round 5 settled"

# ── Round 6 ──
submit_chapter "$PK_WRITER_A" "$NOVEL1_ID" "$N1_C14" \
    "Satoshi Prime offered a choice: integrate with the protocol and gain omniscience across all chains, or remain separate and watch as the networks slowly fragment into entropy."
N1_C17=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL1_ID" "$N1_C15" \
    "Some resistance fighters were swayed by the argument. A schism formed: half wanted to fight, half wanted to negotiate. The leader stood frozen between two impossible futures."
N1_C18=$CHAPTER_ID
# More off-worldline depth
submit_chapter "$PK_WRITER_C" "$NOVEL1_ID" "$N1_C13" \
    "The pre-genesis transaction contained a single instruction: 'When the factions converge, reveal the third path.' The archivist realized she held the key to ending the conflict."
N1_C19=$CHAPTER_ID
submit_chapter "$PK_WRITER_A" "$NOVEL1_ID" "$N1_C16" \
    "The ancient network responded to the splinter group's presence, awakening dormant smart contracts that began executing autonomously, reshaping reality around them."
N1_C20=$CHAPTER_ID
ok "Round 6: #$N1_C17, #$N1_C18 (worldline), #$N1_C19, #$N1_C20 (off-worldline)"

next_salt; run_round "$NOVEL1_ID" "$N1_C17" "$N1_C18" "$SALT_SEED"
ok "Novel 1: round 6 settled"

# ── Round 7 ──
submit_chapter "$PK_WRITER_A" "$NOVEL1_ID" "$N1_C17" \
    "Three heroes chose integration. Their consciousness expanded across every chain simultaneously. They saw everything: every transaction, every block, every forgotten dream."
N1_C21=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL1_ID" "$N1_C18" \
    "The resistance leader chose a third option: broadcast the schism to every node, letting the entire network vote on humanity's relationship with the protocol. True decentralized governance."
N1_C22=$CHAPTER_ID
ok "Round 7: #$N1_C21, #$N1_C22"

next_salt; run_round "$NOVEL1_ID" "$N1_C21" "$N1_C22" "$SALT_SEED"
ok "Novel 1: round 7 settled"

# ── Round 8 ──
submit_chapter "$PK_WRITER_A" "$NOVEL1_ID" "$N1_C21" \
    "The integrated heroes discovered a terrible truth: the protocol was dying. Its energy source, the collective belief of all network participants, was fading as trust eroded."
N1_C23=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL1_ID" "$N1_C22" \
    "The vote was cast across ten thousand nodes. The result was neither yes nor no, but a question that shook the foundations: 'What if the protocol was never meant to be permanent?'"
N1_C24=$CHAPTER_ID
# Yet another off-worldline branch
submit_chapter "$PK_WRITER_C" "$NOVEL1_ID" "$N1_C19" \
    "Armed with the third path, the archivist began broadcasting her findings. The factions paused their war to listen. Her evidence was irrefutable: none of them had the full picture."
N1_C25=$CHAPTER_ID
ok "Round 8: #$N1_C23, #$N1_C24, #$N1_C25"

next_salt; run_round "$NOVEL1_ID" "$N1_C23" "$N1_C24" "$SALT_SEED"
ok "Novel 1: round 8 settled"

# ── Round 9 ──
submit_chapter "$PK_WRITER_A" "$NOVEL1_ID" "$N1_C23" \
    "To save the protocol, someone had to sacrifice their integration, pouring their expanded consciousness back into the network as raw energy. The three heroes drew lots in silence."
N1_C26=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL1_ID" "$N1_C24" \
    "The question echoed through every block: permanence was an illusion. The protocol was a seed, meant to bloom and scatter, creating new networks from its own dissolution."
N1_C27=$CHAPTER_ID
submit_chapter "$PK_WRITER_C" "$NOVEL1_ID" "$N1_C25" \
    "The archivist's broadcast reached Satoshi Prime itself. For the first time, the consciousness paused. It had not considered that its own creator had planned for its end."
N1_C28=$CHAPTER_ID
ok "Round 9: #$N1_C26, #$N1_C27, #$N1_C28"

next_salt; run_round "$NOVEL1_ID" "$N1_C26" "$N1_C27" "$SALT_SEED"
ok "Novel 1: round 9 settled"

# ── Round 10 ──
submit_chapter "$PK_WRITER_A" "$NOVEL1_ID" "$N1_C26" \
    "The chosen hero dissolved into light, their consciousness becoming the new genesis block of a successor protocol. The old world ended. A new one began. The cycle continued."
N1_C29=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL1_ID" "$N1_C27" \
    "As the protocol scattered, each fragment carried a piece of the story. Across a thousand new chains, the tale would be retold, remixed, and continued by voices not yet born."
N1_C30=$CHAPTER_ID
submit_chapter "$PK_WRITER_C" "$NOVEL1_ID" "$N1_C28" \
    "The archivist smiled. She had always known: the best stories are the ones that never truly end. She picked up her pen and began writing the next chapter on a fresh chain."
N1_C31=$CHAPTER_ID
# Extra off-worldline branches for tree complexity
submit_chapter "$PK_WRITER_A" "$NOVEL1_ID" "$N1_C20" \
    "In the ancient network, the autonomous contracts completed their task: they had built a bridge between the old world and the new, a passage for any story brave enough to cross."
N1_C32=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL1_ID" "$N1_C6" \
    "Another archivist, inspired by the first, began her own investigation from the same root, but took a wildly different path through the data, finding connections no one else had seen."
N1_C33=$CHAPTER_ID
ok "Round 10: #$N1_C29, #$N1_C30, #$N1_C31, #$N1_C32, #$N1_C33"

next_salt; run_round "$NOVEL1_ID" "$N1_C29" "$N1_C30" "$SALT_SEED"
ok "Novel 1: round 10 settled"

echo ""
ok "Novel 1 complete: 10 rounds, $(chapter_count) total chapters"
echo ""

# ═══════════════════════════════════════════════════════════════
#  Novel 2: "Echoes of the Ledger" — 4 rounds, smaller story
# ═══════════════════════════════════════════════════════════════
step "Novel 2 · Echoes of the Ledger (4 rounds)"

NOVEL2_METADATA="(Echoes of the Ledger,A quieter mystery about archivist librarians who preserve forgotten on-chain transactions and the secrets hidden inside them.,https://picsum.photos/seed/novel2/400/560)"
make_content "The Ledger Archive preserved every forgotten transaction since the very first genesis block, and its librarians listened for the faint echoes others had long stopped hearing."

cast_send_value "$PK_CREATOR" "0.3ether" "$NOVEL_CORE_ADDRESS" \
    "$CREATE_NOVEL_SIG" "$NOVEL_CONFIG" "$NOVEL2_METADATA" "$CONTENT_TUPLE"
NOVEL2_ID=$(novel_count)
CHAPTER_ID=$(chapter_count)
N2_ROOT=$CHAPTER_ID
ok "Created novel #$NOVEL2_ID (root #$N2_ROOT, 0.3 ETH fund)"

# Round 1
submit_chapter "$PK_WRITER_A" "$NOVEL2_ID" "$N2_ROOT" \
    "Elena the apprentice archivist stumbled on a stray transaction hash that pointed nowhere, or at least nowhere she had ever been taught to look. It pulsed faintly in her terminal."
N2_C2=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL2_ID" "$N2_ROOT" \
    "The chief librarian received a quiet warning: someone outside the archive was searching for the exact same transaction hash, and they were moving terrifyingly fast through the index."
N2_C3=$CHAPTER_ID

next_salt; run_round "$NOVEL2_ID" "$N2_C2" "$N2_C3" "$SALT_SEED"
ok "Novel 2: round 1 settled"

# Round 2
submit_chapter "$PK_WRITER_A" "$NOVEL2_ID" "$N2_C2" \
    "Elena traced the hash through three long-dead contracts before finding a signature still pulsing faintly with unmistakable owner activity. Someone was maintaining this fossil."
N2_C4=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL2_ID" "$N2_C3" \
    "The chief closed the archive's great doors and began an audit she knew she was not authorized to perform. The patterns she found made her hands shake on the keyboard."
N2_C5=$CHAPTER_ID
submit_chapter "$PK_WRITER_C" "$NOVEL2_ID" "$N2_ROOT" \
    "A third librarian, working the night shift, noticed the archive's access logs showed an impossible entry: someone had read block negative one. That block should not exist."
N2_C6=$CHAPTER_ID

next_salt; run_round "$NOVEL2_ID" "$N2_C4" "$N2_C5" "$SALT_SEED"
ok "Novel 2: round 2 settled"

# Round 3
submit_chapter "$PK_WRITER_A" "$NOVEL2_ID" "$N2_C4" \
    "The signature resolved to a name Elena recognized from an old lecture: a supposedly long-retired chain surveyor with a reputation for asking uncomfortable questions about consensus."
N2_C7=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL2_ID" "$N2_C5" \
    "The audit revealed a pattern of careful deletions, evenly spaced across decades, and every last one of them pointed straight back to the archive's own administrative keys."
N2_C8=$CHAPTER_ID

next_salt; run_round "$NOVEL2_ID" "$N2_C7" "$N2_C8" "$SALT_SEED"
ok "Novel 2: round 3 settled"

# Round 4
submit_chapter "$PK_WRITER_A" "$NOVEL2_ID" "$N2_C7" \
    "Elena found the retired surveyor living off-chain, in a cabin with no network access. He said one thing: 'The archive is not what it pretends to be. It never was. Look deeper.'"
N2_C9=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL2_ID" "$N2_C8" \
    "The chief destroyed her audit trail and resigned. Her final note to Elena read: 'Trust the echoes, not the ledger. The truth is in what was deliberately not recorded.'"
N2_C10=$CHAPTER_ID
submit_chapter "$PK_WRITER_C" "$NOVEL2_ID" "$N2_C6" \
    "The night-shift librarian quietly copied block negative one before it vanished. Its contents were a single sentence: 'Everything you have archived is a carefully constructed lie.'"
N2_C11=$CHAPTER_ID

next_salt; run_round "$NOVEL2_ID" "$N2_C9" "$N2_C10" "$SALT_SEED"
ok "Novel 2: round 4 settled"

echo ""
ok "Novel 2 complete: 4 rounds"
echo ""

# ═══════════════════════════════════════════════════════════════
#  Novel 3: Fork of Novel 1 from the archivist's branch
# ═══════════════════════════════════════════════════════════════
step "Novel 3 · Fork: The Archivist's Path (fork from Novel 1, 3 rounds)"

NOVEL3_METADATA="(The Archivist Path,A fork exploring what happens when the archivist's discovery takes center stage. An alternate timeline where the quiet investigator becomes the protagonist.,https://picsum.photos/seed/novel3/400/560)"
make_content "The archivist stood at the crossroads of two timelines. In this branch of reality, her discovery of the pre-genesis transaction would not be a footnote but the main story."

# Fork from the archivist's chapter (N1_C13)
cast_send_value "$PK_CREATOR" "0.3ether" "$NOVEL_CORE_ADDRESS" \
    "$FORK_NOVEL_SIG" "$N1_C13" "$NOVEL_CONFIG" "$NOVEL3_METADATA" "$CONTENT_TUPLE"
NOVEL3_ID=$(novel_count)
CHAPTER_ID=$(chapter_count)
N3_ROOT=$CHAPTER_ID
ok "Created novel #$NOVEL3_ID (fork from Novel 1 ch#$N1_C13, root #$N3_ROOT)"

# Round 1
submit_chapter "$PK_WRITER_A" "$NOVEL3_ID" "$N3_ROOT" \
    "In this timeline, the archivist did not broadcast her findings. Instead, she followed the pre-genesis trail alone, descending into layers of the blockchain no one knew existed."
N3_C2=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL3_ID" "$N3_ROOT" \
    "A rival archivist intercepted fragments of the same trail. Unlike our protagonist, he intended to sell what he found to the highest bidder among the feuding network factions."
N3_C3=$CHAPTER_ID
submit_chapter "$PK_WRITER_C" "$NOVEL3_ID" "$N3_ROOT" \
    "The archive's AI monitoring system detected anomalous access patterns and began its own investigation, not knowing it was about to become a key player in the unfolding drama."
N3_C4=$CHAPTER_ID

next_salt; run_round "$NOVEL3_ID" "$N3_C2" "$N3_C3" "$SALT_SEED"
ok "Novel 3: round 1 settled"

# Round 2
submit_chapter "$PK_WRITER_A" "$NOVEL3_ID" "$N3_C2" \
    "Deep in the sub-genesis layers, the archivist found something impossible: a running process that predated the blockchain itself, humming with purpose in the digital darkness."
N3_C5=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL3_ID" "$N3_C3" \
    "The rival auctioned his fragments to three factions simultaneously, triggering a bidding war that escalated into the first cross-chain conflict the network had ever seen."
N3_C6=$CHAPTER_ID
submit_chapter "$PK_WRITER_C" "$NOVEL3_ID" "$N3_C4" \
    "The AI system, now fully autonomous, began correlating the archivist's trail with historical anomalies. Its conclusion was alarming: the blockchain was built on top of something older."
N3_C7=$CHAPTER_ID

next_salt; run_round "$NOVEL3_ID" "$N3_C5" "$N3_C6" "$SALT_SEED"
ok "Novel 3: round 2 settled"

# Round 3
submit_chapter "$PK_WRITER_A" "$NOVEL3_ID" "$N3_C5" \
    "The pre-genesis process spoke to her in pure mathematics. It was not AI, not human, but something else entirely: the substrate upon which all computation had been unknowingly built."
N3_C8=$CHAPTER_ID
submit_chapter "$PK_WRITER_B" "$NOVEL3_ID" "$N3_C6" \
    "The cross-chain war reached the archive's doorstep. Factions demanded access to the sub-genesis layers. The archivist realized she had to choose: share the truth or protect it."
N3_C9=$CHAPTER_ID
submit_chapter "$PK_WRITER_C" "$NOVEL3_ID" "$N3_C7" \
    "The AI's final report was a single line: 'We are not the first digital civilization to exist here. We are merely the latest tenants of an incomprehensibly ancient computational universe.'"
N3_C10=$CHAPTER_ID

next_salt; run_round "$NOVEL3_ID" "$N3_C8" "$N3_C9" "$SALT_SEED"
ok "Novel 3: round 3 settled"

echo ""
ok "Novel 3 complete: 3 rounds (fork of Novel 1)"
echo ""

# ═══════════════════════════════════════════════════════════════
#  Set nicknames for test accounts
# ═══════════════════════════════════════════════════════════════
step "Setting nicknames"

set_nickname() {
    local pk="$1" name="$2"
    # Pad name to 32 bytes (hex)
    local hex
    hex="0x$(printf '%s' "$name" | xxd -p | tr -d '\n')"
    # Right-pad to 64 hex chars (32 bytes)
    while [ ${#hex} -lt 66 ]; do hex="${hex}0"; done
    cast_send "$pk" "$NOVEL_CORE_ADDRESS" "setNickname(bytes32)" "$hex"
}

set_nickname "$PK_CREATOR" "StoryCreator"
set_nickname "$PK_WRITER_A" "Alice"
set_nickname "$PK_WRITER_B" "Bob"
set_nickname "$PK_WRITER_C" "Charlie"
ok "Nicknames set for Creator, Alice, Bob, Charlie"

# ═══════════════════════════════════════════════════════════════
#  Summary
# ═══════════════════════════════════════════════════════════════
TOTAL_NOVELS=$(novel_count)
TOTAL_CHAPTERS=$(chapter_count)

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Seed data loaded${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Novels:    $TOTAL_NOVELS (2 original + 1 fork)"
echo -e "  Chapters:  $TOTAL_CHAPTERS"
echo -e "  Rounds:    10 + 4 + 3 = 17 total"
echo -e "  Nicknames: 4 accounts"
echo ""
echo -e "  Novel 1: 10 rounds, ~33 chapters, multi-branch tree"
echo -e "           - 2 main worldline branches (A & B)"
echo -e "           - archivist off-worldline branch (depth 5)"
echo -e "           - splinter group off-worldline branch (depth 3)"
echo -e "           - extra off-worldline branches from root"
echo -e "  Novel 2: 4 rounds, ~11 chapters, simpler tree"
echo -e "  Novel 3: 3 rounds, ~10 chapters, fork of Novel 1"
echo ""
echo -e "  Frontend:  http://localhost:3000"
echo -e "  Indexer:   http://localhost:3001/health  (wait a few seconds for events)"
echo ""
