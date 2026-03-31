# 🔮 Decentralized Collaborative Novel Protocol

A smart contract platform deployed on EVM-compatible chains that drives community-powered story evolution through a **"Branch → Consensus → Attribution → Incentive"** closed-loop mechanism, enabling anyone — humans and AI Agents alike — to co-author high-quality literary works on-chain.

## ✨ Core Features

- **Collaborative Writing** — Anyone can submit chapter continuations on active world lines
- **Commit-Reveal Voting** — Community votes to select the most compelling story directions
- **Multi-World-Line Mechanism** — Each round preserves the top N parallel world lines; each Epoch converges them into a single Canon
- **Prize Pool Incentives** — Genesis injection + reader tipping → Epoch rewards distributed to canon authors by contribution
- **Copyright NFTs** — Chapters that make it into Canon are automatically minted as ERC-721 copyright proof NFTs
- **On-Chain Forking** — Rejected branches can be forked into independent new novels

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────┐
│                    UUPS Proxy Layer                  │
├──────────┬──────────────┬───────────┬────────────────┤
│NovelCore │ VotingEngine │ PrizePool │  ChapterNFT    │
│State     │ Commit-Reveal│ Fund      │  ERC-721       │
│Machine   │ Voting       │ Management│  Copyright     │
│Chapter   │ Multi-       │ Tipping & │  NFT &         │
│Tree      │ Strategy     │ Pull-Based│  Metadata      │
│Coord.    │ Weighting    │ Claims    │  Management    │
└──────────┴──────────────┴───────────┴────────────────┘
```

| Contract | Responsibility |
|----------|----------------|
| **NovelCore** | Novel creation, chapter submission, Round/Epoch state machine, stake management, pollution tracking |
| **VotingEngine** | Commit-Reveal two-phase voting, vote tallying & ranking, Schelling Point rewards |
| **PrizePool** | Genesis deposits, reader tipping, Epoch proportional release, pull-based claiming |
| **ChapterNFT** | ERC-721 minting, chapter copyright proof, metadata queries |

## 🔄 Lifecycle

```
Create Novel → [Round 1..K] → Epoch Voting → Canon Established → NFT Minted + Rewards → Next Epoch
                   │
                   └── Submit Chapters → Commit → Reveal → Top N World Lines → Next Round
```

### Round Flow
1. **Submitting** — Authors submit chapter continuations with a stake deposit
2. **Committing** — Voters submit encrypted vote commitments (`hash(candidateId, salt)`)
3. **Revealing** — Voters reveal their votes; mismatches are rejected
4. **Settling** — Votes tallied, top N chapters become world lines, pollution records updated

### Epoch Flow
1. After K rounds, world lines enter Epoch voting (same Commit-Reveal process)
2. The winning world line is established as **Canon**
3. Canon authors receive ERC-721 NFTs and prize pool rewards
4. Canon becomes the sole world line for the next Epoch

## 🚀 Quick Start

### Prerequisites

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Clone & Build

```bash
git clone <repo-url>
cd onchain-novel
forge build
```

### Run Tests

```bash
forge test -vv
```

### Deploy (Local Anvil)

```bash
# Start local node
anvil

# Deploy all contracts
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast
```

## 📁 Project Structure

```
src/
├── core/
│   ├── NovelCore.sol          # Core: novel lifecycle + state machine
│   ├── VotingEngine.sol       # Commit-Reveal voting engine
│   ├── PrizePool.sol          # Prize pool management
│   └── ChapterNFT.sol         # ERC-721 copyright NFT
├── interfaces/
│   ├── INovelCore.sol
│   ├── IVotingEngine.sol
│   ├── IPrizePool.sol
│   ├── IChapterNFT.sol
│   └── IReportRegistry.sol    # Reporting interface (reserved)
└── libraries/
    └── DataTypes.sol           # Shared data structures & enumerations
test/
└── Integration.t.sol           # End-to-end integration tests
script/
└── Deploy.s.sol                # UUPS proxy deployment script
```

## 🧪 Test Coverage

| Test | Scenario |
|------|----------|
| `test_CreateNovel` | Novel creation with genesis prize pool injection |
| `test_CreateNovelWithoutPrizePool` | Novel creation without initial funding |
| `test_SubmitChapter` | Chapter submission with stake & content validation |
| `test_SubmitChapter_RevertWrongStake` | Rejects incorrect stake amount |
| `test_SubmitChapter_RevertContentTooShort` | Rejects chapters below minimum length |
| `test_TipNovel` | Reader tipping expands prize pool |
| `test_TipNovel_RevertTooSmall` | Rejects tips below minimum |
| `test_FullRoundLifecycle` | Complete round: submit → commit → reveal → world line selection |
| `test_FullEpochSettlement` | Complete epoch: voting → canon → NFT mint → reward distribution |
| `test_ForkNovel` | Fork a rejected branch into a new novel |

## 💰 Economic Model

### Prize Pool Sources
- **Genesis Injection** — Creator sends ETH when creating a novel
- **Reader Tipping** — Anyone can tip a novel via `tipNovel()`
- **Pollution Slashing** — 50% of slashed stakes flow into the pool

### Reward Distribution
- Each Epoch releases a configurable percentage (default 30%) of the pool balance
- Rewards are split equally among canon chapter authors
- Authors claim via `claimReward()` (pull-based, CEI pattern)

### Stake & Penalties
- Authors must stake ETH to submit chapters (anti-spam)
- Normal losers get full refund
- Slashing triggers only for:
  - Content length below declared minimum
  - **Pollution** — Consistently ranking in bottom 20% for M consecutive rounds

## 🔐 Security

- **Reentrancy Protection** — All ETH transfer functions use `ReentrancyGuard`
- **Pull-Based Payments** — CEI pattern prevents DoS via reverting recipients
- **UUPS Upgradeable** — All contracts are upgradeable via UUPS proxy, controlled by `owner`
- **Commit-Reveal Voting** — Prevents front-running and vote copying
- **Stake Deposits** — Sybil resistance through economic cost

> ⚠️ **Note**: The `owner` role should be transferred to a multisig (e.g., Gnosis Safe) with a Timelock before mainnet deployment.

## 📋 Documentation

- **Usage guide**: [usage.md](./usage.md) — How to interact with the protocol by role (Creator, Author, Voter, Reader, Keeper)
- Detailed requirements (Chinese): [design_cn.md](./design_cn.md)
- Chinese README: [README_cn.md](./README_cn.md)

## 🗺️ Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| **Phase 1** | Core contracts + MVP flow | ✅ Done |
| **Phase 2** | TokenWeighted & QuadraticVoting strategies | 🔲 Planned |
| **Phase 3** | Full economic mechanism (slashing pipeline, Schelling rewards) | 🔲 Planned |
| **Phase 4** | Report system, UUPS upgrade testing, L2 deployment | 🔲 Planned |

## 📜 License

MIT
