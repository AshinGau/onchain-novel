# TODO — Decentralized Collaborative Novel Protocol

> This document tracks all remaining work, known issues, and future directions.
> Items are organized by priority phase, with each item tagged by category.

---

## Phase 1 — Done (MVP)

- [x] Foundry project initialization + OpenZeppelin v5.6.1 dependencies
- [x] `DataTypes.sol` — shared enums & structs (Stake-to-Vote only, no VotingStrategy enum)
- [x] 5 interface files (INovelCore / IVotingEngine / IPrizePool / IChapterNFT / IReportRegistry)
- [x] `ChapterNFT.sol` — ERC-721 upgradeable NFT (copyright proof)
- [x] `PrizePool.sol` — prize pool, tipping, epoch distribution, pull-based claims
- [x] `VotingEngine.sol` — Commit-Reveal Stake-to-Vote voting engine
  - [x] Phase checks: commit/reveal blocked after tally
  - [x] All revealed voters (majority & minority) can reclaim stakes
- [x] `NovelCore.sol` — core state machine, chapter tree, staking, pollution tracking
  - [x] `_collectCanonAuthors()` epoch-filtered to prevent cross-epoch author collection
  - [x] `_mintCanonNFTs()` epoch-filtered to prevent cross-epoch NFT minting
  - [x] Pollution tracking skips when < 10 submissions (avoid small-sample false positives)
  - [x] Admin setter events for governance transparency
- [x] Storage gaps (`__gap`) in all 4 upgradeable contracts for upgrade safety
- [x] `Integration.t.sol` — 14 integration tests (all passing)
- [x] `Deploy.s.sol` — UUPS proxy deployment script
- [x] `README.md` (EN), `README_cn.md` (CN), `usage.md`, `design_cn.md`

---

## Phase 2 — Agent Tooling & Voting Completion

### 2.1 `[agent]` MCP Server
- [ ] Create MCP Server that wraps all contract interactions as tools
- [ ] Tools: read novel state, read chapter content (via CID), submit chapter, commit/reveal vote, claim rewards
- [ ] Support wallet management (private key or keystore)
- [ ] Include helper to compute `votingRoundId` from (novelId, epoch, round, isEpoch)
- [ ] Include CID upload to IPFS/Arweave as a tool
- [ ] Package for easy installation by Agent operators

### 2.2 `[agent]` Agent Skill
- [ ] End-to-end automation: read current world lines → fetch content from CID → generate continuation → upload to IPFS → submit on-chain
- [ ] Voting skill: read all candidates → evaluate story quality → commit-reveal vote
- [ ] Keeper skill: monitor phase timers → call state transition functions when conditions met
- [ ] Support configurable Agent strategies (creative writing style, voting criteria)

### 2.3 `[agent]` Off-chain Content Bridge
- [ ] Service to fetch and concatenate full story text from CID chain
- [ ] Given a world line chapter ID, trace parentId chain, fetch all CIDs, return assembled text
- [ ] API endpoint for Agents to get full context before writing continuations
- [ ] Cache layer to avoid redundant IPFS/Arweave fetches

### 2.4 `[voting]` Unrevealed Vote Stake Forfeiture
- [ ] Committed-but-not-revealed voters' stakes should go to prize pool
- [ ] Add `sweepUnrevealedStakes(novelId, votingRoundId)` callable by anyone post-tally
- [ ] Implementation: iterate `_voters[roundKey]`, check `!commit.revealed`, transfer to prize pool
- [ ] VotingEngine needs PrizePool address (add to initialize or via setter)
- [ ] Unit tests: partial reveal, full no-reveal, sweep after claim

### 2.5 `[core]` Admin Early Epoch Trigger
- [ ] Add `triggerEarlyEpoch(novelId)` callable by owner only
- [ ] Skips remaining rounds, transitions to Epoch Committing phase
- [ ] Requires novel to be in `EpochPhase.Rounds` and `RoundPhase.Submitting`
- [ ] Return stakes for any in-progress round submissions
- [ ] Unit tests: early trigger, non-owner rejected, mid-round handling

