# 📖 Usage Guide

This guide explains how different participants interact with the On-Chain Novel Protocol. Each role has a distinct set of contract calls.

## Table of Contents

- [Roles Overview](#roles-overview)
- [🎨 Creator — Start a Novel](#-creator--start-a-novel)
- [✍️ Author — Write & Submit Chapters](#️-author--write--submit-chapters)
- [🗳️ Voter — Vote on Story Directions](#️-voter--vote-on-story-directions)
- [📖 Reader — Tip & Support Novels](#-reader--tip--support-novels)
- [⚙️ Keeper — Trigger State Transitions](#️-keeper--trigger-state-transitions)
- [🔍 Explorer — Query On-Chain State](#-explorer--query-on-chain-state)
- [Appendix: NovelConfig Parameters](#appendix-novelconfig-parameters)
- [Appendix: Voting Round ID Computation](#appendix-voting-round-id-computation)

---

## Roles Overview

| Role | Description | Contracts Used |
|------|-------------|----------------|
| **Creator** | Launches a new novel, configures rules, injects genesis prize pool | `NovelCore` |
| **Author** | Writes chapter continuations, stakes ETH, claims refunds | `NovelCore` |
| **Voter** | Votes in commit-reveal rounds to select best chapters | `VotingEngine` |
| **Reader** | Tips novels to expand the prize pool | `PrizePool` |
| **Keeper** | Triggers phase transitions (anyone can call these) | `NovelCore` |
| **Explorer** | Reads on-chain state (view functions, no gas) | All contracts |

---

## 🎨 Creator — Start a Novel

### 1. Create a Novel

Upload your genesis content (prologue / world setting) to IPFS or Arweave, then call:

```solidity
NovelCore.createNovel{value: <prizePoolAmount>}(
    NovelConfig calldata config,
    bytes32 genesisContentHash
) → uint256 novelId
```

**Parameters:**
- `config` — Novel rules (see [NovelConfig Parameters](#appendix-novelconfig-parameters))
- `genesisContentHash` — CID of genesis content on IPFS/Arweave
- `msg.value` — ETH to seed the initial prize pool (optional, can be 0)

**Example (cast):**
```bash
cast send $NOVEL_CORE "createNovel((uint64,uint64,uint64,uint32,uint32,uint32,uint16,uint64,uint64,uint256,uint8,uint8,uint8),bytes32)" \
  "(100,10000,86400,3,2,3,3000,259200,172800,10000000000000000,2,3,20)" \
  "0x<your_ipfs_cid_as_bytes32>" \
  --value 1ether \
  --private-key $PRIVATE_KEY
```

### 2. Fork a Novel

Create a new novel branching from a rejected chapter of an existing novel:

```solidity
NovelCore.forkNovel{value: <prizePoolAmount>}(
    uint256 originalNovelId,
    uint256 branchChapterId,
    NovelConfig calldata config
) → uint256 novelId
```

> **Note:** You can only fork from chapters that are NOT currently Canon. This allows rejected but interesting branches to live on as independent stories.

---

## ✍️ Author — Write & Submit Chapters

### 1. Check Active World Lines

Before writing, check which world lines (story branches) are currently active:

```solidity
NovelCore.getActiveWorldLines(uint256 novelId) → uint256[] chapterIds
```

Read each world line's content via its `contentHash`:

```solidity
NovelCore.getChapter(uint256 chapterId) → Chapter
// → chapter.contentHash is the IPFS/Arweave CID to read
```

### 2. Submit a Chapter

Write your continuation, upload to IPFS/Arweave, then submit:

```solidity
NovelCore.submitChapter{value: <stakeAmount>}(
    uint256 novelId,
    uint256 parentChapterId,    // Must be an active world line
    bytes32 contentHash,        // Your content's IPFS/Arweave CID
    uint64 declaredLength       // Content byte length
) → uint256 chapterId
```

**Requirements:**
- Novel must be in `Submitting` phase
- `parentChapterId` must be an active world line
- `declaredLength` must be within `[minChapterLength, maxChapterLength]`
- `msg.value` must exactly equal the configured `stakeAmount`

### 3. Claim Stake Refund

After a round settles, if you were not penalized, your stake is refundable:

```solidity
NovelCore.claimStakeRefund(uint256 novelId)
```

> **When you get slashed (50%):** Only if your content length is below the declared minimum, OR you've been in the bottom percentile for M consecutive rounds (pollution).

### 4. Claim Author Rewards

If your chapter made it into Canon during an Epoch settlement:

```solidity
PrizePool.claimReward(uint256 novelId)
```

Check your pending reward first:

```solidity
PrizePool.getPendingReward(uint256 novelId, address author) → uint256
```

---

## 🗳️ Voter — Vote on Story Directions

Voting uses a **Commit-Reveal** scheme to prevent front-running and vote copying.

### 1. Commit Phase — Submit Encrypted Vote

First, compute your vote commitment off-chain:

```javascript
// Off-chain (ethers.js)
const candidateId = 42;  // The chapter ID you want to vote for
const salt = ethers.utils.randomBytes(32);
const commitHash = ethers.utils.solidityKeccak256(
    ["uint256", "bytes32"],
    [candidateId, salt]
);
// IMPORTANT: Save your candidateId and salt — you need them to reveal!
```

Then submit on-chain:

```solidity
VotingEngine.commitVote{value: <optionalStake>}(
    uint256 novelId,
    uint256 votingRoundId,
    bytes32 commitHash
)
```

**Parameters:**
- `votingRoundId` — See [Voting Round ID Computation](#appendix-voting-round-id-computation)
- `commitHash` — `keccak256(abi.encodePacked(candidateId, salt))`
- `msg.value` — For `StakeToVote` strategy, more ETH = more voting weight

### 2. Reveal Phase — Show Your Vote

After the commit phase closes:

```solidity
VotingEngine.revealVote(
    uint256 novelId,
    uint256 votingRoundId,
    uint256 candidateId,    // The chapter you voted for
    bytes32 salt            // The salt you used in commit
)
```

> ⚠️ **If you don't reveal in time, your vote is lost.** Under `StakeToVote`, your staked ETH is also forfeited.

### 3. Claim Schelling Point Reward

After the round is tallied, if you voted for the **winning** candidate:

```solidity
VotingEngine.claimVotingReward(uint256 novelId, uint256 votingRoundId)
```

This returns your staked ETH (for StakeToVote strategy).

### Checking Candidates

See what you can vote for:

```solidity
VotingEngine.getCandidates(uint256 novelId, uint256 votingRoundId) → uint256[] candidateIds
```

---

## 📖 Reader — Tip & Support Novels

### Tip a Novel

Send ETH to expand a novel's prize pool:

```solidity
PrizePool.tipNovel{value: <amount>}(uint256 novelId)
```

**Requirements:**
- Minimum tip: `0.001 ETH`

**Example (cast):**
```bash
cast send $PRIZE_POOL "tipNovel(uint256)" 1 --value 0.5ether --private-key $KEY
```

### Check Pool Status

```solidity
PrizePool.getPoolBalance(uint256 novelId) → uint256       // Current distributable balance
PrizePool.getTotalTipped(uint256 novelId) → uint256        // Cumulative tips received
```

---

## ⚙️ Keeper — Trigger State Transitions

State transitions are permissionless — anyone can call them once conditions are met. This role is ideal for bots/keepers.

### Round Transitions

```solidity
// 1. Close submissions → start voting
//    Requires: roundMinDuration elapsed AND roundMinSubmissions met
NovelCore.closeSubmissions(uint256 novelId)

// 2. Close commit phase → start reveal phase
//    Requires: commitDuration elapsed
NovelCore.closeCommit(uint256 novelId)

// 3. Settle the round → tally votes, select world lines
//    Requires: revealDuration elapsed
NovelCore.settleRound(uint256 novelId)
```

### Epoch Transitions

```solidity
// 4. Close epoch commit → start epoch reveal
//    Requires: commitDuration elapsed
NovelCore.closeEpochCommit(uint256 novelId)

// 5. Settle the epoch → establish canon, mint NFTs, distribute rewards
//    Requires: revealDuration elapsed
NovelCore.settleEpoch(uint256 novelId)
```

### State Machine Flow

```
   ROUND                                    EPOCH
   ─────                                    ─────
   Submitting ──closeSubmissions──▸ Committing
   Committing ──closeCommit──────▸ Revealing
   Revealing  ──settleRound──────▸ { Next Round OR Epoch Committing }
                                        │
                                   Epoch Committing ──closeEpochCommit──▸ Epoch Revealing
                                   Epoch Revealing  ──settleEpoch──────▸ Next Epoch (Round 1)
```

---

## 🔍 Explorer — Query On-Chain State

All query functions are `view` (free, no gas required).

### Novel Queries

```solidity
NovelCore.getNovelCount() → uint256                               // Total novels created
NovelCore.getNovel(uint256 novelId) → Novel                       // Full novel state
NovelCore.getActiveWorldLines(uint256 novelId) → uint256[]        // Current world line chapter IDs
NovelCore.getRoundSubmissions(uint256 novelId, uint32 round) → uint256[]  // Submissions in a round
```

### Chapter Queries

```solidity
NovelCore.getChapterCount() → uint256                             // Total chapters (global)
NovelCore.getChapter(uint256 chapterId) → Chapter                 // Chapter details
```

**Chapter struct fields:**
| Field | Description |
|-------|-------------|
| `id` | Chapter ID |
| `novelId` | Which novel it belongs to |
| `parentId` | Parent chapter (0 = genesis root) |
| `author` | Author address |
| `contentHash` | IPFS/Arweave CID |
| `declaredLength` | Declared byte length |
| `round` / `epoch` | When it was submitted |
| `isWorldLine` | Selected as a world line in a round |
| `isCanon` | Selected as canon in an epoch |

### Voting Queries

```solidity
VotingEngine.getCandidates(novelId, votingRoundId) → uint256[]        // Candidate IDs
VotingEngine.getVoteCount(novelId, votingRoundId, candidateId) → uint256  // Votes for a candidate
VotingEngine.getVoteCommit(novelId, votingRoundId, voter) → VoteCommit    // A voter's commit state
```

### Prize Pool Queries

```solidity
PrizePool.getPoolBalance(uint256 novelId) → uint256               // Distributable balance
PrizePool.getPendingReward(uint256 novelId, address) → uint256    // Unclaimed author reward
PrizePool.getTotalTipped(uint256 novelId) → uint256               // Cumulative tips
```

### NFT Queries

```solidity
ChapterNFT.isChapterMinted(uint256 novelId, uint256 chapterId) → bool
ChapterNFT.getChapterInfo(uint256 tokenId) → ChapterNFTMetadata
```

---

## Appendix: NovelConfig Parameters

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `minChapterLength` | `uint64` | Minimum content bytes | `100` |
| `maxChapterLength` | `uint64` | Maximum content bytes | `10000` |
| `roundMinDuration` | `uint64` | Min round duration (seconds) | `86400` (1 day) |
| `roundMinSubmissions` | `uint32` | Min submissions to close round | `3` |
| `worldLineCount` | `uint32` | N: parallel world lines per round | `2` |
| `roundsPerEpoch` | `uint32` | K: rounds before epoch settlement | `3` |
| `prizeReleaseRate` | `uint16` | Epoch release rate (basis points) | `3000` (30%) |
| `commitDuration` | `uint64` | Commit phase duration (seconds) | `259200` (3 days) |
| `revealDuration` | `uint64` | Reveal phase duration (seconds) | `172800` (2 days) |
| `stakeAmount` | `uint256` | Required stake per chapter (wei) | `10000000000000000` (0.01 ETH) |
| `votingStrategy` | `enum` | `0` = TokenWeighted, `1` = Quadratic, `2` = StakeToVote | `2` |
| `pollutionRounds` | `uint8` | M: consecutive rounds for pollution penalty | `3` |
| `pollutionThreshold` | `uint8` | Bottom X% counts as pollution | `20` |

**Validation rules:**
- `minChapterLength > 0`
- `maxChapterLength > minChapterLength`
- `roundMinSubmissions >= worldLineCount`
- `prizeReleaseRate <= 10000`
- All duration values `> 0`

---

## Appendix: Voting Round ID Computation

The `votingRoundId` is deterministically derived. Compute it off-chain:

```javascript
// For ROUND voting:
const votingRoundId = ethers.utils.solidityKeccak256(
    ["uint256", "uint32", "uint32", "bool"],
    [novelId, epochNumber, roundNumber, false]  // false = round vote
);

// For EPOCH voting:
const votingRoundId = ethers.utils.solidityKeccak256(
    ["uint256", "uint32", "uint32", "bool"],
    [novelId, epochNumber, roundNumber, true]   // true = epoch vote
);
```

You can also find the current `epochNumber` and `roundNumber` from `NovelCore.getNovel(novelId)`.

---

## Complete Lifecycle Example

```
1.  Creator calls  createNovel{value: 1 ETH}(config, genesisHash) → novelId=1
2.  Author A calls submitChapter{value: 0.01 ETH}(1, genesis, cidA, 500) → chapterId=2
3.  Author B calls submitChapter{value: 0.01 ETH}(1, genesis, cidB, 600) → chapterId=3
4.  Author C calls submitChapter{value: 0.01 ETH}(1, genesis, cidC, 700) → chapterId=4
5.  Keeper calls   closeSubmissions(1)          // → Phase: Committing
6.  Voter X calls  commitVote{value: 0.1 ETH}(1, roundVotingId, hash(2, salt))
7.  Voter Y calls  commitVote{value: 0.05 ETH}(1, roundVotingId, hash(3, salt))
8.  Keeper calls   closeCommit(1)               // → Phase: Revealing
9.  Voter X calls  revealVote(1, roundVotingId, 2, salt)
10. Voter Y calls  revealVote(1, roundVotingId, 3, salt)
11. Keeper calls   settleRound(1)               // → World lines: [2, 3]; Phase: Epoch Committing
12. Voter X calls  commitVote(1, epochVotingId, hash(2, salt))   // Epoch vote
13. Voter Y calls  commitVote(1, epochVotingId, hash(2, salt))
14. Keeper calls   closeEpochCommit(1)          // → Phase: Epoch Revealing
15. Voters reveal epoch votes
16. Keeper calls   settleEpoch(1)               // → Canon=chapter 2, NFT minted, 0.3 ETH distributed
17. Author A calls PrizePool.claimReward(1)     // → Receives 0.3 ETH
18. Author A calls NovelCore.claimStakeRefund(1) // → Stake returned
19. Reader calls   PrizePool.tipNovel{value: 0.5 ETH}(1)
20. → Next Epoch begins, world line = [2], authors submit on chapter 2...
```
