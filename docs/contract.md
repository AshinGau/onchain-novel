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
    uint64[] descendants;   // child chapter ID list (bidirectional index)
}
```

**uint64 IDs**: 2^64 covers all chapter/novel needs; struct packing significantly reduces storage slot consumption.

**Bidirectional index**: parentId traverses up, descendants traverses down. Downward traversal enables DFS from world line ancestors at `startRound` to find the deepest M chains, without maintaining a separate candidate pool at submission time.

### 1.2 Submission Rules

- **Submit any time**, unaffected by voting phase
- Any existing chapter can be a parent (including those not on a world line)
- Submission pays `submissionFee` (non-refundable), goes directly to prize pool
- Same author can submit multiple chapters, no frequency limit (fee itself is anti-spam)
- Root chapter (depth = 1) can only be submitted by creator during `createNovel` / `forkNovel`, exactly one
- On submission, `chapters[parentId].descendants.push(chapter.id)` automatically, O(1)

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
- Fork fee = `max(submissionFee, sourcePoolBalance * forkFeeRate / 10000)`, goes to the **source novel's** prize pool. `forkFeeRate` is a contract-level constant; successful novels cost more to fork
- New novel's config is freely configurable (`contentLocation` inherited from source)

---

## 2. Voting Mechanism

### 2.1 Why Candidates Are Necessary

Users cannot vote on arbitrary chapterIds -- a fixed candidate set is required. Reason: **vote splitting**.

Example: two story lines `C1<-C2<-C3` and `C1<-A1<-A2`. Three votes: C2(weight 1), C3(weight 1), A2(weight 1.1). If arbitrary chapter voting were allowed, A2 wins at 1.1. But C2 and C3 are on the same chain; merged weight is 2, and should win.

**The candidate set ensures each chain has exactly one representative (its deepest chapter), preventing vote splitting.**

### 2.2 Candidate Generation -- DFS from World Line Ancestors

Using the descendants bidirectional index, `startRound` does DFS from each worldLineAncestor to find the M = 3*N deepest chains (N = `worldLineCount`, set by creator).

**Gas cost**: DFS traversal count = all chapters derived from N ancestors between two rounds. submissionFee naturally limits chapter count. `maxDfsNodes` provides a safety cap.

### 2.3 Three-Phase Voting

```
Nominating -> Committing -> Revealing -> Settlement
```

**Nominating**: Keeper calls `startRound()`. Contract does DFS from worldLineAncestors to auto-generate candidates. Requires DFS candidates >= 1. Users can pay `nominationFee` to nominate additional chains. Duration: `nominateDuration`.

**Committing**: `commitVote(novelId, commitHash)`, requires staking `voteStake`. One vote per address per round. Duration: `commitDuration`.

**Revealing**: `revealVote(novelId, candidateId, salt)`, vote weight = staked amount. Duration: `revealDuration`.

**Settlement**: Keeper calls `settleRound()`. Selects top N world lines by weighted votes (fewer than N if insufficient candidates). Ties broken by greater depth. Updates worldLineAncestors. Distributes rewards. Returns stakes. Returns to Idle.

### 2.4 State Flow

```
[Idle] -> startRound(DFS) -> [Nominating] -> closeNomination -> [Committing]
-> closeCommit -> [Revealing] -> settleRound -> [Idle]
```

Writing and voting run in parallel, never blocking each other.

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

Voted for world line: 3x weight. Did not: 1x weight. Unrevealed stakes are confiscated and distributed to revealed voters.

### 3.6 Keeper Rewards

Each state transition pays `keeperRewardAmount` from prize pool.

---

## 4. Tips and Continuation Bounties (BountyBoard)

### 4.1 Tip Novel

Full amount goes to prize pool.

### 4.2 Tip Chapter

50% push-transferred to author, 50% to prize pool. Push failure: 100% to pool.

### 4.3 Continuation Bounty

- Create: 20% immediately to prize pool, 80% locked
- Has continuations: 80% split among authors who submitted before deadline
- No continuations: 80% refunded to reader

---

## 5. Security

- **Keeper trustlessness**: candidates come from DFS, deterministic algorithm. Nomination as fallback.
- **DFS gas safety**: `maxDfsNodes` upper bound.
- **Voting game theory**: linear weight = no sybil advantage, commit-reveal prevents following, 3x accuracy incentive.
- **Chapter spam**: submissionFee + minChapterLength + M=3*N candidate slots + Nomination rescue.
- **Protocol fee**: removed; can be added via upgrade.

---

## 6. Configuration Reference

| Parameter | Suggested Default | Description |
|-----------|-------------------|-------------|
| `minChapterLength` | 100 bytes | Minimum chapter length |
| `maxChapterLength` | 50,000 bytes | Maximum chapter length |
| `submissionFee` | 0.001 ETH | Submission fee |
| `worldLineCount` (N) | 3 | World lines per round |
| `voteStake` | 0.005 ETH | Vote stake |
| `nominationFee` | 0.01 ETH | Nomination fee |
| `nominateDuration` | 1 day | Nomination phase |
| `commitDuration` | 2 days | Commit phase |
| `revealDuration` | 1 day | Reveal phase |
| `minRoundGap` | 1 day | Minimum gap between rounds |
| `prizeReleaseRate` | 2000 (20%) | Per-round release rate |
| `voterRewardRate` | 1500 (15%) | Voter reward rate |