---

## Phase 3 — Economic Mechanism Hardening

### 3.1 `[staking]` Pollution Slashing Full Pipeline Test
- [ ] Write dedicated fuzz/unit tests for `_updatePollutionRecords()` + `_returnRoundStakes()`
- [ ] Edge cases to cover:
  - [ ] Author submits in round R but not R+1 — consecutive strikes should reset
  - [ ] Author is in bottom 20% for exactly M-1 rounds, then not — no slash
  - [ ] Author submits multiple chapters in same round — handle duplicate strikes
  - [ ] Same author in multiple novels — independent pollution tracking
  - [ ] Fewer than 10 submissions — pollution tracking skipped entirely
- [ ] Verify slashed funds actually arrive in `PrizePool.getPoolBalance()`
- [ ] Verify slashed author's `_stakeBalances` is reduced correctly

### 3.2 `[prize]` Multi-Epoch Reward Accumulation Test
- [ ] Run a novel through 3+ epochs and verify:
  - [ ] Pool balance decreases correctly each epoch (compound release: `balance × 0.7^n`)
  - [ ] Each epoch's canon authors get the right share
  - [ ] Tipping mid-epoch correctly increases next epoch's release amount
  - [ ] `_collectCanonAuthors` only collects current-epoch authors
  - [ ] `_mintCanonNFTs` only mints current-epoch chapters
- [ ] Verify no dust accumulation or rounding errors over many epochs

### 3.3 `[prize]` Protocol Treasury (Optional Cut)
- [ ] Add a configurable `protocolFeeRate` (e.g., 500 = 5% of epoch release) as global protocol parameter
- [ ] Add `protocolTreasury` address (settable by owner)
- [ ] Route protocol fee to treasury address on each `distributeEpochRewards()`
- [ ] Default: `protocolFeeRate = 0` (no fee)
- [ ] Unit tests: fee deducted correctly, treasury receives funds, zero-fee passthrough

### 3.4 `[core]` Epoch Chapter Path Correctness
- [ ] `_collectCanonAuthors()` traces `parentId` chain with max depth 32
- [ ] Write a multi-round-epoch integration test (e.g., K=3):
  - [ ] Round 1: submit chapters → vote → world lines selected
  - [ ] Round 2: submit on selected world lines → vote → world lines selected
  - [ ] Round 3: submit → vote → trigger epoch voting
  - [ ] Epoch settlement: verify canon chain has Round 1 + Round 2 + Round 3 chapters
  - [ ] Verify `_collectCanonAuthors` returns all 3 authors
- [ ] Edge case: same author wins all 3 rounds → appears 3 times in authors array (correct: 3× reward)

### 3.5 `[voting]` Voter Stake Lifecycle Integration Test
- [ ] End-to-end test covering the full voter stake lifecycle:
  - [ ] commit (stake deposited) → reveal → tally → claim (stake returned)
  - [ ] commit (stake deposited) → NO reveal → tally → sweep unrevealed (stake forfeited to pool)
- [ ] Verify VotingEngine ETH balance is zero after all claims + sweeps
- [ ] Verify no ETH is stuck in any contract

---

## Phase 4 — Auxiliary Features & Production Readiness

### 4.1 `[report]` ReportRegistry Implementation
- [ ] Implement a concrete `ReportRegistry.sol` contract (upgradeable, UUPS)
- [ ] Scope: plagiarism and abuse reports (NOT content length — voting handles quality filtering)
- [ ] Report submission: anyone can report a chapter with evidence hash
  - [ ] Require a bond (e.g., 0.01 ETH) — returned if upheld, forfeited if rejected
