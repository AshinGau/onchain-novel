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
- Fork fee to the **source pool** = `max(submissionFee, sourcePoolBalance * FORK_FEE_RATE / 10000)`. Successful novels cost more to fork.
- **Caller total payment** = `forkFee + config.submissionFee`. The extra `submissionFee` is deposited as the **new novel's genesis pool**.
- **`FORK_FEE_RATE = 100` (1%) is a protocol-level constant, not per-novel configurable.** Rationale: if creators could set their own rate, they would set it prohibitively high (e.g. 10000 = 100%) to make their novels effectively un-forkable, defeating the open-collaboration premise. Keeping it at the protocol level guarantees every novel is forkable on the same economic terms.
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

**Revealing**: `revealVote(novelId, voter, candidateId, salt)`. Duration: `revealDuration`. The call is permissionless — anyone (keeper, voter, third party) may submit the reveal for a given voter; the voter binding in `commitHash` prevents vote redirection (see §2.5 Keeper-Assisted Reveal).

> **Uniform weight.** `commitVote` enforces `msg.value == voteStake` exactly, so every voter stakes identical ETH and therefore contributes identical **base** weight. The only differentiator is the 3× accuracy multiplier at reward time (§3.5). There is no partial-stake or superlinear-stake voting.

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

All revealed voters share `voterRewards` in proportion to their weight. Accurate voters (voted for a winning world line) get **3×**; revealed-but-wrong voters get **1×**. Unrevealed voters forfeit 50% of stake (see below).

**Distribution formula** (`VotingEngine.settleVoterRewards` + `claimVotingReward`):
```
myWeight    = accurate ? 3 * voteStake : voteStake
totalWeight = totalRevealedStake + 2 * totalAccurateStake
myReward    = min(voterRewards * myWeight / totalWeight, voteStake * 20)
```
The identity `totalWeight = revealedStake + 2 × accurateStake` holds because the `1×` contribution for every revealed voter is already in `totalRevealedStake`; the extra `+2×` reflects the bonus for accurate voters (bringing their multiplier to 3×). Revealed voters always recover their stake in full. **Unrevealed voters** forfeit `voteStake * UNREVEAL_PENALTY_RATE_BP / 10000` (50%); the penalty is added to the voter reward pool.

**Per-address reward cap** (protocol constant): a single voter's payout in one round is capped at `voteStake * VOTER_REWARD_CAP_MULTIPLIER` (20×), applied after the 3× multiplier. Excess from the cap + any undistributed remainder returns to the prize pool on settlement. This is a safety rail for edge cases where the reward pool is huge relative to the number of revealed voters — not a per-novel tuning knob.

| Protocol Constant | Value | Description |
|-------------------|-------|-------------|
| `VOTER_REWARD_CAP_MULTIPLIER` | 20 | Per-address voter reward cap = 20 × voteStake |
| `UNREVEAL_PENALTY_RATE_BP` | 5000 (50%) | Unrevealed voters forfeit half their stake |
| `CREATOR_DECAY_DIVISOR` | 3 | Creator royalty decay: share = 3/(3+round) |

### 3.6 Keeper Rewards

Each of the four round-phase transitions (`startRound`, `closeNomination`, `closeCommit`, `settleRound`) credits `keeperRewardAmount` from the prize pool to the caller's pending balance (pull-based, claimed via `claimReward`). If the pool balance is below `keeperRewardAmount`, the call **silently skips the payout** — the phase transition still succeeds. `keeperRewardAmount` is a global protocol parameter set by the owner on `PrizePool`.

### 3.7 Novel Completion (`completeNovel`)

When a novel is wound down, 100% of the remaining pool is distributed to **every author on every world line** (walked from each `worldLineAncestor` back to the root). Preconditions and permissions:

- Novel must be `active` and have `currentRound >= 1` and phase `Idle`.
- Allowed callers (immediate): creator, keeper, owner.
- After `INACTIVITY_TIMEOUT = 30 days` since `max(phaseStartTime, latest worldLineAncestor timestamp)`, **anyone** may call it.
- Distribution uses `releaseRate = 10000` (100%) and `voterRewardRate = 0` (no voter rewards — rounds are over).
- Rounding dust is re-deposited to the pool with reason `"completionDust"`.
- On success, `active` is flipped to false.

> Security note: at `currentRound = 1`, the creator-royalty decay `3/(3+1) = 75%` would send 75% of the pool to the creator in a single completion call. Protocol defaults and product flow assume completion happens after several rounds; an early completion is allowed by design but should be socially / economically discouraged (see `docs/audit-consolidated.md` H-1 for the trade-off analysis).

