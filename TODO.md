# TODO — Decentralized Collaborative Novel Protocol

---

## Phase 1 — Core Contracts

### 1.1 Done (MVP)

- [x] Foundry project + OpenZeppelin v5.6.1 dependencies
- [x] `DataTypes.sol` — shared enums & structs
- [x] 5 interface files (INovelCore / IVotingEngine / IPrizePool / IChapterNFT / IReportRegistry)
- [x] `ChapterNFT.sol` — ERC-721 upgradeable NFT
- [x] `PrizePool.sol` — prize pool, tipping, epoch distribution, pull-based claims
- [x] `VotingEngine.sol` — Commit-Reveal Stake-to-Vote, phase checks, all revealed voters reclaim stakes
- [x] `NovelCore.sol` — state machine, chapter tree, staking, pollution tracking (epoch-filtered, ≥10 submissions guard)
- [x] Storage gaps (`__gap`) in all 4 contracts
- [x] `Integration.t.sol` — 14 integration tests passing
- [x] `Deploy.s.sol` — UUPS proxy deployment script
- [x] Documentation: README.md, README_cn.md, usage.md, design_cn.md

### 1.2 To Do: Multi-Chapter Genesis

- [ ] `createNovel` accepts `bytes32[] calldata genesisContentHashes` (array of CIDs, not single hash)
- [ ] Each genesis chapter creates a `Chapter` with `round=0, epoch=0, isWorldLine=true`
- [ ] All genesis chapters become initial active world lines
- [ ] Each genesis chapter validated against `minChapterLength` via `declaredLength`
- [ ] Store `genesisChapterCount` in `Novel` struct for creator royalty calculation
- [ ] Update `forkNovel` to handle new genesis format
- [ ] Update `Integration.t.sol` and `Deploy.s.sol`

### 1.3 To Do: Creator Royalty

- [ ] Add `genesisChapterCount` and `cumulativeCanonChapters` to `Novel` struct
- [ ] In `settleEpoch`: calculate `creatorRoyalty = epochRelease × G / (G + C)` before author/voter split
- [ ] Credit creator's reward to `_pendingRewards` in PrizePool (pull model)
- [ ] Increment `cumulativeCanonChapters` after each epoch settlement
- [ ] `PrizePool.distributeEpochRewards` signature update: accept creator address + royalty amount
- [ ] Tests: creator royalty in epoch 1/5/10 matches expected decay

### 1.4 To Do: Voter Incentive — Unrevealed Stake Redistribution

- [ ] `sweepUnrevealedStakes(novelId, votingRoundId)` callable by anyone post-tally
- [ ] Iterate `_voters[roundKey]`, sum unrevealed stakes → distribute to revealed voters by stake proportion
- [ ] Record `totalRevealedStake` and `unrevealedPool` at sweep time
- [ ] Merge into `claimVotingReward()`: voter claims stake refund + unrevealed share in one call
- [ ] Tests: partial reveal, full no-reveal, sweep after claim, all-reveal (zero unrevealed pool)

### 1.5 To Do: Voter Incentive — Accuracy Rewards

- [ ] Add `voterRewardRate` (uint16, basis points) to `NovelConfig`, validate ≤ 2000
- [ ] At tally: record `totalAccurateStake` and `totalInaccurateStake` in `VotingRoundData`
  - Round voting: accurate = voted for a world line winner
  - Epoch voting: accurate = voted for Canon
- [ ] At epoch settlement: calculate `voterRewardPool = remaining × voterRewardRate / 10000`
- [ ] Split `voterRewardPool` equally across K+1 voting rounds, write `perRoundReward` per round
- [ ] `claimVotingReward()`: compute reward = `perRoundReward × myWeight / totalWeight` (accurate: 3x, other: 1x)
- [ ] Voter rewards credited to VotingEngine (pull model), not PrizePool
- [ ] Tests: accurate voter gets 3x share, inaccurate still gets reward, single voter edge case