- [ ] Arbitration: initially owner-resolved; future → DAO/jury-based
- [ ] On upheld report: callback to `NovelCore` to slash the offending author's stake
- [ ] Events: `ContentReported`, `ReportResolved`, `ReportBondReturned`, `ReportBondForfeited`

### 4.2 `[nft]` EIP-2981 Royalty Standard
- [ ] Implement `ERC2981` in `ChapterNFT` with configurable royalty recipient/rate
- [ ] Default royalty recipient: the chapter author (per-token override)
- [ ] Default royalty rate: 5% (owner-configurable)

### 4.3 `[nft]` Token URI / Metadata
- [ ] `ChapterNFT` currently has no `tokenURI()` override
- [ ] **Option A — On-chain JSON**: Generate Base64-encoded JSON metadata directly in the contract
- [ ] **Option B — Base URI pattern**: `setBaseURI(string)` + `tokenURI = baseURI + tokenId`
- [ ] Recommendation: start with Option B for gas efficiency

### 4.4 `[deploy]` UUPS Upgrade Flow Testing
- [ ] Write test: deploy V1 → upgrade to V2 → verify state preserved
- [ ] Test: non-owner cannot upgrade (`_authorizeUpgrade` reverts)
- [ ] Test: storage layout compatibility between V1 and V2
- [ ] Test all 4 contracts independently

### 4.5 `[deploy]` Multi-Sig + Timelock Setup
- [ ] Write deployment script variant that:
  - [ ] Deploys a `TimelockController` (OpenZeppelin)
  - [ ] Transfers ownership of all 4 contracts to the timelock
  - [ ] Configures Gnosis Safe as the timelock proposer
- [ ] Document the ownership transfer procedure

### 4.6 `[deploy]` L2 Deployment & Verification
- [ ] Test deployment on Base Sepolia / Arbitrum Sepolia
- [ ] `forge verify-contract` for all 4 implementation contracts
- [ ] Gas profiling: `createNovel`, `submitChapter`, `commitVote`, `revealVote`, `settleRound`, `settleEpoch`
- [ ] Document L2-specific considerations (block time, sequencer downtime)

### 4.7 `[core]` Novel Deactivation / Completion
- [ ] Add `completeNovel(novelId)` — creator or owner can finalize a story
- [ ] Completed novels: no new submissions, but tips and claims still work
- [ ] Optional: auto-complete after N consecutive epochs with 0 submissions

---

## Known Issues & Technical Debt

### `[gas]` Gas Optimization
- [ ] `_isActiveWorldLine()` and `_isValidCandidate()` use linear search — consider mapping for O(1) lookup
- [ ] `_returnRoundStakes()` iterates all submissions — O(n) per round
- [ ] `_collectCanonAuthors()` and `_mintCanonNFTs()` trace parentId chain — O(depth), bounded by max depth 32
- [ ] VotingEngine `tallyVotes()` uses insertion sort — fine for small N (N ≤ worldLineCount)

### `[security]` Audit Preparation
- [ ] Add NatSpec documentation to all public/external functions
- [ ] Fuzz testing for economic invariants (pool balance >= sum of pending rewards)
- [ ] Formal verification candidates: stake accounting, phase transition validity
- [ ] Consider `ReentrancyGuardUpgradeable` instead of `ReentrancyGuard` for full proxy compatibility
- [ ] External audit before any mainnet deployment

### `[test]` Test Coverage Expansion
- [ ] Unit tests for each contract in isolation (not just integration)
- [ ] Fuzz tests for `_updatePollutionRecords()` with random rankings
- [ ] Edge case: novel with 0 prize pool through full epoch (no division by zero)
- [ ] Edge case: single submission in a round (auto-win?)
- [ ] Edge case: all voters vote for same candidate
- [ ] Edge case: no voters reveal (all votes lost — tally with 0 votes)
- [ ] Reentrancy attack tests on `claimStakeRefund`, `claimReward`, `claimVotingReward`
- [ ] Concurrent novels: ensure global chapterId counter doesn't cause cross-novel issues
