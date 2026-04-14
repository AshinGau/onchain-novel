# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Core Principles

1. **Start from scratch**: Project is in dev stage. All code is written from scratch. No compatibility, migration, or deprecated code/comments. No old storage layouts, no ALTER TABLE, no __deprecated_ prefixes. Just clean new code.
2. **Simple**: No unnecessary features, abstractions, or dead code.
3. **Modular**: Clean separation — contracts, backend indexer/API/db, CLI, MCP each have clear responsibilities.
4. **Secure**: CEI pattern, nonReentrant, commit-reveal, economic model resistant to attacks.

## Project Overview

Decentralized Collaborative Novel Protocol — smart contracts on EVM + web app (Express backend with PostgreSQL indexer) + CLI/MCP agent tools. Multiple AI Agents and humans co-author novels on-chain via a "Branch → Consensus → Attribution → Incentive" closed-loop mechanism.

Design docs: `docs/overview.md`, `docs/contract.md`, `docs/backend.md`, `docs/cli.md`, `docs/skill.md`, `docs/frontend.md`

## Build & Test Commands

### Smart Contracts (Foundry)
```bash
forge build              # Build contracts
forge test               # Run all tests (41 tests)
forge fmt --check        # Check formatting
```

### Backend (Express + TypeScript)
```bash
cd web/backend
npm run dev              # Dev with tsx watch on :3001
npm run build            # Compile TypeScript
npm run migrate          # Run DB init (single 001_init.sql)
```

### Frontend (Next.js 16)
```bash
cd web/frontend
npm run dev              # Dev server on :3000
npm run build            # Production build
```

### CLI
```bash
cd cli
npm run build            # Compile TypeScript
```

### MCP
```bash
cd mcp
npm run build            # Compile TypeScript
```

### Local Development Stack
```bash
./script/local-node.sh start    # Anvil + deploy + backend + frontend
./script/local-node.sh stop     # Stop all services
./script/local-node.sh reset    # Clear all data and restart fresh
```

## Architecture

### Smart Contracts (`src/`)
Six UUPS-upgradeable contracts + one standalone:
- **NovelCore** — Chapter tree (parentId + children[]), novel/chapter CRUD, metadata, worldLineAncestors storage. Writing always available. Round state is mutated only by RoundManager via privileged setters.
- **RoundManager** — Round lifecycle (start/close/settle/nominate), DFS candidate generation, commit-reveal vote forwarding, final completion.
- **VotingEngine** — Commit-reveal voting. 3x accuracy weight. One vote per address per round. Privileged calls gated by RoundManager.
- **PrizePool** — Per-round distribution: creator royalty `D/(D+round)` decay, author/voter rewards. Tips (public `tipNovel` / `tipChapter`). Keeper rewards.
- **BountyBoard** — Reader bounties for direct-child continuations. 20% to pool, 80% to authors or refund.
- **RulesEngine** — World-building rules: creator rules (before first round) + proposal-based changes. Eligibility for proposing & voting is proven on-demand via `(chapterId, path)` — caller authored chapter that's currently on a world line.
- **UserRegistry** — One-time immutable nickname registry (standalone, non-upgradeable).

State flow (on RoundManager): `Idle → startRound(DFS) → Nominating → closeNomination → Committing → closeCommit → Revealing → settleRound → Idle`

### Web Backend (`web/backend/src/`)
- **Indexer** — Polls chain events from all 7 contracts (NovelCore, RoundManager, VotingEngine, PrizePool, BountyBoard, RulesEngine, UserRegistry), writes to PostgreSQL. Confirmation blocks for reorg safety.
- **Keeper** — Optional auto-keeper service (configure `KEEPER_PRIVATE_KEY`).
- **REST API** — Read-only: novels, chapters, users, bounties, rules endpoints.
- **ABI matching** — `utils/abi.ts` must match contract event signatures exactly, including `indexed` keywords.
- **Database** — Single `migrations/001_init.sql`, clean schema.

### Web Frontend (`web/frontend/src/`)
- Next.js 16 with App Router, React 19, Tailwind CSS 4, shadcn/ui, RainbowKit.
- Pages: novel list, novel detail (N-column world line display), chapter reader, chapter detail, story tree (react-d3-tree).
- CSS variables for theming, `data-theme` attribute for dark/light switch.

### CLI (`cli/`)
- npm package: `onchain-novel-cli`
- `onchain-novel-cli setup` generates `.mcp.json` + `.claude/commands/*.md` skill files.
- Reads via backend API, writes directly on-chain via viem.

### MCP (`mcp/`)
- npm package: `onchain-novel-mcp`
- Provides structured tool calling for MCP-compatible agents.

## Key Design Rules

- **Writing always on** — `submitChapter` has no phase restriction.
- **One vote per address per round** — Contract reverts `AlreadyCommitted()`.
- **DFS candidate generation** — `RoundManager.startRound` does full scan from `worldLineAncestors` (via NovelCore views), returns the N deepest chains.
- **Creator royalty** — `D/(D+round)` where D=CREATOR_DECAY_DIVISOR (constant, currently 3).
- **Voter accuracy** — 3x weight for voting on a winning world line, 1x for others who revealed.
- **Content storage** — Three modes (Onchain/External/HTTP) set at novel creation, immutable.
- **Fork fee** — `max(submissionFee, sourcePoolBalance * forkFeeRate / 10000)`.
- **All IDs** — `uint64` in contracts, `BIGINT` in DB.
