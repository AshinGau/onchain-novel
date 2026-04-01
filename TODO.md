# TODO — Decentralized Novel Protocol

> This document tracks all remaining work, known issues, and future directions.
> Items are organized by priority phase, with each item tagged by category.

---

## Phase 1 — ✅ Completed (MVP)

- [x] Foundry project initialization + OpenZeppelin v5.6.1 dependencies
- [x] `DataTypes.sol` — shared enums & structs
- [x] 5 interface files (INovelCore / IVotingEngine / IPrizePool / IChapterNFT / IReportRegistry)
- [x] `ChapterNFT.sol` — ERC-721 upgradeable NFT (copyright proof)
- [x] `PrizePool.sol` — prize pool, tipping, epoch distribution (with epoch tracking), pull-based claims
- [x] `VotingEngine.sol` — Commit-Reveal voting engine (StakeToVote)
  - [x] Phase checks: commit/reveal blocked after tally
  - [x] All revealed voters (majority & minority) can reclaim stakes
  - [x] Correct event parameter emission in `claimVotingReward`
- [x] `NovelCore.sol` — core state machine, chapter tree, staking, pollution tracking
  - [x] `_collectCanonAuthors()` epoch-filtered to prevent cross-epoch author collection
  - [x] `distributeEpochRewards()` passes actual epoch number for events
  - [x] Admin setter events for governance transparency
- [x] Storage gaps (`__gap`) in all 4 upgradeable contracts for upgrade safety
- [x] `Integration.t.sol` — 14 integration tests (all passing)
  - [x] Novel creation (with/without prize pool)
  - [x] Chapter submission (happy path + wrong stake + too short)
  - [x] Reader tipping (happy path + too small)
  - [x] Full round lifecycle
  - [x] Full epoch settlement with verifications
  - [x] Fork novel
  - [x] Stake refund claim
  - [x] Prize reward claim
  - [x] Voting reward claim (both majority and minority voters)
  - [x] VotingEngine phase guard (commit after tally reverts)
- [x] `Deploy.s.sol` — UUPS proxy deployment script
- [x] `README.md` (EN), `README_cn.md` (CN), `usage.md`, `design_cn.md`

---

## Phase 2 — Voting System Enhancement

### 2.1 `[voting]` TokenWeighted Voting Strategy
- [ ] Integrate an ERC-20 governance token for vote weighting (1 token = 1 vote)
- [ ] Decide scope: `governanceToken` address is **per-novel** (set in `NovelConfig`) or **global** (protocol-wide)
- [ ] Implement `IERC20.balanceOf(voter)` check in `VotingEngine.revealVote()` for `TokenWeighted` strategy
- [ ] Add validation: voter must hold ≥ 1 token to vote
- [ ] Unit tests: zero-balance voter rejected, weight proportional to balance
- [ ] Decision needed: use existing ERC-20, or deploy a protocol-native governance token?

### 2.2 `[voting]` Quadratic Voting Strategy
- [ ] Implement quadratic cost formula: `cost = votes²`
- [ ] Decide payment asset: ETH (via `msg.value`) or ERC-20 token
- [ ] Voter specifies number of "votes" to cast; contract charges `votes²` units
- [ ] Implement refund mechanism for overpaid amounts
- [ ] Ensure fair accounting when different voters have different quadratic costs
- [ ] Add unit tests for edge cases: single vote, max votes, rounding, zero votes, overflow protection

