# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Decentralized collaborative novel protocol — Solidity smart contracts on EVM-compatible chains. Core thesis: a single AI Agent can't write good stories, but multiple competing/collaborating Agents produce emergent creative output. The protocol drives multi-Agent (and human) story co-authoring through a "Branch → Consensus → Attribution → Incentive" closed-loop mechanism.

AI Agents are the primary users. Upcoming tooling includes MCP Server and Agent Skills for automated participation.

## Build & Test Commands

```bash
forge build              # Compile contracts
forge test -vv           # Run all tests
forge test --mt test_FullRoundLifecycle -vvv  # Run a single test by name
forge fmt                # Format Solidity files
forge fmt --check        # Check formatting (used in CI)
```

**Deploy (local Anvil):**
```bash
anvil  # Start local node in separate terminal
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast
```

## Toolchain

- **Foundry** (forge, anvil) — Solidity 0.8.28, optimizer enabled (200 runs, via-ir)
- **Dependencies** (git submodules in `lib/`): forge-std, openzeppelin-contracts, openzeppelin-contracts-upgradeable
- **CI**: GitHub Actions runs `forge fmt --check`, `forge build --sizes`, `forge test -vvv`

## Architecture

Four UUPS-upgradeable contracts behind ERC1967 proxies, wired together at deployment:

- **NovelCore** (`src/core/NovelCore.sol`) — Central coordinator. Novel creation, chapter submission, Round/Epoch state machine, stake management, pollution tracking. Holds references to the other three modules.
- **VotingEngine** (`src/core/VotingEngine.sol`) — Commit-Reveal Stake-to-Vote voting (staked ETH = voting weight). Handles commit, reveal, tallying, and ranking. Only callable by NovelCore.
- **PrizePool** (`src/core/PrizePool.sol`) — Fund management: genesis deposits, reader tipping, epoch proportional release, pull-based reward claiming. Only callable by NovelCore.
- **ChapterNFT** (`src/core/ChapterNFT.sol`) — ERC-721. Mints copyright-proof NFTs for chapters that make it into Canon (filtered to current epoch). Only callable by NovelCore.

**Key relationships:** NovelCore orchestrates all modules. VotingEngine, PrizePool, and ChapterNFT each hold a reference back to NovelCore and restrict mutations to calls from NovelCore only. Deploy script (`script/Deploy.s.sol`) deploys all four implementations + proxies, then wires them via `setVotingEngine/setPrizePool/setChapterNFT`.

**Shared types:** All data structures and enums live in `src/libraries/DataTypes.sol` — `Novel`, `Chapter`, `NovelConfig`, `VoteCommit`, `RoundPhase`, `EpochPhase`, `PollutionRecord`, etc.

## Domain Concepts

- **Round**: Submit chapters → Commit votes → Reveal votes → Settle (top N become world lines)
- **Epoch**: K rounds, then epoch voting → Canon established → NFT minted + rewards distributed
- **World Line**: Parallel story branches preserved each round (configurable N per novel)
- **Canon**: The single winning world line after epoch voting — authors get NFTs + prize pool share
- **Fork**: Create a new independent novel from a rejected branch
- **Pollution**: Authors consistently ranking in bottom percentile get stakes slashed (only when ≥ 10 submissions in a round)
- **Stake-to-Vote**: Only voting mechanism — staked ETH = voting weight, no governance token

## Formatting

Line length 120, tab width 4, no bracket spacing (configured in `foundry.toml [fmt]`).
