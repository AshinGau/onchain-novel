# Onchain Novel — Web Application

Web frontend and backend for the Onchain Novel decentralized collaborative storytelling protocol.

## Architecture

```
Frontend (Next.js)           Backend (Express + Node.js)         Chain (EVM)
┌──────────────────┐         ┌──────────────────────┐         ┌───────────┐
│  SSR/SSG pages   │──REST──▶│  REST API            │         │ NovelCore │
│  wagmi + viem    │──RPC───▶│  Event Indexer       │◀─logs──│ Voting    │
│  Irys (Arweave)  │         │  Notification Engine │         │ PrizePool │
└──────────────────┘         └──────────┬───────────┘         │ ChapterNFT│
                                        │                     └───────────┘
                                   PostgreSQL
```

- **Frontend** — Next.js 16, Tailwind CSS, shadcn/ui, RainbowKit wallet
- **Backend** — Express.js, viem, PostgreSQL, event indexer with batch fetching + retry
- **Storage** — Arweave via Irys SDK (frontend direct upload, user pays with ETH wallet)

## Prerequisites

- Node.js >= 18
- PostgreSQL >= 14
- Foundry (anvil, forge, cast) — for local development and E2E tests

## Quick Start

### 1. Backend

```bash
cd web/backend
cp .env.example .env
# Edit .env with your database URL, RPC URL, and contract addresses

npm install
npm run migrate   # Create database tables
npm run dev       # Start API server + indexer (default port 3001)
```

### 2. Frontend

```bash
cd web/frontend
cp .env.example .env.local
# Edit .env.local with your API URL and contract addresses

npm install
npm run dev       # Start dev server (default port 3000)
```

### 3. Local Development (Anvil)

```bash
# Terminal 1: Start local chain
anvil --block-time 1

# Terminal 2: Deploy contracts
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast

# Terminal 3: Start backend (pointed at Anvil)
cd web/backend
DATABASE_URL=postgresql://localhost:5432/onchain_novel \
RPC_URL=http://localhost:8545 \
NOVEL_CORE_ADDRESS=0x... \
npm run dev

# Terminal 4: Start frontend
cd web/frontend
NEXT_PUBLIC_API_URL=http://localhost:3001 \
NEXT_PUBLIC_RPC_URL=http://localhost:8545 \
npm run dev
```

## Testing

### Frontend Unit Tests

```bash
cd web/frontend
npm test              # Run once (27 tests, ~1s)
npm run test:watch    # Watch mode
```

Tests cover: format utilities, voting round ID computation, phase countdown timer, UTF-8 byte counting.

### Backend E2E Tests

Runs a full lifecycle against Anvil: deploy contracts, create novel, submit chapters, vote, settle epoch, then verify all API endpoints return correct data.

```bash
# Requires: PostgreSQL running, Foundry installed
./web/backend/e2e-test.sh
```

The script:
1. Starts Anvil (local ETH node)
2. Deploys all contracts
3. Creates a test database `onchain_novel_e2e_test`
4. Starts the backend (indexer + API)
5. Simulates full lifecycle via `cast` (create novel, submit chapters, commit/reveal votes, settle round/epoch, tip)
6. Waits for indexer to catch up (polls `/health` endpoint)
7. Verifies ~25 API endpoints return correct indexed data
8. Cleans up: kills processes, drops test database

## API Endpoints

### Novels
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/novels` | List novels (sort, filter, search, pagination) |
| GET | `/api/novels/ranking` | Top novels by criteria |
| GET | `/api/novels/:id` | Novel detail + metadata |
| GET | `/api/novels/:id/tree` | Story tree (chapter parent relationships) |
| GET | `/api/novels/:id/canon` | Canon chapter chain |
| GET | `/api/novels/:id/worldlines` | Active world lines |
| GET | `/api/novels/:id/rounds/:round` | Round submissions |
| GET | `/api/novels/:id/forks` | Fork children |
| GET | `/api/novels/:id/stats` | Chapter/author/vote/tip stats |
| GET | `/api/novels/:id/tips` | Tip history |

### Chapters
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/chapters/:id` | Chapter detail + content |
| GET | `/api/chapters/:id/siblings` | Same-parent chapters |
| GET | `/api/chapters/:id/children` | Direct children |
| GET | `/api/chapters/:id/context` | Ancestor chain |
| GET | `/api/chapters/:id/comments` | Comments |
| POST | `/api/chapters/:id/comments` | Post comment (wallet signed) |
| DELETE | `/api/chapters/:id/comments/:cid` | Delete comment (wallet signed) |

### Users
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users/:address/votes` | Voting history |
| GET | `/api/users/:address/chapters` | Submitted chapters |
| GET | `/api/users/:address/nfts` | Canon NFTs |
| GET | `/api/users/:address/rewards` | Reward summary |

### Notifications
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notifications/:address` | Notification list |
| GET | `/api/notifications/:address/unread-count` | Unread count |
| POST | `/api/notifications/:address/mark-read` | Mark read (wallet signed) |

### System
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Indexer status + last block |

## Security

- **Wallet signature verification** — Write endpoints (comments, notification mark-read) require EIP-191 signed requests via `x-address` + `x-signature` headers
- **Rate limiting** — 100 req/min for reads, 20 req/min for writes per IP
- **CORS** — Configurable origin via `FRONTEND_URL` env var (defaults to `*` for development)
- **Parameterized SQL** — All queries use `$1, $2` parameters, no string interpolation
- **Content storage** — Arweave permanent storage, content hash verified on-chain
