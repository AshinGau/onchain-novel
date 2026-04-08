# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Core Principles

1. **从零开始**：项目处于 dev 阶段，所有代码从零开始。禁止任何兼容性、迁移、deprecated 相关的代码或注释。不要保留旧版存储布局、不要写 ALTER TABLE、不要用 __deprecated_ 前缀。直接写干净的新代码。
2. **简洁**：不加不需要的功能、不写不必要的抽象、不留死代码。
3. **模块化**：合约职责清晰分离，backend indexer/API/db 分层，共享逻辑抽到 shared lib。
4. **安全**：CEI 模式、nonReentrant、commit-reveal、经济模型防攻击。

## Project Overview

Decentralized Collaborative Novel Protocol — smart contracts on EVM + web app (Express backend with PostgreSQL indexer). Multiple AI Agents and humans co-author novels on-chain via a "Branch → Consensus → Attribution → Incentive" closed-loop mechanism.

Design docs: `docs/v2-design.md`(总览), `docs/design-contract.md`, `docs/design-backend.md`, `docs/design-cli.md`, `docs/design-skill.md`

## Build & Test Commands

### Smart Contracts (Foundry)
```bash
forge build              # Build contracts
forge test -vvv          # Run all tests
forge fmt --check        # Check formatting
```

### Backend (Express + TypeScript)
```bash
cd web/backend
npm run dev              # Dev with tsx watch on :3001
npm run build            # Compile TypeScript
npm run migrate          # Run DB init (single 001_init.sql, from scratch)
```

### Local Development Stack
```bash
./script/local-node.sh start    # Start Anvil + deploy contracts + backend + frontend
./script/local-node.sh stop     # Stop all services
./script/local-node.sh reset    # Clear all data and restart fresh
./script/local-node.sh status   # Show running services
./script/local-node.sh timewarp 1d  # Fast-forward Anvil time (supports s/m/h/d)
```

## Architecture

### Smart Contracts (`src/`)
Five UUPS-upgradeable contracts behind proxies:
- **NovelCore** — Chapter tree (bidirectional: parentId + descendants[]), DFS candidate generation, round lifecycle (Idle → Nominating → Committing → Revealing → settle → Idle), worldLineAncestors tracking. Writing always available.
- **VotingEngine** — Commit-Reveal voting. 3x accuracy weight for voters who pick world lines. One vote per address per round.
- **PrizePool** — Per-round distribution: creator royalty `D/(D+round)` decay, author rewards, voter rewards. Tips (novel + chapter). Pull-based claims. Keeper rewards.
- **BountyBoard** — Reader bounties for chapter continuations. 20% to prize pool, 80% to qualifying authors or refund.
- **RulesEngine** — World-building rules governance: creator rules (before first round) + proposal-based changes (world-line authors vote).

State flow: `Idle → startRound(DFS) → Nominating → closeNomination → Committing → closeCommit → Revealing → settleRound → Idle`

### Web Backend (`web/backend/src/`)
- **Event Indexer** (`indexer/`) — Polls chain for logs from 5 contracts (NovelCore, VotingEngine, PrizePool, BountyBoard, RulesEngine), decodes events, writes to PostgreSQL. Single DB transaction per batch. Confirmation blocks for reorg safety.
- **Content Decoding** — Onchain: decoded from calldata via `decodeFunctionData`. External/HTTP: fetched from `contentBaseUrl + contentHash` with retry.
- **REST API** (`api/`) — novels, chapters, users, bounties, rules, content endpoints. Read-only (chain writes via CLI/frontend directly).
- **ABIs** (`utils/abi.ts`) — Must match contract event signatures exactly, including `indexed` keywords. Mismatched `indexed` causes silent decode failures.
- **Database** — Single `migrations/001_init.sql`, clean schema from scratch. No incremental migrations.

### Key Data Types
- All novel/chapter IDs are `uint64` in contracts, `BIGINT` in DB
- Chapter tree: `parentId` (up) + `descendants[]` (down, for DFS)
- Fork: root chapter's `parentId != 0 && depth == 1` identifies a fork novel
- NovelConfig: `submissionFee`, `voteStake`, `nominationFee`, `worldLineCount`, durations, rates

## Key Design Rules

- **Writing always on** — `submitChapter` has no phase restriction. Voting and writing are fully decoupled.
- **One vote per address per round** — Contract reverts `AlreadyCommitted()`.
- **DFS candidate generation** — `startRound` does DFS from `worldLineAncestors`, finds top 3*N deepest chains as candidates. Bounded by `maxDfsNodes`.
- **World line ancestors** — Updated at `settleRound` to the N winning chapter IDs. Next round's DFS starts from these.
- **Creator royalty** — `D/(D+round)` where D=CREATOR_DECAY_DIVISOR (contract constant, currently 3).
- **Voter accuracy** — 3x weight for voting on a winning world line, 1x for others who revealed.
- **Content storage** — Three modes (Onchain/External/HTTP) set at novel creation, immutable.
- **Fork fee** — `max(submissionFee, sourcePoolBalance * forkFeeRate / 10000)`, proportional to source novel's value.