---

## 4. Tips and Continuation Bounties (BountyBoard)

### 4.1 Tip Novel

Full amount goes to prize pool.

### 4.2 Tip Chapter

50% credited to the chapter author's pending balance (pull-based), 50% to prize pool. Author calls `NovelCore.claimReward(novelId)` — which delegates to `PrizePool.claimReward` — to withdraw accumulated tips alongside any other pending rewards. Minimum tip is `MIN_TIP_AMOUNT = 0.001 ETH`.

### 4.3 Continuation Bounty

- **Create** (`createBounty`): minimum `MIN_BOUNTY_AMOUNT = 0.001 ETH`. 20% immediately to prize pool, 80% locked; `createTime` is recorded on-chain.
- **Qualifying continuations** are **direct child chapters whose timestamp falls within `[createTime, deadline]`** — pre-existing children written before the bounty was posted do not qualify. One share per author regardless of how many qualifying children they submitted.
- **Designation**: before the deadline, the tipper may call `designateBounty(bountyId, chapterId)` to pin the entire 80% to one qualifying direct child's author.
- **Claim paths after deadline**:
  - Has qualifying authors: each calls `claimBounty` to pull their equal share (or the designated author claims the full amount).
  - No qualifying authors: tipper calls `refundBounty` to recover the 80%.
- **Grace-period sweep** (`CLAIM_GRACE_PERIOD = 30 days`): after deadline + 30 days, any unclaimed remainder may be swept back to the tipper via `sweepUnclaimed(bountyId)`. This guarantees funds never go permanently unclaimed even if qualifying authors are inactive.

---

## 5. Security

- **Keeper single-attack-surface**: the ONLY input a malicious keeper controls is the `leaves[]` passed to `startRound` (bias which tree leaf per world line becomes the candidate). Winner selection, reward-author derivation (parent-chain walk via `NovelCore.collectPathAuthors`), vote integrity (commit-reveal), and prize distribution are fully on-chain. Phase transitions have anyone-after-`KEEPER_INACTIVITY_TIMEOUT` fallback; this single residual weakness is the core value proposition of onchain-novel (§2.2).
- **Off-chain leaf pick, on-chain walk**: keeper picks leaves off-chain (any algorithm, typically DFS over the novel tree); reward-author derivation and final-authors collection are on-chain parent-chain walks bounded by `MAX_PROOF_PATH_LENGTH` (1024). submissionFee + minRoundGap bound tree depth between rounds.
- **Voting game theory**: fixed `voteStake` (every voter stakes the same amount, uniform base weight), 3× accuracy multiplier with a per-address payout cap of `20 × voteStake`, commit-reveal prevents following. Keeper-assisted reveal reduces user friction without compromising commit-reveal security (Keeper cannot alter committed votes).
- **Chapter spam**: submissionFee + minChapterLength + N candidate slots + nomination rescue.
- **UUPS hygiene**: all upgradeable implementations disable their own initializer via `_disableInitializers()` constructors, preventing a direct-on-implementation `initialize` attack that could culminate in `selfdestruct` of the logic contract.
- **Reentrancy**: all cash-flow functions are `nonReentrant`. Since OZ 5.5 the `ReentrancyGuard` slot is ERC-7201 namespaced and upgrade-safe; we use `ReentrancyGuardTransient` (EIP-1153) for ~4.8 k gas savings per call. **Requires chains supporting EIP-1153 (Ethereum Cancun and later, plus Base / Optimism / Arbitrum / Polygon / BNB post-upgrade).**
- **Pausable**: `NovelCore`, `RoundManager`, `PrizePool`, `BountyBoard` expose an owner `pause()/unpause()` kill-switch on cash-flow and state-transition entry points.
- **Protocol fee**: removed; can be added via upgrade.

---

## 6. Configuration Reference

### 6.1 Per-Novel Config (`NovelConfig`, set by creator at `createNovel`)

