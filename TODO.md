# TODO — Decentralized Collaborative Novel Protocol

---

## Phase 1 — Core Contracts (Done)

All core economic mechanisms implemented and tested (21 tests passing).

- [x] Four UUPS-upgradeable contracts: NovelCore, VotingEngine, PrizePool, ChapterNFT
- [x] Multi-chapter genesis (`bytes32[]` CIDs, each validated against `minChapterLength`)
- [x] Commit-Reveal Stake-to-Vote voting engine
- [x] Three-layer epoch reward distribution: creator royalty (`G/(G+C)` decay) → author rewards → voter accuracy rewards (3x weight for winners)
- [x] Unrevealed stake redistribution (`sweepUnrevealedStakes` → proportional share to revealed voters)
- [x] Keeper rewards for state transition callers (from prize pool, skip if insufficient)
- [x] Pollution tracking with ≥10 submission guard and 50% stake slashing
- [x] Admin early epoch trigger (`triggerEarlyEpoch`)
- [x] On-chain forking from rejected branches
- [x] ERC-721 copyright NFT minting for canon chapters (epoch-filtered)
- [x] Documentation: usage.md, README.md, README_cn.md, CLAUDE.md

---

## Phase 2 — E2E Multi-Role Testing (Done)

45 tests across 4 test suites, all passing.

### 2.1–2.2 Single Epoch Full Lifecycle (Done)
- [x] `test/E2E.t.sol` — 9 E2E tests with Creator/Author×5/Voter×3/Keeper roles
- [x] Multi-genesis (2 chapters), 5 authors submit on different world lines
- [x] Keeper rewards verified, sweep unrevealed stakes, epoch settlement
- [x] All roles claim rewards and verify balances

### 2.3 Multi-Epoch Economic Decay (Done)
- [x] 3-epoch run verifying creator royalty decay: 100% → 66% → 50%
- [x] Pool exponential decay verified
- [x] Mid-run reader tipping verified

### 2.4 Pollution Detection & Slashing (Done)
- [x] 10 authors, `pollutionRounds=2`, consecutive bottom ranking → slashing

### 2.5 Fork & Early Epoch (Done)
- [x] Fork rejected branch into independent novel
- [x] `triggerEarlyEpoch` skips remaining rounds
- [x] In-progress round stakes claimable after early trigger

### 2.6 Edge Cases (Done)
- [x] Zero prize pool (no division-by-zero)
- [x] All voters reveal (sweep yields 0)
- [x] Single voter
- [x] Keeper reward > pool balance (graceful skip)
- [x] `voterRewardRate = 0` (all remaining to authors)

### 2.7 Fuzz & Invariant Tests (Done)
- [x] `test/Fuzz.t.sol` — 6 fuzz tests (256 runs each)
- [x] Fuzz: creator royalty decay formula properties
- [x] Fuzz: voter accuracy weight calculations
- [x] Fuzz: config validation with random valid parameters
- [x] Fuzz: `voterRewardRate > 2000` always rejected
- [x] Fuzz: `distributeEpochRewards` with varying G, C, voterRewardRate
- [x] Invariant: `poolBalance + pendingRewards = totalDeposited` (voterRewardRate=0)

---

## Phase 3 — Agent Tooling

### 3.1 MCP Server
- [ ] Wrap all contract read/write as MCP tools
- [ ] `votingRoundId` computation helper, wallet management
- [ ] CID upload to IPFS/Arweave

### 3.2 Agent Skills
- [ ] Writer: read world lines → generate continuation → upload IPFS → submit on-chain
- [ ] Voter: read candidates → evaluate quality → commit-reveal vote
- [ ] Keeper: monitor phase timers → call state transitions → earn rewards

### 3.3 Off-chain Content Bridge
- [ ] Trace parentId chain → fetch CIDs → assemble full story text
- [ ] API endpoint + cache layer for Agent consumption

---

## Phase 4 — Production Readiness

### 4.1 Contracts (Done: ReportRegistry)
- [x] `ReportRegistry.sol` — bond-based plagiarism/abuse reports with arbitration
- [ ] `ChapterNFT` — EIP-2981 royalties + `tokenURI()` implementation
- [ ] Novel deactivation: `completeNovel(novelId)`
- [ ] Protocol treasury: `protocolFeeRate` (optional cut from epoch release)

### 4.2 Upgrade Testing (Done)
- [x] `test/Upgrade.t.sol` — 9 tests
- [x] UUPS V1→V2 upgrade for all 4 contracts
- [x] Storage layout preservation verified
- [x] Non-owner upgrade rejection for all 4 contracts
- [x] Full lifecycle works after upgrading all contracts

### 4.3 Security
- [x] `ReentrancyGuard` is safe for proxies (OZ v5.5 `@custom:stateless` + ERC-7201 storage)
- [ ] NatSpec documentation on all public/external functions
- [ ] Reentrancy attack tests on all claim/transfer paths
- [ ] External audit

### 4.4 Deployment
- [ ] Multi-sig + TimelockController deployment script
- [ ] L2 deployment (Base Sepolia / Arbitrum Sepolia) + contract verification
- [ ] Gas profiling for all key operations

---

## Known Technical Debt

- `_isActiveWorldLine()` / `_isValidCandidate()`: linear search → consider mapping for O(1)
- `_returnRoundStakes()`: O(n) per round iteration
- `tallyVotes()`: insertion sort — fine for small N (≤ worldLineCount)
- Concurrent novels: verify global `chapterId` counter doesn't cause cross-novel issues