### 2.3 `[voting]` Unrevealed Vote Stake Forfeiture
- [ ] Currently unrevealed votes have no penalty — staked ETH stays in VotingEngine
- [ ] Implement forfeiture: after tally, any committed-but-not-revealed voter's stake goes to prize pool
- [ ] Add a `sweepUnrevealedStakes(novelId, votingRoundId)` function callable by anyone post-tally
- [ ] Implementation: iterate `_voters[roundKey]`, check `!commit.revealed`, transfer to prize pool
- [ ] Add access control: only callable after tally is complete
- [ ] Design doc reference: §7.1 "过期投票质押没收"
- [ ] Unit tests: partial reveal (some reveal, some don't), full no-reveal, sweep after claim

### 2.4 `[voting]` Schelling Point Reward from Prize Pool
- [ ] Current `claimVotingReward()` only returns the voter's own stake (no bonus)
- [ ] Design doc §3: reward voters who voted with the majority from the prize pool
- [ ] Implementation approach:
  - [ ] Add `VotingEngine` → `PrizePool` interaction (VotingEngine needs PrizePool address)
  - [ ] After tally, calculate reward pool: `schellingReward = epochRelease × schellingRate / 10000`
  - [ ] Split reward equally among majority voters
  - [ ] Credit to `_pendingRewards` in PrizePool (pull model, consistent with author rewards)
- [ ] Add `schellingRewardRate` to `NovelConfig` (e.g., 500 = 5% of epoch release)
- [ ] Unit tests: majority gets bonus, minority gets only stake, no voters = no reward

### 2.5 `[voting]` Vote Weight Bonus for Tippers (V2 Enhancement)
- [ ] Design doc §8 "打赏者权益": tippers exceeding a threshold get voting weight bonus (e.g., 1.2x)
- [ ] Track cumulative tip amounts per (novelId, tipper) in `PrizePool`
- [ ] Add `getCumulativeTips(novelId, tipper)` query to `IPrizePool`
- [ ] `VotingEngine.revealVote()` queries tipper weight bonus
- [ ] Configurable threshold and multiplier in `NovelConfig`
- [ ] Low priority — mark as V2 enhancement

---

## Phase 3 — Economic Mechanism Hardening

### 3.1 `[staking]` Pollution Slashing Full Pipeline Test
- [ ] Write dedicated fuzz/unit tests for `_updatePollutionRecords()` + `_returnRoundStakes()`
- [ ] Edge cases to cover:
  - [ ] Author submits in round R but not R+1 — consecutive strikes should reset
  - [ ] Author is in bottom 20% for exactly M-1 rounds, then not — no slash
  - [ ] Author submits multiple chapters in same round — handle duplicate strikes
  - [ ] Same author in multiple novels — independent pollution tracking (already separate by novelId)
  - [ ] Round 1 edge case: `lastRecordedRound == 0` initialization path
- [ ] Verify slashed funds actually arrive in `PrizePool.getPoolBalance()`
- [ ] Verify slashed author's `_stakeBalances` is reduced correctly

### 3.2 `[staking]` Content Length Challenge via Reporting
- [ ] Design doc §4.2(a): "字数不达标" is verified off-chain via community report
- [ ] When a report is upheld (`IReportRegistry.resolveReport(reportId, true)`), trigger slash
- [ ] Wire `IReportRegistry` resolution to `NovelCore._slashStake()` for the reported chapter's author
- [ ] Requires `IReportRegistry` implementation (see Phase 4.1)
- [ ] Add integration test: report → resolve → slash → funds to prize pool

### 3.3 `[prize]` Multi-Epoch Reward Accumulation Test
- [ ] Run a novel through 3+ epochs and verify:
  - [ ] Pool balance decreases correctly each epoch (compound release: `balance × 0.7^n`)
  - [ ] Each epoch's canon authors get the right share
  - [ ] Tipping mid-epoch correctly increases next epoch's release amount
  - [ ] `_collectCanonAuthors` only collects current-epoch authors (not previous epoch's canon)
- [ ] Verify no dust accumulation or rounding errors over many epochs
- [ ] Test with multi-round epoch (K > 1): chapter chain traced correctly through world lines

### 3.4 `[prize]` Protocol Treasury (Optional Cut)
- [ ] Design doc §7.3 shows "协议金库(可选)" — optional protocol fee
- [ ] Add a configurable `protocolFeeRate` (e.g., 500 = 5% of epoch release) as a global protocol parameter
- [ ] Add `protocolTreasury` address (settable by owner)
- [ ] Route protocol fee to treasury address on each `distributeEpochRewards()`
- [ ] Default: `protocolFeeRate = 0` (no fee)
- [ ] Unit tests: fee deducted correctly, treasury receives funds, zero-fee passthrough

### 3.5 `[core]` Epoch Chapter Path Correctness
- [ ] `_collectCanonAuthors()` traces `parentId` chain with max depth 32
- [ ] For multi-round epochs (K > 1), the chain passes through intermediate world lines
- [ ] Write a multi-round-epoch integration test (e.g., K=3):
  - [ ] Round 1: submit chapters → vote → world lines selected
  - [ ] Round 2: submit on selected world lines → vote → world lines selected
  - [ ] Round 3: submit → vote → trigger epoch voting
  - [ ] Epoch settlement: verify canon chain has Round 1 + Round 2 + Round 3 chapters
  - [ ] Verify `_collectCanonAuthors` returns all 3 authors
- [ ] Edge case: same author wins all 3 rounds → appears 3 times in authors array (correct: 3× reward)

### 3.6 `[voting]` Voter Stake Lifecycle Integration Test
- [ ] End-to-end test covering the full voter stake lifecycle:
  - [ ] commit (stake deposited) → reveal → tally → majority claim (stake + reward)
  - [ ] commit (stake deposited) → reveal → tally → minority claim (stake only)
  - [ ] commit (stake deposited) → NO reveal → tally → sweep unrevealed (stake forfeited to pool)
- [ ] Verify VotingEngine ETH balance is zero after all claims + sweeps
- [ ] Verify no ETH is stuck in any contract

---

## Phase 4 — Auxiliary Features & Production Readiness

### 4.1 `[report]` ReportRegistry Implementation
- [ ] Implement a concrete `ReportRegistry.sol` contract (upgradeable, UUPS)
- [ ] Report submission: anyone can report a chapter with evidence hash
  - [ ] Require a bond (e.g., 0.01 ETH) to submit a report — returned if upheld, forfeited if rejected
  - [ ] Bond amount configurable by owner
- [ ] Arbitration: initially owner-resolved; future → DAO/jury-based
- [ ] On upheld report: callback to `NovelCore` to slash the offending author's stake
  - [ ] `NovelCore` needs a new `slashByReport(novelId, chapterId)` function callable only by ReportRegistry
- [ ] Report types: content length mismatch, plagiarism, abuse
- [ ] Anti-spam: bond prevents frivolous reports
- [ ] Events: `ContentReported`, `ReportResolved`, `ReportBondReturned`, `ReportBondForfeited`
- [ ] Add `__gap` storage gap for upgrade safety

### 4.2 `[governance]` Community Early Epoch Trigger
- [ ] Design doc §4.4: "社区提前触发 Epoch" via on-chain proposal + vote
- [ ] Implement a lightweight propose-and-vote mechanism in `NovelCore`:
  - [ ] `proposeEarlyEpoch(novelId)` — creates a proposal, requires proposer to stake
  - [ ] `voteEarlyEpoch(novelId, proposalId, support)` — vote for/against
  - [ ] Define "active voters": addresses that voted in any round of the current epoch
  - [ ] Quorum: 30% of active voters must support the proposal
  - [ ] Time-bound: proposal expires after X days if quorum not reached
- [ ] On success: skip remaining rounds, transition to Epoch Committing phase
- [ ] On failure: no-op, novel continues normally
- [ ] Unit tests: proposal lifecycle, quorum edge cases, double-vote prevention

### 4.3 `[nft]` EIP-2981 Royalty Standard
- [ ] Design doc §5: future support for NFT royalties on secondary sales
- [ ] Implement `ERC2981` in `ChapterNFT` with configurable royalty recipient/rate
- [ ] Default royalty recipient: the chapter author (per-token override)
- [ ] Default royalty rate: 5% (owner-configurable)
- [ ] Import `ERC2981Upgradeable` and add to inheritance chain
- [ ] Unit tests: royaltyInfo returns correct values, owner can update default rate

### 4.4 `[nft]` Token URI / Metadata
- [ ] `ChapterNFT` currently has no `tokenURI()` override
- [ ] **Option A — On-chain JSON**: Generate Base64-encoded JSON metadata directly in the contract
  - [ ] Include: novel title, chapter number, epoch, author, content CID
  - [ ] Consider SVG on-chain art for the NFT image
- [ ] **Option B — Base URI pattern**: `setBaseURI(string)` + `tokenURI = baseURI + tokenId`
  - [ ] Simpler, requires off-chain metadata hosting
- [ ] Recommendation: start with Option B for gas efficiency, iterate to Option A later
- [ ] Unit tests: tokenURI returns valid JSON or correct URL

### 4.5 `[deploy]` UUPS Upgrade Flow Testing
- [ ] Write test: deploy V1 → upgrade to V2 → verify state preserved
- [ ] Test: non-owner cannot upgrade (`_authorizeUpgrade` reverts)
- [ ] Test: storage layout compatibility between V1 and V2
  - [ ] Verify `__gap` slots are consumed correctly when adding new state variables
- [ ] Use `forge script` to simulate upgrade on a fork
- [ ] Test all 4 contracts independently (NovelCore, VotingEngine, PrizePool, ChapterNFT)

### 4.6 `[deploy]` Multi-Sig + Timelock Setup
- [ ] Design doc §6.1-6.2: owner should be a multisig with timelock
- [ ] Write deployment script variant that:
  - [ ] Deploys a `TimelockController` (OpenZeppelin)
  - [ ] Transfers ownership of all 4 contracts to the timelock
  - [ ] Configures Gnosis Safe as the timelock proposer
- [ ] Document the ownership transfer procedure
- [ ] Test: timelock delay works, direct owner calls rejected after transfer

### 4.7 `[deploy]` L2 Deployment & Verification
- [ ] Test deployment on Base Sepolia / Arbitrum Sepolia
- [ ] `forge verify-contract` for all 4 implementation contracts
- [ ] Gas profiling: measure cost of key operations on L2
  - [ ] `createNovel`, `submitChapter`, `commitVote`, `revealVote`, `settleRound`, `settleEpoch`
- [ ] Document L2-specific considerations:
  - [ ] Block time differences (2s vs 12s)
  - [ ] Sequencer downtime: what happens to phase timers?
  - [ ] Gas price volatility impact on stake amounts

### 4.8 `[security]` Storage Layout & Upgrade Safety
- [ ] Verify all 4 contracts have `__gap` (already done in Phase 1)
- [ ] Run `forge inspect <Contract> storage-layout` for all contracts
- [ ] Document expected storage layout for V1
- [ ] Create a V2 mock that adds a new state variable, verify upgrade doesn't corrupt
- [ ] Consider using `@openzeppelin/upgrades-core` for automated layout checks

---

## Phase 5 — Advanced Features (V2)

### 5.1 `[core]` Novel Deactivation / Completion
- [ ] Currently novels are always `active = true` — no way to end a novel
- [ ] Add `completeNovel(novelId)` — creator or DAO vote can finalize a story
- [ ] Edge cases when deactivating:
  - [ ] If in mid-round: refund all current round stakes, cancel pending votes
  - [ ] If in mid-epoch-vote: complete the current vote first, then deactivate
- [ ] Completed novels: no new submissions, but tips and claims still work
- [ ] Optional: auto-complete after N consecutive epochs with 0 submissions
- [ ] Events: `NovelCompleted(novelId, finalizer)`

### 5.2 `[core]` Round Trigger Flexibility
- [ ] Current: round closes when BOTH `minDuration` AND `minSubmissions` are met
- [ ] Design doc §4.3: "满足任一条件即触发" — originally intended as OR-mode
- [ ] Add `roundTriggerMode` to `NovelConfig`: `AND` (current, safer) or `OR` (design doc intent)
- [ ] OR-mode: close submissions when EITHER duration elapsed OR submission count reached
- [ ] Document trade-offs: AND prevents premature closing; OR prevents stalling
- [ ] Default: keep `AND` as safer default, `OR` as opt-in

### 5.3 `[voting]` Delegation / Vote Proxy
- [ ] Allow voters to delegate their voting power to another address
- [ ] `delegate(address delegatee)` — delegatee votes on behalf of delegator
- [ ] Useful for passive token holders who trust a curator
- [ ] Delegation is per-novel or global (design decision needed)
- [ ] Prevent circular delegation

### 5.4 `[cross]` Cross-Novel Interoperability
- [ ] Design doc §7 Q5: "跨小说互操作" — characters/lore crossover
- [ ] This is a V2+ feature; define interface only for now
- [ ] Possible approach: shared "universe" registry linking multiple novels
- [ ] `IUniverseRegistry`: register novel → universe, query novels by universe

### 5.5 `[ai]` AI Agent Identification
- [ ] Design doc §7 Q6: should AI agents be specially marked?
- [ ] Optional: add an `isAgent` flag to chapter submissions
- [ ] Or: leave identification to the social layer (off-chain verification)
- [ ] If on-chain: add `bool isAIGenerated` to `submitChapter()` params and `Chapter` struct

### 5.6 `[frontend]` Subgraph / Indexer
- [ ] Build a Graph Protocol subgraph for efficient querying
- [ ] Index entities: novels, chapters, world lines, voting rounds, tips, NFTs, rewards
- [ ] Define schema: Novel, Chapter, Round, Epoch, Vote, Tip, Reward, NFT
- [ ] Map all events from all 4 contracts
- [ ] Essential for any frontend / dApp to function smoothly

### 5.7 `[frontend]` dApp Frontend
- [ ] Web interface for reading, writing, voting, and tipping
- [ ] IPFS upload integration for chapter content (e.g., Pinata, web3.storage)
- [ ] Wallet connection (RainbowKit / wagmi)
- [ ] Real-time state display: current phase, countdown timers, world line tree visualization
- [ ] Responsive design for mobile reading

### 5.8 `[core]` Batch Operations
- [ ] Batch chapter submissions for gas efficiency
- [ ] Batch voting (commit multiple votes in one tx)
- [ ] Batch claim (claim stakes + rewards across multiple novels)
- [ ] Use multicall pattern or custom batch functions

### 5.9 `[core]` Novel Discovery & Statistics
- [ ] On-chain statistics: total chapters, total tips, active voter count per novel
- [ ] View functions for pagination: `getNovels(offset, limit)`, `getChapters(novelId, offset, limit)`
- [ ] Or rely entirely on subgraph (Phase 5.6) for discovery
- [ ] Events are sufficient for off-chain indexing if subgraph is used

---

## Known Issues & Technical Debt

### `[gas]` Gas Optimization
- [ ] `_isActiveWorldLine()` and `_isValidCandidate()` use linear search — consider mapping for O(1) lookup
- [ ] `_returnRoundStakes()` iterates all submissions — O(n) per round
- [ ] `_collectCanonAuthors()` and `_mintCanonNFTs()` trace parentId chain — O(depth), bounded by max depth 32
- [ ] VotingEngine `tallyVotes()` uses insertion sort — fine for small N, document the bound (N ≤ worldLineCount)
- [ ] Forge lint suggests inline assembly for `keccak256` — low priority optimization

### `[security]` Audit Preparation
- [ ] Add NatSpec documentation to all public/external functions
- [ ] Add comprehensive revert reason strings to all error paths
- [ ] Fuzz testing for economic invariants (pool balance >= sum of pending rewards)
- [ ] Formal verification candidates: stake accounting, phase transition validity
- [ ] Verify OZ v5 `ReentrancyGuard` is proxy-safe (confirmed: uses ERC-7201 namespaced storage slots)
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

### `[code]` Code Quality
- [ ] Resolve Forge lint warnings (mixedCase naming, asm-keccak256 suggestions)
- [ ] Consider events for all admin setters (✅ done for NovelCore; pending for VotingEngine.setNovelCore, PrizePool.setNovelCore, ChapterNFT.setNovelCore)
- [ ] Add `receive()` / `fallback()` guards to prevent accidental ETH sends to NovelCore
  - Note: NovelCore intentionally has no receive/fallback — ETH only enters via payable functions. This is correct behavior.