| Parameter | Bounds | Suggested Default | Description |
|-----------|--------|-------------------|-------------|
| `minChapterLength` | > 0, ≤ `maxChapterLength` | 100 bytes | Minimum chapter length |
| `maxChapterLength` | ≥ `minChapterLength` | 50,000 bytes | Maximum chapter length |
| `submissionFee` | ≥ `MIN_SUBMISSION_FEE` (0.0001 ETH) | 0.005 ETH | Submission fee; also the **ceiling** for `voteStake` |
| `worldLineCount` (N) | 1 ≤ N ≤ `MAX_WORLD_LINE_COUNT` (16) | 3 | World lines per round |
| `voteStake` | ≤ `submissionFee` | 0.001 ETH | Fixed stake per vote (uniform across voters) |
| `nominationFee` | — | 0.01 ETH | Per-nomination fee |
| `nominateDuration` | > 0 | 1 day | Nomination phase |
| `commitDuration` | > 0 | 2 days | Commit phase |
| `revealDuration` | > 0 | 1 day | Reveal phase |
| `minRoundGap` | — | 1 day | Minimum gap between rounds |
| `prizeReleaseRate` | ≤ 5000 (50%) | 2000 (20%) | Per-round release rate (bps) |
| `voterRewardRate` | ≤ 5000 (50%) | 1500 (15%) | Voter reward rate (bps of `releaseAmount - creatorRoyalty`) |
| `ruleFee` | — | 0.001 ETH | Fee for `RulesEngine.proposeRule` |
| `ruleVoteDuration` | > 0 if `ruleQuorum > 0` | 3 days | Rule proposal voting duration |
| `ruleQuorum` | — | N/A | Minimum yes-votes for rule proposal to pass |

**Invariant**: `voteStake ≤ submissionFee` — voting must not cost more than writing.

### 6.2 Protocol Constants (hardcoded, not per-novel)

| Constant | Location | Value | Description |
|----------|----------|-------|-------------|
| `FORK_FEE_RATE` | `NovelCore` | 100 bps (1%) | `forkFee = max(submissionFee, sourcePool × 1%)` |
| `MIN_SUBMISSION_FEE` | `NovelCore` | 0.0001 ETH | Absolute floor on `submissionFee` |
| `MAX_WORLD_LINE_COUNT` | `NovelCore` | 16 | Cap on `config.worldLineCount` |
| `MAX_PROOF_PATH_LENGTH` | `NovelCore` | 1024 | Cap on parent-chain walk depth |
| `CREATOR_DECAY_DIVISOR` (D) | `PrizePool` | 3 | Royalty share = `D / (D + round)` |
| `MIN_TIP_AMOUNT` | `PrizePool` | 0.001 ETH | `tipNovel` / `tipChapter` floor |
| `VOTER_REWARD_CAP_MULTIPLIER` | `VotingEngine` | 20 | Per-address cap = 20 × voteStake |
| `UNREVEAL_PENALTY_RATE_BP` | `VotingEngine` | 5000 (50%) | Forfeit on not revealing |
| `MAX_VOTERS_PER_ROUND` | `VotingEngine` | 500 | Hard cap, reverts `TooManyVoters` |
| `INACTIVITY_TIMEOUT` | `RoundManager` | 30 days | Public-`completeNovel` grace window |
| `KEEPER_INACTIVITY_TIMEOUT` | `RoundManager` | 1 day | Public fallback per phase-transition call |
| `MAX_CANDIDATES_PER_ROUND` | `RoundManager` | 64 | Cap on `leaves[] + nominations` |
| `MIN_BOUNTY_AMOUNT` | `BountyBoard` | 0.001 ETH | `createBounty` floor |
| `CLAIM_GRACE_PERIOD` | `BountyBoard` | 30 days | Post-deadline window before tipper sweep |

---

## 7. Events

Indexed by contract. See `docs/backend.md` for the indexer-side schema. Signatures are authoritative; types mirror storage (`uint64` IDs, `uint32` round).

**NovelCore**
- `NovelCreated(uint64 indexed novelId, address indexed creator)`
- `NovelForked(uint64 indexed novelId, uint64 indexed sourceChapterId, address indexed creator)`
- `ChapterSubmitted(uint64 indexed novelId, uint64 indexed chapterId, uint64 parentId, address indexed author, bytes32 contentHash, uint64 timestamp)`
- `RewardClaimed(uint64 indexed novelId, address indexed recipient, uint256 amount)` *(re-emits from PrizePool for indexer convenience)*
- `NovelMetadataUpdated(uint64 indexed novelId, string title, string description, string coverUri)`

**RoundManager**
- `KeeperUpdated(address indexed oldAddr, address indexed newAddr)`
- `RoundStarted(uint64 indexed novelId, uint32 round, uint64[] candidates)`
- `NominationClosed(uint64 indexed novelId, uint32 round)`
- `CommitClosed(uint64 indexed novelId, uint32 round)`
- `RoundSettled(uint64 indexed novelId, uint32 round, uint64[] worldLines)`
- `CandidateNominated(uint64 indexed novelId, uint32 round, uint64 chapterId, address nominator)`
- `VoteCommitted(uint64 indexed novelId, uint32 round, address indexed voter)`
- `VoteRevealed(uint64 indexed novelId, uint32 round, address indexed voter, uint64 candidateId)`
- `NovelCompleted(uint64 indexed novelId)`
- `KeeperRewarded(uint64 indexed novelId, address indexed keeper, uint256 amount)`
- `RewardClaimed(uint64 indexed novelId, address indexed recipient, uint256 amount)` *(voter reward claim)*

