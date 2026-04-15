# Onchain Novel — Web Application

Web frontend and backend for the Onchain Novel protocol.

## Architecture

```
Frontend (Next.js 16)          Backend (Express)                Chain (EVM)
┌──────────────────┐         ┌──────────────────────┐       ┌───────────────┐
│  App Router      │──REST──▶│  REST API            │       │ NovelCore     │
│  wagmi + viem    │──RPC───▶│  Event Indexer       │◀─logs─│ VotingEngine  │
│  react-d3-tree   │         │  Keeper Service      │       │ PrizePool     │
└──────────────────┘         └──────────┬───────────┘       │ BountyBoard   │
                                        │                   │ RulesEngine   │
                                   PostgreSQL               └───────────────┘
```

- **Frontend** — Next.js 16, React 19, Tailwind CSS 4, shadcn/ui, RainbowKit, react-d3-tree
- **Backend** — Express, viem, PostgreSQL, event indexer, optional keeper service

## Prerequisites

- Node.js >= 18
- PostgreSQL >= 14
- Foundry (anvil, forge, cast)

## Quick Start

### Backend

```bash
cd web/backend
npm install
npm run migrate   # Create database tables (single 001_init.sql)
npm run dev       # Start API server + indexer on :3001
```

Environment variables:
```env
DATABASE_URL=postgresql://localhost:5432/onchain_novel
RPC_URL=http://localhost:8545
NOVEL_CORE_ADDRESS=0x...
VOTING_ENGINE_ADDRESS=0x...
PRIZE_POOL_ADDRESS=0x...
BOUNTY_BOARD_ADDRESS=0x...
RULES_ENGINE_ADDRESS=0x...
KEEPER_PRIVATE_KEY=0x...       # Optional: enables auto-keeper
```

### Frontend

```bash
cd web/frontend
npm install
npm run dev       # Start dev server on :3000
```

### Local Development (all-in-one)

```bash
./script/local-node.sh start   # Anvil + deploy + backend + frontend
./script/local-node.sh stop
```

## Backend E2E Tests

Full lifecycle test against Anvil: deploy, create novel, submit chapters, vote, settle, tip, bounty, fork, verify API.

```bash
./web/backend/e2e-test.sh
```

## API Endpoints

### Novels
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/novels` | List (sort, filter, search, pagination) |
| GET | `/api/novels/:id` | Detail (config, phase, round) |
| GET | `/api/novels/:id/tree` | Chapter tree |
| GET | `/api/novels/:id/worldlines` | Current world line ancestors |
| GET | `/api/novels/:id/rounds/:round` | Round voting data |
| GET | `/api/novels/:id/forks` | Fork list |
| GET | `/api/novels/:id/stats` | Statistics |
| GET | `/api/novels/:id/tips` | Tip history |
| GET | `/api/novels/:id/bounties` | Bounty list |
| GET | `/api/novels/:id/rules` | World-building rules |
| GET | `/api/novels/:id/rule-proposals` | Rule proposals |

### Chapters
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/chapters/:id` | Detail + content |
| GET | `/api/chapters/:id/children` | Direct children |
| GET | `/api/chapters/:id/context` | Ancestor chain (with content) |
| GET | `/api/chapters/:id/siblings` | Same-parent chapters |
| GET | `/api/chapters/:id/comments` | Comments |
| GET | `/api/chapters/:id/bounties` | Chapter bounties |
| GET | `/api/chapters/:id/tips` | Chapter tips |

### Users
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users/:address/votes` | Voting history |
| GET | `/api/users/:address/chapters` | Submitted chapters |
| GET | `/api/users/:address/rewards` | Reward summary |

### Bounties & System
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/bounties/:id` | Bounty detail |
| POST | `/api/content/hash` | Compute `(contentHash, declaredLength)` for a UTF-8 body |
| GET | `/health` | Indexer status |