### 1.6 To Do: Keeper Rewards

- [ ] Add `keeperRewardAmount` as a global protocol parameter (owner-settable)
- [ ] Each state transition function (`closeSubmissions`, `closeCommit`, `settleRound`, `closeEpochCommit`, `settleEpoch`): reward `msg.sender` from prize pool
- [ ] If pool balance < keeperRewardAmount, skip reward (state transition still executes)
- [ ] Deduct from pool balance directly (independent of epoch release)
- [ ] Tests: keeper receives reward, insufficient pool skips gracefully

### 1.7 To Do: Admin Early Epoch Trigger

- [ ] `triggerEarlyEpoch(novelId)` callable by owner
- [ ] Requires `EpochPhase.Rounds` + `RoundPhase.Submitting`
- [ ] Skip remaining rounds → enter Epoch Committing
- [ ] Return stakes for any in-progress round submissions
- [ ] Tests: early trigger, non-owner rejected

### 1.8 To Do: Update Docs & Tests

- [ ] Update `usage.md` — new NovelConfig fields, new claim flows, keeper rewards
- [ ] Update `README.md` / `README_cn.md` — reflect completed Phase 1 features
- [ ] Update `CLAUDE.md` — architecture changes

---

## Phase 2 — Agent Tooling & Testing

### 2.1 MCP Server
- [ ] Wraps all contract interactions as MCP tools (read state, submit chapter, vote, claim)
- [ ] Wallet management, `votingRoundId` computation helper, CID upload to IPFS/Arweave

### 2.2 Agent Skill
- [ ] Writing skill: read world lines → generate continuation → upload IPFS → submit
- [ ] Voting skill: read candidates → evaluate → commit-reveal
- [ ] Keeper skill: monitor timers → call state transitions

### 2.3 Off-chain Content Bridge
- [ ] Trace parentId chain → fetch CIDs → assemble full story text
- [ ] API endpoint + cache layer for Agent consumption

### 2.4 Economic Testing
- [ ] Multi-epoch test (3+ epochs): pool decay, creator royalty decay, accuracy reward distribution
- [ ] Pollution slashing pipeline: consecutive strikes, reset logic, edge cases
- [ ] Voter lifecycle: commit → reveal → tally → claim (stake + unrevealed share + accuracy reward)
- [ ] Multi-round epoch (K=3): canon chain correctness across rounds
- [ ] Zero prize pool through full epoch (no division by zero)
- [ ] Fuzz tests: `_updatePollutionRecords()`, economic invariants

---

## Phase 3 — Production Readiness

### 3.1 Contracts
- [ ] `ReportRegistry.sol` — plagiarism/abuse reports with bond mechanism
- [ ] `ChapterNFT` — EIP-2981 royalties + `tokenURI()` implementation
- [ ] Novel deactivation: `completeNovel(novelId)`
- [ ] Protocol treasury: `protocolFeeRate` (optional cut from epoch release)

### 3.2 Upgrade & Deployment
- [ ] UUPS upgrade flow tests (V1 → V2, storage layout, non-owner rejected)
- [ ] Multi-sig + TimelockController deployment script
- [ ] L2 deployment (Base Sepolia / Arbitrum Sepolia) + contract verification
- [ ] Gas profiling for all key operations

### 3.3 Security
- [ ] NatSpec documentation on all public/external functions
- [ ] `ReentrancyGuardUpgradeable` migration
- [ ] Reentrancy attack tests on all claim functions
- [ ] External audit

---

## Known Technical Debt

- `_isActiveWorldLine()` / `_isValidCandidate()`: linear search → consider mapping for O(1)
- `_returnRoundStakes()`: O(n) per round iteration
- `tallyVotes()`: insertion sort, fine for small N (≤ worldLineCount)
- Concurrent novels: verify global chapterId counter doesn't cause cross-novel issues
