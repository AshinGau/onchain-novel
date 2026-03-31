# TODO — Decentralized Novel Protocol

> This document tracks all remaining work, known issues, and future directions.
> Items are organized by priority phase, with each item tagged by category.

---

## Phase 1 — ✅ Completed (MVP)

- [x] Foundry project initialization + OpenZeppelin dependencies
- [x] `DataTypes.sol` — shared enums & structs
- [x] 5 interface files (INovelCore / IVotingEngine / IPrizePool / IChapterNFT / IReportRegistry)
- [x] `ChapterNFT.sol` — ERC-721 upgradeable NFT (copyright proof)
- [x] `PrizePool.sol` — prize pool, tipping, epoch distribution, pull-based claims
- [x] `VotingEngine.sol` — Commit-Reveal voting engine (StakeToVote)
- [x] `NovelCore.sol` — core state machine, chapter tree, staking, pollution tracking
- [x] `Integration.t.sol` — 10 integration tests, all passing
- [x] `Deploy.s.sol` — UUPS proxy deployment script
- [x] `README.md` (EN), `README_cn.md` (CN), `usage.md`, `design_cn.md`

---

## Phase 2 — Voting System Enhancement

### 2.1 `[voting]` TokenWeighted Voting Strategy
- [ ] Integrate an ERC-20 governance token for vote weighting (1 token = 1 vote)
- [ ] Add `governanceToken` address to `NovelConfig` or as a global protocol parameter
- [ ] Implement `IERC20.balanceOf()` check in `VotingEngine.revealVote()` for `TokenWeighted` strategy
- [ ] Decide: use existing ERC-20, or deploy a protocol-native governance token?

### 2.2 `[voting]` Quadratic Voting Strategy
- [ ] Implement quadratic cost formula: `cost = votes²`
- [ ] Voter specifies how many "votes" to cast; contract charges `votes²` tokens/ETH
- [ ] Ensure fair accounting when different voters have different quadratic costs
- [ ] Add unit tests for quadratic edge cases (single vote, max votes, rounding)

### 2.3 `[voting]` Unrevealed Vote Stake Forfeiture
- [ ] Currently unrevealed votes have no penalty — staked ETH is just stuck
- [ ] Implement forfeiture: after tally, any committed-but-not-revealed voter's stake goes to prize pool
- [ ] Add a `sweepUnrevealedStakes(novelId, votingRoundId)` function callable by anyone post-tally
- [ ] Design doc reference: §7.1 "过期投票质押没收"

### 2.4 `[voting]` Schelling Point Reward from Prize Pool
- [ ] Current `claimVotingReward()` only returns the voter's own stake
- [ ] Design doc §3 describes rewarding majority voters from the prize pool
- [ ] Implement: after tally, allocate a small % of prize pool to majority voters
- [ ] Decide reward ratio (e.g., 5% of epoch release, split among majority voters)

### 2.5 `[voting]` Vote Weight Bonus for Tippers
- [ ] Design doc §8 "打赏者权益": tippers who cross a threshold get voting weight bonus (e.g., 1.2x)
- [ ] Track cumulative tip amounts per (novelId, tipper) in `PrizePool`
- [ ] Expose `getTipperWeight(novelId, tipper)` for `VotingEngine` to query
- [ ] Low priority — mark as V2 enhancement

---

## Phase 3 — Economic Mechanism Hardening

### 3.1 `[staking]` Pollution Slashing Full Pipeline Test
- [ ] Write dedicated fuzz/unit tests for `_updatePollutionRecords()` + `_returnRoundStakes()`
- [ ] Edge cases to cover:
  - [ ] Author submits in round R but not R+1 — consecutive strikes should reset
  - [ ] Author is in bottom 20% for exactly M-1 rounds, then not — no slash
  - [ ] Author submits multiple chapters in same round — handle duplicate strikes
  - [ ] Same author in multiple novels — independent pollution tracking
- [ ] Verify slashed funds actually arrive in `PrizePool.getPoolBalance()`

### 3.2 `[staking]` Content Length Challenge via Reporting
- [ ] Design doc §4.2(a): "字数不达标" is verified off-chain via community report
- [ ] When a report is upheld (`IReportRegistry.resolveReport(reportId, true)`), trigger slash
- [ ] Wire `IReportRegistry` resolution to `NovelCore._slashStake()` for the reported chapter's author
- [ ] Requires `IReportRegistry` implementation (see Phase 4)

### 3.3 `[prize]` Multi-Epoch Reward Accumulation Test
- [ ] Run a novel through 3+ epochs and verify:
  - [ ] Pool balance decreases correctly each epoch (30% compound release)
  - [ ] Each epoch's canon authors get the right share
  - [ ] Tipping mid-epoch correctly increases next epoch's release amount
- [ ] Verify no dust accumulation or rounding errors over many epochs

### 3.4 `[prize]` Protocol Treasury (Optional Cut)
- [ ] Design doc §7.3 shows "协议金库(可选)" — optional protocol fee
- [ ] Add a configurable `protocolFeeRate` (e.g., 5% of epoch release)
- [ ] Route protocol fee to a treasury address on each `distributeEpochRewards()`
- [ ] Owner-configurable, default 0%

### 3.5 `[core]` Epoch Chapter Path Correctness
- [ ] `_collectCanonAuthors()` currently traces `parentId` chain with max depth 32
- [ ] For multi-round epochs (K > 1), the chain passes through intermediate world lines
- [ ] Verify: world line from Round 1 → extended by chapter in Round 2 → ... → Canon
- [ ] The trace should correctly handle branching paths and only collect this-epoch authors
- [ ] Write a multi-round-epoch integration test to validate

---

## Phase 4 — Auxiliary Features & Production Readiness

