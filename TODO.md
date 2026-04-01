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
- [ ] Update docs: usage.md, README.md, README_cn.md, CLAUDE.md

---

## Phase 2 — Anvil E2E Multi-Role Testing

End-to-end tests on local Anvil chain simulating real multi-role collaboration. Uses Forge Script (`--broadcast`) with independent signing keys per role, and `cast rpc evm_increaseTime` for time advancement.

### 2.1 Infrastructure
- [ ] `script/E2E.s.sol` — deploy contracts + assign role wallets from Anvil pre-funded accounts
- [ ] Roles: Creator × 1, Author × 5, Voter × 3, Keeper × 1
- [ ] Helper library: `_computeVotingRoundId`, `_commitHash`, time-skip wrapper

### 2.2 Scenario: Single Epoch Full Lifecycle
- [ ] Creator creates novel (2 genesis chapters) + injects 10 ETH prize pool
- [ ] 5 Authors submit chapters on different world lines
- [ ] Keeper calls `closeSubmissions`, verify keeper reward credited
- [ ] 3 Voters commit-reveal vote (1 deliberately does not reveal)
- [ ] Keeper drives `closeCommit` → `settleRound`
- [ ] Verify: correct world lines selected, unrevealed stake swept
- [ ] Epoch voting → `settleEpoch`
- [ ] Verify: Canon correct, NFT minted, creator royalty, author reward, voter accuracy reward
- [ ] All roles claim rewards, verify final balances

### 2.3 Scenario: Multi-Epoch Economic Decay
- [ ] Config: K=3 rounds per epoch, run 3 full epochs
- [ ] Verify creator royalty decay: Epoch 1 (~50%) → Epoch 2 (~33%) → Epoch 3 (~25%)
- [ ] Verify pool exponential decay: `balance × (1 - releaseRate)^n`
- [ ] Reader tips mid-run, verify tip correctly added to pool

### 2.4 Scenario: Pollution Detection & Slashing
- [ ] Config: `pollutionRounds=2, pollutionThreshold=20`, ≥10 submissions per round
- [ ] 1 Author ranks in bottom 20% for 2 consecutive rounds
- [ ] On round settlement after 2nd strike: verify 50% stake slashed, slashed amount enters pool
- [ ] Verify: submission count < 10 skips pollution tracking entirely

### 2.5 Scenario: Fork & Early Epoch
- [ ] Fork a rejected branch into a new novel, verify independent lifecycle
- [ ] Owner calls `triggerEarlyEpoch` at Round 2, verify skip to epoch voting
- [ ] Verify in-progress round stakes remain claimable via `claimStakeRefund`

### 2.6 Scenario: Edge Cases
- [ ] Zero prize pool through full epoch (no division-by-zero)
- [ ] All voters reveal (sweep yields 0 unrevealed)
- [ ] Single voter in a round
- [ ] Keeper reward > pool balance (graceful skip, state transition still executes)
- [ ] `voterRewardRate = 0` (all remaining goes to authors)

### 2.7 Fuzz & Invariant Tests
- [ ] Fuzz: `_updatePollutionRecords()` with random ranked arrays
- [ ] Fuzz: `distributeEpochRewards` with varying G, C, voterRewardRate values
- [ ] Invariant: `poolBalance + sum(pendingRewards) + voterRewardsSent ≤ totalDeposited`
- [ ] Invariant: `cumulativeCanonChapters` monotonically increases

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

### 4.1 Contracts
- [ ] `ReportRegistry.sol` — plagiarism/abuse reports with bond mechanism
- [ ] `ChapterNFT` — EIP-2981 royalties + `tokenURI()` implementation
- [ ] Novel deactivation: `completeNovel(novelId)`
- [ ] Protocol treasury: `protocolFeeRate` (optional cut from epoch release)

### 4.2 Upgrade & Deployment
- [ ] UUPS upgrade flow tests (V1 → V2, storage layout, non-owner rejected)
- [ ] Multi-sig + TimelockController deployment script
- [ ] L2 deployment (Base Sepolia / Arbitrum Sepolia) + contract verification
- [ ] Gas profiling for all key operations

### 4.3 Security
- [ ] NatSpec documentation on all public/external functions
- [ ] `ReentrancyGuardUpgradeable` migration (replace non-upgradeable `ReentrancyGuard`)
- [ ] Reentrancy attack tests on all claim/transfer paths
- [ ] External audit

---

## Known Technical Debt

- `_isActiveWorldLine()` / `_isValidCandidate()`: linear search → consider mapping for O(1)
- `_returnRoundStakes()`: O(n) per round iteration
- `tallyVotes()`: insertion sort — fine for small N (≤ worldLineCount)
- Concurrent novels: verify global `chapterId` counter doesn't cause cross-novel issues
- `ReentrancyGuard` (non-upgradeable) used in NovelCore/VotingEngine/PrizePool — should migrate to `ReentrancyGuardUpgradeable`
