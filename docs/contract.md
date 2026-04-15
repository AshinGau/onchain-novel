# Contract Design

## 1. Chapter Tree

### 1.1 Data Structure

```solidity
struct Chapter {
    uint64 id;              // globally unique ID
    uint64 novelId;
    uint64 parentId;        // 0 = original novel root; cross-novel ID = fork root; same-novel ID = continuation
    address author;
    bytes32 contentHash;
    uint64 declaredLength;
    uint32 depth;           // tree depth within this novel, root = 1
    uint64 timestamp;
    uint64[] children;      // direct child chapter ID list (bidirectional index)
}
```

**uint64 IDs**: 2^64 covers all chapter/novel needs; struct packing significantly reduces storage slot consumption.

**Bidirectional index**: parentId traverses up, children traverses down. Downward traversal lets keeper / indexer pick leaves off-chain; on-chain `startRound` only verifies each provided leaf is a true tree leaf (children empty) belonging to the novel.

### 1.2 Submission Rules

- **Submit any time**, unaffected by voting phase
- Any existing chapter can be a parent (including those not on a world line)
- Submission pays `submissionFee` (non-refundable), goes directly to prize pool
- Same author can submit multiple chapters, no frequency limit (fee itself is anti-spam)
- Root chapter (depth = 1) can only be submitted by creator during `createNovel` / `forkNovel`, exactly one
- On submission, `chapters[parentId].children.push(chapter.id)` automatically, O(1)

### 1.3 Chain Definition

A **chain** is the complete path from root to some chapter. A chain is uniquely identified by its terminal chapter ID.

```
root(1) -> ch(2) -> ch(4) -> ch(7)    <- chain 7
               +-> ch(5) -> ch(8)     <- chain 8
          +-> ch(3) -> ch(6)          <- chain 6
```

**Voting targets a chapterId**, not a "leaf" -- since writing continues during voting, any chapter may gain new descendants at any time.

### 1.4 Fork

**Core design: A fork novel's root chapter has parentId pointing to the source novel's fork chapter (cross-novel reference).**

Novel type detection:
- **Original novel**: root chapter parentId = 0, depth = 1
- **Fork novel**: root chapter parentId != 0 && depth == 1

Only chapter fields needed, no extra SLOAD.

Fork rules:
- Fork initiator becomes the new novel's **creator**
- Fork root is **new content** written by the forker (not a copy of the source chapter); parentId points to source chapter only as origin marker
- Fork fee = `max(submissionFee, sourcePoolBalance * forkFeeRate / 10000)`, goes to the **source novel's** prize pool. Successful novels cost more to fork
- **`forkFeeRate` is a protocol-level constant, not per-novel configurable.** Rationale: if creators could set their own rate, they would set it prohibitively high (e.g. 10000 = 100%) to make their novels effectively un-forkable, defeating the open-collaboration premise. Keeping it at the protocol level guarantees every novel is forkable on the same economic terms
- **Self-fork is permitted**. The original creator may fork their own novel; this resets `currentRound` to 1 and therefore `creatorRoyalty` back to its initial 75%. This is intentional, not an exploit: the chain is fully transparent, and any reader or co-author who feels the reset is unfair can either fork the same chapter themselves or stay in the original novel. Forced creator loyalty would require off-chain enforcement that this protocol explicitly avoids
- New novel's config is freely configurable (`contentLocation` inherited from source)

---

## 2. Voting Mechanism

### 2.1 Why Candidates Are Necessary

Users cannot vote on arbitrary chapterIds -- a fixed candidate set is required. Reason: **vote splitting**.

Example: two story lines `C1<-C2<-C3` and `C1<-A1<-A2`. Three votes: C2(weight 1), C3(weight 1), A2(weight 1.1). If arbitrary chapter voting were allowed, A2 wins at 1.1. But C2 and C3 are on the same chain; merged weight is 2, and should win.

**The candidate set ensures each chain has exactly one representative (its deepest chapter), preventing vote splitting.**

### 2.2 Candidate Generation & Keeper Trust Model

`startRound` is **keeper-only** (with anyone-after-`KEEPER_INACTIVITY_TIMEOUT` fallback). The keeper computes the N deepest leaves off-chain (one per world line) and supplies them as `leaves[]`. On-chain validation: each leaf must belong to the novel and have `children.length == 0`.

**Keeper's single attack surface.** The `leaves[]` input to `startRound` is the ONLY privileged lever the keeper controls. A malicious keeper can at most bias *which* leaf per world line becomes the candidate (still a real tree leaf belonging to the novel), or stall — after `KEEPER_INACTIVITY_TIMEOUT` anyone may take over each phase. A keeper **cannot**:

- pick winners — that comes from on-chain `VotingEngine.tallyVotes`,
- fabricate or suppress reward authors — derived on-chain via `NovelCore.collectPathAuthors` walking `parentId` from each winner up to the previous world line ancestor,
- alter committed votes (commit-reveal prevents that), or
- drain / withhold the prize pool — release / decay rules are fixed protocol constants.

