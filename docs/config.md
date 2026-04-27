# Configuration

All runtime configuration comes from three sources, merged in this order (last wins):

```
config.yaml  →  config.local.yaml  →  environment variables
  (base)         (personal override)     (per-run / secrets)
```

All three are optional except `config.yaml` (which must exist for the app to start). No code has fallback constants for anything listed in the schema — if a value isn't found in one of these three, loading fails loudly.

## The three sources

### 1. `config.yaml` — base config, committed to git

Repo root. Single source of truth for every **non-secret** setting: ports, RPC URL, chain ID, contract addresses, database URL, indexer parameters, etc. Anyone who clones the repo gets identical defaults.

Shape (see [`packages/shared/src/config.ts`](../packages/shared/src/config.ts) for the Zod schema that validates it):

```yaml
chain:
  rpcUrl: http://127.0.0.1:8545
  # chainId: 31337   # optional; auto-detected from rpcUrl if omitted

contracts:            # populated by scripts/deploy.sh — don't edit by hand
  novelCore: "0x..."  # the only address you need; the other six are derived
                      # on-chain via NovelCore's address book at startup
                      # (resolveContracts in @onchain-novel/shared)

backend:
  host: 127.0.0.1
  port: 3001
  databaseUrl: postgresql://127.0.0.1:5432/onchain_novel
  indexer:
    startBlock: 0
    pollIntervalMs: 5000
    confirmationBlocks: 12
    batchSize: 100
  keeper:
    pollIntervalMs: 10000

frontend:
  port: 3000
  backendUrl: http://127.0.0.1:3001        # SSR fetch + /api reverse-proxy target
  allowedDevOrigins: []                    # hostnames for Next.js HMR from LAN (e.g. ["192.168.1.2"])

cli:
  apiUrl: http://127.0.0.1:3001
```

Secrets are **never** allowed here — the Zod schema has no fields for private keys or encryption keys.

### 2. `config.local.yaml` — personal / machine-specific override, **gitignored**

Deep-merged on top of `config.yaml`. Same shape, partial allowed. Use this for:

- Pointing at a remote RPC (`chain.rpcUrl: https://eth-sepolia.…`)
- Enabling mobile LAN testing (`frontend.allowedDevOrigins: [192.168.1.2]`)
- Using a different local DB name

Template at `config.local.yaml.example` — copy to `config.local.yaml` and edit.

### 3. Environment variables — secrets + per-run overrides

Env vars cover two disjoint purposes:

**Secrets** — these have no YAML schema entry; reading code calls the helper directly:

| Env var | Required by | Helper |
|---|---|---|
| `PRIVATE_KEY` | CLI writes, deploy script | `getPrivateKey()` |
| `KEEPER_PRIVATE_KEY` | Backend keeper loop | `getKeeperPrivateKey()` |
| `VOTE_ENCRYPTION_KEY` | Backend `POST /api/votes/submit` | `getVoteEncryptionKey()` |
| `DATABASE_URL` | Backend DB connection (when password differs between CI/docker and `config.yaml`) | Merged into `backend.databaseUrl` if set |

**Per-run overrides** — a handful of env vars map onto schema keys and override them at load time:

| Env var | Overrides |
|---|---|
| `ONCHAIN_NOVEL_CONFIG` | Path to the main YAML file (else `<repo>/config.yaml`) |
| `DATABASE_URL` | `backend.databaseUrl` |
| `BACKEND_URL` | Frontend SSR API target (not in YAML — Next.js build-time only) |
| `FRONTEND_URL` | Backend CORS allow-list (split-deploy only; defaults to same-origin) |

## Merge order in one picture

```
        ┌─────────────────┐
        │  config.yaml    │  (committed, team-wide defaults)
        └────────┬────────┘
                 │  deep-merge
                 ▼
     ┌─────────────────────┐
     │  config.local.yaml  │  (gitignored, personal)
     └──────────┬──────────┘
                │  deep-merge (for keys that have env mappings)
                ▼
      ┌───────────────────┐
      │  env (subset)     │  DATABASE_URL, ONCHAIN_NOVEL_CONFIG
      └─────────┬─────────┘
                │  Zod validation
                ▼
         AppConfig (typed)
                +
         Secrets from env
         (PRIVATE_KEY, etc — never in files)
```

## Why three layers?

| Source | Visible to team? | In git? | Use for |
|---|---|---|---|
| `config.yaml` | Yes | Yes | Defaults, contract addresses (after deploy), structural shape |
| `config.local.yaml` | No | No | Personal preferences, device-specific things |
| env | No | No | Secrets, CI/docker injection, throwaway overrides |

Rule of thumb: **if committing it would be wrong** (secret, machine-specific, security-sensitive), it doesn't belong in `config.yaml`.

## Who reads what

| Consumer | How it loads |
|---|---|
| Backend (Express + indexer + keeper) | `loadConfig()` on startup in `web/backend/src/utils/env.ts` |
| Frontend (SSR + browser) | `loadConfig()` at **build time** in `web/frontend/next.config.ts` — values compiled into the bundle as `NEXT_PUBLIC_*` for browser, read via `process.env` for SSR |
| CLI | `loadConfig()` on every invocation from `cli/src/utils/config.ts` (lazy; not invoked by `--help`) |
| Shell scripts | `scripts/lib/read-config.sh` wraps `yq eval` for reading individual keys |
| `scripts/patch-config.ts` | Writes the NovelCore proxy address back into `config.yaml` after `forge script Deploy` |

## Typical lifecycle on a fresh checkout

```bash
# 1. Install deps (creates config.yaml defaults, optionally config.local.yaml from example)
./scripts/bootstrap.sh

# 2. Deploy — writes the NovelCore proxy address back into config.yaml
#    (the other 6 addresses are reachable on-chain from NovelCore at startup)
./scripts/dev.sh start

# 3. (Optional) override anything locally
vim config.local.yaml        # e.g. allowedDevOrigins for phone testing

# 4. Secrets at run time
export PRIVATE_KEY=0x...
export KEEPER_PRIVATE_KEY=0x...     # only if running with keeper
export VOTE_ENCRYPTION_KEY=$(openssl rand -hex 32)   # only if accepting /api/votes/submit
```

## Deployment cheat sheet

Production:

```bash
# On the deploy host
export NODE_ENV=production
export ONCHAIN_NOVEL_CONFIG=/etc/onchain-novel/config.yaml
export DATABASE_URL=postgresql://user:pass@db-host:5432/prod
export PRIVATE_KEY=$(vault kv get -field=deployer_key secret/onchain)
export KEEPER_PRIVATE_KEY=$(vault kv get -field=keeper_key secret/onchain)
export VOTE_ENCRYPTION_KEY=$(vault kv get -field=encryption_key secret/onchain)
export FRONTEND_URL=https://novel.example.com     # CORS

# /etc/onchain-novel/config.yaml committed via CM tool;
# contracts.novelCore baked in by patch-config.ts after each deploy
```

No `.env` files in production — all secrets come from the secret manager and are injected by the process supervisor (systemd, kubernetes, docker-compose, etc.).

## See also

- Schema source: [`packages/shared/src/config.ts`](../packages/shared/src/config.ts)
- Override example: [`config.local.yaml.example`](../config.local.yaml.example)
- Contract address auto-writer: [`scripts/patch-config.ts`](../scripts/patch-config.ts)