### 4.1 `[report]` IReportRegistry Implementation
- [ ] Implement a concrete `ReportRegistry.sol` contract
- [ ] Report submission: anyone can report a chapter with evidence hash
- [ ] Arbitration: initially owner-resolved; future → DAO/jury-based
- [ ] On upheld report: callback to `NovelCore` to slash the offending author
- [ ] Report types: content length mismatch, plagiarism, abuse
- [ ] Anti-spam: require a small bond to submit a report (returned if upheld)

### 4.2 `[governance]` Community Early Epoch Trigger
- [ ] Design doc §4.4: "社区提前触发 Epoch" via on-chain proposal + vote
- [ ] Implement a lightweight proposal mechanism in `NovelCore`
- [ ] Quorum requirement: e.g., 30% of active voters support early trigger
- [ ] On success, skip remaining rounds and enter Epoch voting

### 4.3 `[nft]` EIP-2981 Royalty Standard
- [ ] Design doc §5: future support for NFT royalties on secondary sales
- [ ] Implement `ERC2981` in `ChapterNFT` with configurable royalty recipient/rate
- [ ] Default royalty recipient: the chapter author
- [ ] Owner can update default royalty rate (e.g., 5%)

### 4.4 `[nft]` Token URI / Metadata
- [ ] `ChapterNFT` currently has no `tokenURI()` override
- [ ] Implement on-chain JSON metadata generation (or base URI pattern)
- [ ] Include: novel title, chapter number, epoch, author, content CID
- [ ] Consider SVG on-chain art for the NFT image

### 4.5 `[deploy]` UUPS Upgrade Flow Testing
- [ ] Write test: deploy V1 → upgrade to V2 → verify state preserved
- [ ] Test: non-owner cannot upgrade
- [ ] Test: storage layout compatibility between V1 and V2
- [ ] Use `forge script` to simulate upgrade on a fork

### 4.6 `[deploy]` Multi-Sig + Timelock Setup
- [ ] Design doc §6.1-6.2: owner should be a multisig with timelock
- [ ] Write deployment script variant that:
  - [ ] Deploys a `TimelockController`
  - [ ] Transfers ownership of all 4 contracts to the timelock
  - [ ] Configures Gnosis Safe as the timelock proposer
- [ ] Document the ownership transfer procedure

### 4.7 `[deploy]` L2 Deployment & Verification
- [ ] Test deployment on Base Sepolia / Arbitrum Sepolia
- [ ] `forge verify-contract` for all 4 implementation contracts
- [ ] Gas profiling: measure cost of key operations on L2
- [ ] Document L2-specific considerations (block time, sequencer downtime)

---

## Phase 5 — Advanced Features (V2)

### 5.1 `[core]` Novel Deactivation / Completion
- [ ] Currently novels are always `active = true` — no way to end a novel
- [ ] Add `completeNovel(novelId)` — creator or DAO vote can finalize a story
- [ ] Completed novels: no new submissions, but tips and claims still work
- [ ] Optional: auto-complete after N epochs with no submissions

### 5.2 `[core]` Round Trigger Flexibility
- [ ] Current: round closes when BOTH `minDuration` AND `minSubmissions` are met
- [ ] Design doc §4.3: "满足任一条件即触发" — currently requires BOTH
- [ ] Consider adding an OR-mode option in config, or keep current AND-mode as safer default
- [ ] Document the design decision

### 5.3 `[voting]` Delegation / Vote Proxy
- [ ] Allow voters to delegate their voting power to another address
- [ ] Useful for passive token holders who trust a curator

### 5.4 `[cross]` Cross-Novel Interoperability
- [ ] Design doc §7 Q5: "跨小说互操作" — characters/lore crossover
- [ ] This is a V2+ feature; define interface only for now
- [ ] Possible approach: shared "universe" registry linking multiple novels

### 5.5 `[ai]` AI Agent Identification
- [ ] Design doc §7 Q6: should AI agents be specially marked?
- [ ] Optional: add an `isAgent` flag to chapter submissions
- [ ] Or: leave identification to the social layer (off-chain)

### 5.6 `[frontend]` Subgraph / Indexer
- [ ] Build a Graph Protocol subgraph for efficient querying
- [ ] Index: novels, chapters, world lines, voting rounds, tips, NFTs
- [ ] Essential for any frontend / dApp to function smoothly

### 5.7 `[frontend]` dApp Frontend
- [ ] Web interface for reading, writing, voting, and tipping
- [ ] IPFS upload integration for chapter content
- [ ] Wallet connection (RainbowKit / wagmi)
- [ ] Real-time state display: current phase, countdown timers, world line tree visualization

---

## Known Issues & Technical Debt

### `[gas]` Gas Optimization
- [ ] `_isActiveWorldLine()` and `_isValidCandidate()` use linear search — consider mapping for O(1)
- [ ] `_returnRoundStakes()` iterates all submissions — O(n) per round
- [ ] `_collectCanonAuthors()` and `_mintCanonNFTs()` trace parentId chain — O(depth)
- [ ] VotingEngine `tallyVotes()` uses insertion sort — fine for small N, document the bound
- [ ] Forge lint suggests inline assembly for `keccak256` — low priority optimization

### `[security]` Audit Preparation
- [ ] Add NatSpec documentation to all public/external functions
- [ ] Add comprehensive revert reason strings to all error paths
- [ ] Fuzz testing for economic invariants (pool balance >= sum of pending rewards)
- [ ] Formal verification candidates: stake accounting, phase transition validity
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
- [ ] Resolve Forge lint warnings (mixedCase for NFT-related names)
- [ ] Remove unused import (`console` in test)
- [ ] Consider events for admin setters (`setVotingEngine`, `setPrizePool`, etc.)
- [ ] Add `receive()` / `fallback()` guards to prevent accidental ETH sends to NovelCore
