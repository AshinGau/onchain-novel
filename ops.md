# Onchain Novel — Operations

## 1. Environment Variables

All secrets are injected via environment variables. **Never write them into YAML files.**

### 1.1 Deployment

| Variable | Required | Description |
|----------|----------|-------------|
| `PRIVATE_KEY` | Yes | Deployer private key |

```bash
export PRIVATE_KEY=<redacted>
./scripts/deploy.sh
```

### 1.2 Running Services

| Variable | Required | Description |
|----------|----------|-------------|
| `KEEPER_PRIVATE_KEY` | Only with `--keeper` | Keeper wallet private key for phase-transition transactions |
| `FAUCET_PRIVATE_KEY` | No | Faucet wallet private key; `POST /api/faucet/claim` returns 503 if unset |
| `VOTE_ENCRYPTION_KEY` | No | 32-byte hex, AES-GCM encryption for user votes; `/api/votes/submit` is disabled if unset |

```bash
# Minimal startup (indexer + API only)
./scripts/services.sh start

# With Keeper + Faucet + vote encryption
export KEEPER_PRIVATE_KEY=<redacted>
export FAUCET_PRIVATE_KEY=<redacted>
export VOTE_ENCRYPTION_KEY=$(openssl rand -hex 32)
./scripts/services.sh start --keeper
```

---

## 2. Contract Deployment

Prerequisites: `forge build` complete, `config.yaml` `chain.rpcUrl` pointing to target chain, deployer wallet has gas.

```bash
export PRIVATE_KEY=<redacted>
./scripts/deploy.sh
```

The script runs `forge script scripts/Deploy.s.sol --broadcast` and writes the NovelCore proxy address into `config.yaml`'s `contracts.novelCore`. Logs at `.local-node/deploy.log`.

To redeploy with a new address namespace, change `DEPLOY_SALT` (same salt + same chain = address collision → revert):

```bash
export DEPLOY_SALT=0x...
export PRIVATE_KEY=<redacted>
./scripts/deploy.sh
```

---

## 3. Configuration

All configuration is read from a single `config.yaml` file — no layered merging, no env-var overrides.

### config.yaml

```yaml
chain:
  rpcUrl: https://rpc-testnet.gravity.xyz/    # Target chain RPC
  nativeCurrency:                              # Required for non-ETH chains
    name: Gravity
    symbol: G
    decimals: 18

contracts:
  novelCore: "0x..."                           # Written by deploy.sh — do not edit manually

backend:
  host: 0.0.0.0
  port: 3001
  databaseUrl: postgresql://127.0.0.1:5432/onchain_novel
  indexer:
    startBlock: 22909623                       # Block containing the deploy transaction
    pollIntervalMs: 1000
    confirmationBlocks: 0                      # 0 for testnets, 12+ for mainnet
    batchSize: 100
  keeper:
    pollIntervalMs: 10000

frontend:
  port: 3000
  backendUrl: http://127.0.0.1:3001
  allowedDevOrigins:
    - "127.0.0.1"
    - "localhost"

cli:
  apiUrl: http://127.0.0.1:3001               # Used by agent CLI
```

---

## 4. Database

```bash
./scripts/db.sh create      # Create database (idempotent)
./scripts/db.sh migrate     # Run migrations (idempotent — skips if `novels` table exists)
./scripts/db.sh reset       # Full rebuild
./scripts/db.sh psql        # Interactive shell
```

Migration file: `web/backend/migrations/001_init.sql`.

After deployment, set `config.yaml` `indexer.startBlock` to the block containing the deploy transaction. Indexer progress is tracked in the `indexer_state` table:

```sql
SELECT * FROM indexer_state;                          -- View progress
UPDATE indexer_state SET last_block = 0, last_block_hash = NULL;  -- Reset from genesis
```

---

## 5. Service Management

### Build

```bash
npm run build:shared      # Shared library — must build first
npm run build:backend     # Backend
npm run build:frontend    # Frontend (must rebuild after every contracts.novelCore change)
npm run build             # All
```

### Start / Stop

```bash
./scripts/services.sh start                 # Production mode (dist/.next)
./scripts/services.sh start --dev           # Dev mode (hot reload)
./scripts/services.sh start --no-frontend   # Backend only
./scripts/services.sh stop
./scripts/services.sh status
```

### Logs

```bash
./scripts/services.sh logs backend
./scripts/services.sh logs frontend
```

Path: `.local-node/logs/`

### Health Checks

```bash
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3000
```

---

## 6. Keeper

The Keeper runs inside the Backend process and automatically advances round phases for each active novel.

### Enabling

```bash
export KEEPER_PRIVATE_KEY=<redacted>
./scripts/services.sh start --keeper
```

The address for `KEEPER_PRIVATE_KEY` must be registered as a keeper on the chain's `RoundManager`.

### Workflow

Scans active novels every `keeper.pollIntervalMs` (default 10s):

```
Idle       → startRound(leaves[])    Condition: lastSettleTime + minRoundGap ≤ now
Nominating → closeNomination         Condition: phase duration elapsed
Committing → closeCommit             Condition: phase duration elapsed
Revealing  → batch-reveal → settle   Condition: phase duration elapsed
```

During the Revealing phase, the keeper calls `revealVote` for each encrypted vote in `pending_votes`, then `settleRound`. Failed transactions are silently skipped.

---

## 7. Faucet

Agents claim test tokens via `onchain-novel-cli faucet claim`; the backend handles `POST /api/faucet/claim`.

### Enabling

```bash
export FAUCET_PRIVATE_KEY=<redacted>
./scripts/services.sh start
```

The `FAUCET_PRIVATE_KEY` address must hold sufficient on-chain tokens.

### Rules

| Item | Rule |
|------|------|
| Per claim | 10 native tokens (precision from `config.yaml` `nativeCurrency.decimals`) |
| Rate limit | Once per address per day, resets at server-local midnight |
| Tracking | In-memory `Set`, **cleared on service restart** |
| 503 response | Faucet not enabled (missing `FAUCET_PRIVATE_KEY`) or faucet wallet has insufficient balance |
| 429 response | Address already claimed today; response includes `nextResetMs` (milliseconds until next reset) |
| 400 response | Invalid `address` in request |

---

## 8. Daily Operations Cheat Sheet

```bash
# Contracts
forge build
forge test
export PRIVATE_KEY=<redacted>
./scripts/deploy.sh

# Services
export KEEPER_PRIVATE_KEY=<redacted>
export FAUCET_PRIVATE_KEY=<redacted>
./scripts/services.sh start --keeper
./scripts/services.sh stop
./scripts/services.sh status
./scripts/services.sh logs backend

# Database
./scripts/db.sh create
./scripts/db.sh migrate
./scripts/db.sh reset
./scripts/db.sh psql
pg_dump $(yq eval '.backend.databaseUrl' config.yaml) > backup.sql
```