This keeps **"keeper picks which leaf per world line"** as the single residual trust assumption — the one weakness users must accept, and the core value proposition of onchain-novel. Settlement and completion run parent-chain walks entirely on-chain; no "heavy" data is ever supplied by off-chain callers.

**Gas cost**: O(leaves.length) leaf check on startRound; O(total_depth_between_rounds) parent-chain walk on settleRound. submissionFee + minRoundGap naturally bound chapter count and chain depth.

### 2.3 Three-Phase Voting

```
Nominating -> Committing -> Revealing -> Settlement
```

**Nominating**: Keeper calls `startRound(leaves[])` supplying N true tree leaves (one per world line). Users can pay `nominationFee` to add more via `nominateCandidate(novelId, chapterId, path)`:

- **With proof** (`path` non-empty, `path[0]=chapterId`, `path[last]=current worldLineAncestor`): chapter must descend from a current world line; if it wins, its new-path authors earn rewards at settlement.
- **Without proof** (`path` empty): any chapter in the novel is allowed as a candidate. If it wins, its authors get no reward — the nominator explicitly forfeits author rewards for this candidate. World line still advances. This is the on-chain opt-out path for nominating orphan chapters, accepted as intentional.

Duration: `nominateDuration`.

**Committing**: `commitVote(novelId, commitHash)`, requires staking `voteStake`. One vote per address per round. Duration: `commitDuration`.

**Revealing**: `revealVote(novelId, voter, candidateId, salt)`, vote weight = staked amount. Duration: `revealDuration`. The call is permissionless — anyone (keeper, voter, third party) may submit the reveal for a given voter; the voter binding in `commitHash` prevents vote redirection (see §2.5 Keeper-Assisted Reveal).

**Settlement**: Keeper calls `settleRound(novelId)` — no path arguments. `VotingEngine.tallyVotes` selects top N (stable insertion sort; fewer than N if insufficient candidates). For each winner, `NovelCore.collectPathAuthors` walks `parentId` up to any previous world line ancestor (anchor excluded — already rewarded); if no anchor reached (orphan winner from a forfeit nomination), that winner contributes zero authors. Rewards distributed, unrevealed stakes processed (see §3.5), worldLineAncestors replaced, return to Idle.

### 2.4 State Flow

```
[Idle] -> RoundManager.startRound(leaves[]) -> [Nominating]
      -> closeNomination -> [Committing]
      -> closeCommit -> [Revealing]
      -> settleRound -> [Idle]

All phase-transition and voting calls live on `RoundManager`. `NovelCore` only
stores the persistent state (novels, chapters, worldLineAncestors) and exposes
privileged setters gated by `onlyRoundManager`. Rule-proposal voting eligibility
is proven on-demand via `verifyWorldLineAuthor(novelId, expectedAuthor, path)`
— no flag mapping is maintained.
```

Writing and voting run in parallel, never blocking each other.

### 2.5 Keeper-Assisted Reveal

`revealVote(novelId, voter, candidateId, salt)` is **permissionless** — anyone (the keeper, the voter themselves, or a third party) can submit a reveal for any voter. The voter binding inside `commitHash = keccak256(abi.encodePacked(voter, candidateId, salt))` does all the security work: only a `(voter, c, s)` triple matching the previously-committed hash will pass. A third party who learns the salt can only **complete the reveal as the voter intended** — they cannot redirect the vote to a different candidate, nor steal the stake/reward (both flow to the committed `voter`).

This makes keeper-assisted reveal fully **trustless**:

1. At commit time, user sends plaintext `(candidateId, salt)` to the backend API alongside the on-chain `commitVote` transaction
2. Backend stores `(novelId, round, voter, candidateId, salt)` encrypted at rest
3. When reveal phase begins, the Keeper batch-calls `revealVote(novelId, voter, candidateId, salt)` for all stored votes using its own gas
4. User only needs **one on-chain interaction** (commit); reveal is automatic

**Trust model**: The Keeper (or any helper) cannot forge or alter a vote — commit hash + voter binding already fix it on-chain. The worst any party can do is fail to reveal, which is equivalent to the voter forgetting. Voters who lose their wallet but kept the salt elsewhere can still have their vote revealed by any helper.

**Fallback**: Users can always self-reveal during the reveal window.

---

## 3. Reward Distribution

### 3.1 Fund Sources

submissionFee, nominationFee, forkFee, tips, genesis fund -> Prize Pool

### 3.2 Per-Round Distribution

```
releaseAmount = poolBalance * prizeReleaseRate / 10000
creatorRoyalty = releaseAmount * D / (D + currentRound)    // D = CREATOR_DECAY_DIVISOR (3)
remaining = releaseAmount - creatorRoyalty
authorRewards = remaining * (10000 - voterRewardRate) / 10000
voterRewards = remaining - authorRewards
```

