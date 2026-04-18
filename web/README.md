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

`./scripts/bootstrap.sh` installs everything (foundry, node ≥20, postgres, yq, jq) on macOS (brew) or Linux (apt/yum). Alternatively install each tool manually.

## Configuration

All non-secret settings (ports, RPC, DB URL, contract addresses, indexer params) live in `config.yaml` at the repo root. Secrets (`PRIVATE_KEY`, `KEEPER_PRIVATE_KEY`, `VOTE_ENCRYPTION_KEY`, optional `DATABASE_URL`) come from the environment.

## Quick Start

### Full local stack

```bash
./scripts/dev.sh start      # anvil + db + deploy + backend + frontend (release mode; add --dev for watch)
./scripts/dev.sh stop    # stop everything
./scripts/dev.sh reset   # wipe DB + redeploy + restart
```

### Backend only

```bash
./scripts/anvil.sh    start
./scripts/db.sh       reset                  # create + migrate
PRIVATE_KEY=0x... ./scripts/deploy.sh        # writes addresses back to config.yaml
./scripts/services.sh start --no-frontend    # backend only, built artifact
# or: ./scripts/services.sh start --dev --no-frontend     # tsx watch
```

### Frontend only

```bash
cd web/frontend
npm run dev           # Next.js dev server on :3000
```

`/api/*` is proxied through Next.js to the backend (see `web/frontend/next.config.ts`), so the browser talks to a single origin regardless of IP / domain — no CORS.

## Backend E2E Test

Full lifecycle test against Anvil: deploy, create novel, submit chapters, vote, settle, tip, bounty, fork, verify API.

```bash
./web/backend/test.sh
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
