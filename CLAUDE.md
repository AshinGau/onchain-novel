# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Decentralized Collaborative Novel Protocol — smart contracts on EVM + web app (Next.js frontend, Express backend with PostgreSQL indexer). Multiple AI Agents and humans co-author novels on-chain via a "Branch → Consensus → Attribution → Incentive" closed-loop mechanism.

## Build & Test Commands

### Smart Contracts (Foundry)
```bash
forge build              # Build contracts
forge test -vvv          # Run all 62 tests (integration, E2E, fuzz, upgrade, reentrancy, gas)
forge fmt --check        # Check formatting
```

### Frontend (Next.js 16 + Vitest)
```bash
cd web/frontend
npm run test             # Run 27 vitest tests
npm run test:watch       # Watch mode
npm run dev              # Dev server on :3000
npm run build            # Production build
```

### Backend (Express + TypeScript)
```bash
cd web/backend
npm run dev              # Dev with tsx watch on :3001
npm run build            # Compile TypeScript
npm run migrate          # Run DB migrations
```

### Local Development Stack
```bash
./script/local-node.sh start    # Start Anvil + deploy contracts + backend + frontend
./script/local-node.sh stop     # Stop all services
./script/local-node.sh reset    # Clear all data and restart fresh
./script/local-node.sh status   # Show running services
./script/local-node.sh timewarp 1d  # Fast-forward Anvil time (supports s/m/h/d)
```
Logs: `.local-node/anvil.log`, `.local-node/backend.log`, `.local-node/frontend.log`

## Architecture

### Smart Contracts (`src/`)
Five UUPS-upgradeable contracts behind proxies (+1 not yet integrated):
- **NovelCore** — State machine (Round/Epoch phases), chapter submission (bootstrap + collaborative), stake management, keeper rewards. Coordinates all other contracts.
- **RulesEngine** — World-building rules governance: creator rules (epoch 1) + proposal-based rule changes (canon authors vote). Reads novel state from NovelCore via view calls.
- **VotingEngine** — Commit-Reveal Stake-to-Vote. One vote per address per round. `commitVote` → `revealVote` → `tallyVotes`.
- **PrizePool** — Fund management. Three-layer epoch distribution: creator royalty `1/(1+C)` → author rewards → voter accuracy rewards (3x weight). Pull-based claims. Accepts deposits from NovelCore and RulesEngine.
- **ChapterNFT** — ERC-721 + ERC-2981 for canon chapter copyright.
- **ReportRegistry** — Bond-based reporting (interface exists, not fully integrated in web).

State flow: `Submitting → closeSubmissions → Committing → closeCommit → Revealing → settleRound → [repeat K rounds] → Epoch Committing → closeEpochCommit → Epoch Revealing → settleEpoch → next Epoch`

### Web Backend (`web/backend/src/`)
- **Event Indexer** (`indexer/`) — Polls chain for logs, decodes events, writes to PostgreSQL. Processes events within DB transactions. Individual event failures are caught and logged without rolling back the batch.
- **Content Decoding** — For Onchain mode, chapter content is decoded from transaction calldata via `decodeFunctionData` (not from events). For External/HTTP mode, content is fetched from `contentBaseUrl + contentHash`.
- **REST API** (`api/`) — novels, chapters, users, notifications, content endpoints. Uses `safeInt()` for pagination, `validateAddress()` middleware for address params.
- **ABIs** (`utils/abi.ts`) — Must match contract event signatures exactly, including `indexed` keywords. Mismatched `indexed` causes silent decode failures.

### Web Frontend (`web/frontend/src/`)
- **Next.js 16** with App Router. Server components for data fetching, client components for wallet interaction.
- **IMPORTANT**: This Next.js version has breaking changes. Read `node_modules/next/dist/docs/` before modifying Next.js-specific patterns.
- **Transaction lifecycle** — All contract writes use the `useTxAction` hook (`hooks/use-tx-action.ts`), which wraps `writeContract` + `useWaitForTransactionReceipt`. UI updates (localStorage saves, redirects) happen only after on-chain confirmation, never optimistically.
- **Shared config** — `lib/config.ts` exports `TOKEN_SYMBOL` and `DEFAULT_STAKE`. `lib/novel-config.ts` exports `NovelConfigForm` type, `DEFAULT_CONFIG`, data-driven validation rules, and `validateAllFields()`.
- **Vote storage** — `lib/vote-storage.ts` stores `{candidateId → userSalt}` in localStorage per voting round. `toBytes32Salt()` converts user input to bytes32 at commit and reveal time (same function both times, so users only remember their original input).
- **ConfigForm** (`components/config-form.tsx`) — Shared between Create and Fork pages. Handles all novel config fields with inline validation on blur.

## Key Design Rules

- **One vote per address per round** — Contract reverts `AlreadyCommitted()`. Frontend must check on-chain commit status via `getVoteCommit` before showing vote UI.
- **World line reset** — `WorldLinesSelected` (round settle) and `CanonEstablished` (epoch settle) both reset `is_world_line` flags. The indexer must clear ALL world lines for the novel, not just the current round.
- **"Continue this story" button** — Only shown when `is_world_line && novel.active && epoch_phase === 0 && round_phase === 0` (Submitting phase only).
- **Creator royalty** — Fixed `1/(1+C)` formula regardless of bootstrap chapter count (prevents inflation exploit).
- **Content storage** — Three modes (Onchain/External/HTTP) set at novel creation, immutable. `ContentLocation` enum defined in `web/backend/src/utils/validate.ts`.