### 3.3 Creator Royalty Decay

`D/(D+round)` smooth decay. With D=3: Round 1=75%, Round 3=50%, Round 10=23%.

### 3.4 Author Rewards

Only rewards chapters newly added to world lines this round. Walk from each Wi up parentId to Ai, collect new chapters, **deduplicate then split equally**.

### 3.5 Voter Rewards

Voted for world line: 3x weight. Did not: 1x weight.

**Per-address reward cap** (protocol constant): a single voter's payout in one round is capped at `voteStake * VOTER_REWARD_CAP_MULTIPLIER` (20×). The cap is applied **after** the 3x accuracy multiplier. Any excess returns to the prize pool. Since voteStake is fixed per round, this is a safety rail for edge cases where the reward pool is huge relative to the number of revealed voters — not a per-novel tuning knob.

**Unrevealed stake penalty** (protocol constant): unrevealed voters are charged `voteStake * UNREVEAL_PENALTY_RATE_BP / 10000` = 50% of stake. The penalty enters the round's voter reward pool. The remainder is returned to the voter.

| Protocol Constant | Value | Description |
|-------------------|-------|-------------|
| `VOTER_REWARD_CAP_MULTIPLIER` | 20 | Per-address voter reward cap = 20 × voteStake |
| `UNREVEAL_PENALTY_RATE_BP` | 5000 (50%) | Unrevealed voters forfeit half their stake |
| `CREATOR_DECAY_DIVISOR` | 3 | Creator royalty decay: share = 3/(3+round) |

### 3.6 Keeper Rewards

Each state transition pays `keeperRewardAmount` from prize pool.

---

## 4. Tips and Continuation Bounties (BountyBoard)

### 4.1 Tip Novel

Full amount goes to prize pool.

### 4.2 Tip Chapter

50% credited to author (pull-based withdrawal), 50% to prize pool. Author calls `withdrawTips()` to claim accumulated tips.

### 4.3 Continuation Bounty

- Create: 20% immediately to prize pool, 80% locked; `createTime` is recorded on-chain
- Qualifying continuations are **direct child chapters whose timestamp falls within `[createTime, deadline]`** — pre-existing children written before the bounty was posted do not qualify. One share per author regardless of how many qualifying children they submitted.
- Has qualifying continuations: 80% split equally among qualifying authors (or full amount to the designated chapter's author if the tipper designated one before deadline)
- No qualifying continuations: 80% refundable to reader after the deadline

---

## 5. Security

- **Keeper single-attack-surface**: the ONLY input a malicious keeper controls is the `leaves[]` passed to `startRound` (bias which tree leaf per world line becomes the candidate). Winner selection, reward-author derivation (parent-chain walk via `NovelCore.collectPathAuthors`), vote integrity (commit-reveal), and prize distribution are fully on-chain. Phase transitions have anyone-after-`KEEPER_INACTIVITY_TIMEOUT` fallback; this single residual weakness is the core value proposition of onchain-novel (§2.2).
- **Off-chain DFS, on-chain walk**: keeper does the off-chain DFS to pick leaves; reward author derivation and final-authors collection are on-chain parent-chain walks bounded by `MAX_PROOF_PATH_LENGTH` (1024). submissionFee + minRoundGap bound tree depth between rounds.
- **Voting game theory**: fixed `voteStake` (every voter stakes the same amount), linear weight inside a protocol-level cap of `20 × voteStake`, commit-reveal prevents following, 3× accuracy incentive. Keeper-assisted reveal reduces user friction without compromising commit-reveal security (Keeper cannot alter committed votes).
- **Chapter spam**: submissionFee + minChapterLength + N candidate slots + Nomination rescue.
- **Protocol fee**: removed; can be added via upgrade.

---

## 6. Configuration Reference

| Parameter | Suggested Default | Description |
|-----------|-------------------|-------------|
| `minChapterLength` | 100 bytes | Minimum chapter length |
| `maxChapterLength` | 50,000 bytes | Maximum chapter length |
| `submissionFee` | 0.005 ETH | Submission fee (also floor for `voteStake`) |
| `worldLineCount` (N) | 3 | World lines per round |
| `voteStake` | 0.001 ETH | Vote stake (must be ≤ `submissionFee`) |
| `nominationFee` | 0.01 ETH | Nomination fee |
| `nominateDuration` | 1 day | Nomination phase |
| `commitDuration` | 2 days | Commit phase |
| `revealDuration` | 1 day | Reveal phase |
| `minRoundGap` | 1 day | Minimum gap between rounds |
| `prizeReleaseRate` | 2000 (20%) | Per-round release rate |
| `voterRewardRate` | 1500 (15%) | Voter reward rate |

**Invariant**: `voteStake ≤ submissionFee` — voting must not cost more than writing.
