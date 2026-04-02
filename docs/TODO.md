# TODO — Decentralized Collaborative Novel Protocol

All phases completed. 62 Solidity tests passing, MCP Server skeleton implemented.

---

## Phase 1 — Core Contracts (Done)

- [x] Four UUPS-upgradeable contracts: NovelCore, VotingEngine, PrizePool, ChapterNFT
- [x] Multi-chapter genesis, Commit-Reveal Stake-to-Vote
- [x] Three-layer epoch distribution: creator royalty (`G/(G+C)`) → author → voter accuracy (3x)
- [x] Unrevealed stake redistribution, keeper rewards, pollution slashing
- [x] Admin early epoch trigger, on-chain forking (fork fee + creator royalty to original), ERC-721 + ERC-2981 NFTs
- [x] `contentBaseUrl` in NovelConfig (immutable), locked stakes, min vote stake > 0
- [x] Security: pollution escape fix, triggerEarlyEpoch ID mismatch fix, genesis count ≤ worldLineCount
- [x] Documentation: usage.md, README.md, README_cn.md, CLAUDE.md

---

## Phase 2 — E2E Multi-Role Testing (Done)

62 tests across 6 test suites, all passing.

- [x] `test/Integration.t.sol` — 21 integration tests
- [x] `test/E2E.t.sol` — 11 multi-role scenarios (single epoch, multi-epoch decay, pollution, fork, early epoch settlement, edge cases)
- [x] `test/Fuzz.t.sol` — 6 fuzz tests (creator royalty, accuracy weights, config, rewards, invariants)
- [x] `test/Upgrade.t.sol` — 9 UUPS upgrade tests (V1→V2, storage preservation, access control)
- [x] `test/Reentrancy.t.sol` — 3 reentrancy attack tests (PrizePool, VotingEngine, NovelCore)
- [x] `test/GasProfile.t.sol` — 12 gas profiling tests for all key operations

---

## Phase 3 — Agent Tooling (Done)

- [x] `mcp/` — TypeScript MCP Server wrapping all contract interactions
- [x] MCP tools: novel, chapter, voting, prize, keeper (read + write)
- [x] Agent skills: writer (read world lines → prompt), voter (commit-reveal), keeper (auto-advance)
- [x] Utils: votingRoundId computation, wallet management, content bridge
- [x] ABIs extracted from contract interfaces (viem human-readable format)

---

## Phase 4 — Production Readiness (Done)

### 4.1 Contracts (Done)
- [x] `ReportRegistry.sol` — bond-based plagiarism/abuse reports with arbitration
- [x] `ChapterNFT` — EIP-2981 royalties (5% default) + `tokenURI()` with on-chain fallback
- [x] Novel deactivation: `completeNovel(novelId)` — owner-only, during Submitting phase
- [x] Protocol treasury: `protocolFeeRate` (max 10%) + `protocolTreasury` address in PrizePool

### 4.2 Upgrade & Deployment (Done)
- [x] `test/Upgrade.t.sol` — V1→V2 upgrade, storage preservation, non-owner rejection, post-upgrade lifecycle
- [x] `script/DeployProduction.s.sol` — TimelockController + multi-sig deployment, ownership transfer
- [x] `test/GasProfile.t.sol` — Gas profiling for all key operations
- [x] Contract sizes verified within 24KB limit

### 4.3 Security (Done)
- [x] `ReentrancyGuard` confirmed safe (OZ v5.5 `@custom:stateless` + ERC-7201)
- [x] `test/Reentrancy.t.sol` — Reentrancy attack tests on all claim/transfer paths
- [ ] External audit (requires third-party engagement)

---

## Remaining (External Dependencies)

- [ ] External security audit
- [ ] L2 deployment (Base Sepolia / Arbitrum Sepolia) + contract verification
- [ ] IPFS/Arweave integration for content upload in MCP Server
- [ ] Production MCP Server deployment with real wallet management