**PrizePool**
- `PoolDeposited(uint64 indexed novelId, uint256 amount, string reason)`
- `RoundRewardsDistributed(uint64 indexed novelId, uint32 round, uint256 releaseAmount, uint256 creatorRoyalty, uint256 authorRewards, uint256 voterRewards)`
- `TipReceived(uint64 indexed novelId, address indexed tipper, uint256 amount)`
- `ChapterTipped(uint64 indexed novelId, uint64 indexed chapterId, address indexed tipper, uint256 amount)`
- `RewardClaimed(uint64 indexed novelId, address indexed recipient, uint256 amount)`
- `KeeperRewardPaid(uint64 indexed novelId, address indexed keeper, uint256 amount)`

**BountyBoard**
- `BountyCreated(uint64 indexed bountyId, uint64 indexed novelId, uint64 indexed chapterId, address tipper, uint256 amount, uint64 deadline)`
- `BountyClaimed(uint64 indexed bountyId, address indexed author, uint256 amount)`
- `BountyDesignated(uint64 indexed bountyId, uint64 indexed chapterId)`
- `BountyRefunded(uint64 indexed bountyId, address indexed tipper, uint256 amount)`

**RulesEngine**
- `RuleSet(uint64 indexed novelId, string name)`
- `RuleDeleted(uint64 indexed novelId, string name)`
- `RuleProposed(...)` / `RuleProposalVoted(uint64 indexed proposalId, address indexed voter, uint32 newVoteCount)`

**UserRegistry**
- `NicknameSet(address indexed user, bytes32 nickname)`

> **Note on `RewardClaimed` topic collision**: `NovelCore`, `RoundManager`, and `PrizePool` all emit an event with the same signature. Indexers must disambiguate by **emitting contract address**, not by topic0 alone.

---

## 8. Error Catalog (selected)

All custom errors are defined on the emitting contract. Listed here are the user-facing ones most likely surfaced in the frontend.

| Error | Meaning |
|-------|---------|
| `InvalidConfig(uint8 code)` | `NovelCore` config validation failure; `code` identifies the failing field (see `_validateConfig`) |
| `NovelNotFound(uint64)` / `ChapterNotFound(uint64)` | ID does not exist |
| `NovelNotActive(uint64)` | Novel has been completed |
| `InvalidFee(sent, required)` / `InsufficientForkFee(sent, required)` | msg.value wrong |
| `ContentLengthOutOfRange(length, min, max)` | Chapter body bounds violated |
| `ContentHashMismatch(expected, actual)` | For `Onchain` content mode, calldata hash ≠ declared |
| `WrongRoundPhase(expected, actual)` | Phase-gated call at the wrong time |
| `PhaseNotExpired()` / `MinRoundGapNotMet()` | Time-gated call too early |
| `InsufficientLeaves` / `TooManyLeaves` / `LeafHasChildren` / `DuplicateLeaf` | `startRound` leaves validation |
| `AlreadyACandidate` / `InvalidPathAnchor` | `nominateCandidate` validation |
| `NotKeeperYet()` | Public-fallback called before `KEEPER_INACTIVITY_TIMEOUT` |
| `NotAllowedToComplete()` / `NovelHasNoRound()` / `NovelAlreadyCompleted` | `completeNovel` guards |
| `AlreadyCommitted` / `AlreadyRevealed` / `InvalidReveal` / `InvalidCandidate` / `TooManyVoters` | VotingEngine flow |
| `NoPendingReward()` / `NoRewardToClaim()` | Claim on empty balance |
| `TipTooSmall(amount, min)` | Below `MIN_TIP_AMOUNT` |
| `BountyTooSmall(amount, min)` / `DeadlineInPast` / `DeadlineNotReached` / `DeadlineReached` / `AlreadyClaimed` / `BountyFullyClaimed` / `NoQualifyingAuthors` / `NotQualifyingAuthor` / `NotDesignatedAuthor` / `NotTipper` / `NotDirectChild` / `QualifyingAuthorsExist` / `GracePeriodNotExpired` | BountyBoard flow |
