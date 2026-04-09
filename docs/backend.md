# Backend Design (Indexer + REST API + Keeper)

Event indexer + read-only query API + optional Keeper service.

## 1. Directory Structure

```
web/backend/src/
  index.ts                # Express server + indexer + keeper + background tasks
  db/                     # PostgreSQL connection + migrations (single 001_init.sql, from scratch)
  indexer/
    index.ts              # Event polling loop (adaptive batch, RPC rotation, retry)
    handlers.ts           # Event handlers (parse events -> write DB)
    content-fetcher.ts    # External/HTTP mode content fetch + retry
  keeper/
    index.ts              # Auto keeper: scan active novels, trigger phase transitions
    reveal.ts             # Batch reveal votes on behalf of users
  api/
    novels.ts             # Novel list/detail/tree/worldlines/rounds/forks/stats/tips
    chapters.ts           # Chapter detail/children/context/siblings/comments/bounties/tips
    users.ts              # User votes/rewards/chapter history
    bounties.ts           # Bounty queries
    rules.ts              # Rule/proposal queries
    content.ts            # Content hash computation (External/HTTP helper)
    votes.ts              # Vote submission (plaintext vote for keeper-assisted reveal)
  utils/
    abi.ts                # Contract ABI (re-exported from shared package)
    env.ts                # Environment variables
    validate.ts           # Request parameter validation
    auth.ts               # EIP-191 signature verification (comment auth)
    pool-sync.ts          # Periodic on-chain prize pool balance sync
```

## 2. Indexer

- Polls on-chain events from 5 contract addresses (NovelCore, VotingEngine, PrizePool, BountyBoard, RulesEngine)
- Adaptive batch size + RPC rotation + exponential backoff retry
- Each event batch processed in a single DB transaction; individual event failure does not affect the batch
- Confirmation blocks (`INDEXER_CONFIRMATION_BLOCKS`) for reorg safety

## 3. Keeper Service

Optional; activates when `KEEPER_PRIVATE_KEY` is configured. Reads novel state from DB, auto-triggers phase transitions.

```
Every N seconds, scan active novels:
  Idle       && lastSettleTime + minRoundGap <= now       -> startRound(novelId)
  Nominating && phaseStartTime + nominateDuration <= now  -> closeNomination(novelId)
  Committing && phaseStartTime + commitDuration <= now    -> closeCommit(novelId)
  Revealing  && phaseStartTime + revealDuration <= now    -> batch revealVote for stored votes, then settleRound(novelId)
```

Transaction failure (already executed by another keeper) silently skipped. Without configuration, backend degrades to pure indexer + API.

### 3.1 Keeper-Assisted Reveal

When reveal phase begins, Keeper batch-reveals all stored plaintext votes before calling `settleRound`:

1. Query `pending_votes` table for `(novelId, round)` where status = `committed`
2. For each vote, call `revealVote(novelId, candidateId, salt)` on-chain using Keeper wallet
3. Mark vote as `revealed` in DB; on tx failure mark `failed` (vote was likely already self-revealed)
4. After all reveals processed, proceed to `settleRound` when reveal duration expires

Stored votes are encrypted at rest (`VOTE_ENCRYPTION_KEY` env var). Votes are purged after round settlement.

## 4. REST API

| Endpoint | Description |
|----------|-------------|
| `GET /api/novels` | List (pagination, sort, search, filter) |
| `GET /api/novels/:id` | Detail (config, phase, round info) |
| `GET /api/novels/:id/tree` | Chapter tree |
| `GET /api/novels/:id/worldlines` | Current world lines |
| `GET /api/novels/:id/rounds/:round` | Voting round data |
| `GET /api/novels/:id/forks` | Fork list |
| `GET /api/novels/:id/stats` | Statistics |
| `GET /api/novels/:id/tips` | Tip records |
| `GET /api/novels/:id/bounties` | Bounty list |
| `GET /api/novels/:id/rules` | Rule list |
| `GET /api/novels/:id/rule-proposals` | Rule proposals |
| `GET /api/chapters/:id` | Chapter detail |
| `GET /api/chapters/:id/children` | Child chapters |
| `GET /api/chapters/:id/context` | Ancestor chain (with content_text) |
| `GET /api/chapters/:id/siblings` | Sibling chapters |
| `GET /api/chapters/:id/comments` | List comments (paginated) |
| `POST /api/chapters/:id/comments` | Submit comment (EIP-191 signature required) |
| `GET /api/chapters/:id/bounties` | Chapter bounties |
| `GET /api/chapters/:id/tips` | Chapter tips |
| `GET /api/bounties/:id` | Bounty detail |
| `GET /api/users/:address/votes` | User vote history |
| `GET /api/users/:address/rewards` | User rewards |
| `GET /api/users/:address/chapters` | User chapters |
| `POST /api/content/upload` | Content hash computation |
| `POST /api/votes/submit` | Submit plaintext vote for keeper-assisted reveal |

## 5. Comment System (Off-Chain)

Comments live entirely off-chain in PostgreSQL — they carry no consensus value, no fee, and never touch the chain. Authentication is per-comment via EIP-191 wallet signature, so authorship is still cryptographically verifiable without paying gas.

**Submit flow**:
1. Frontend builds the canonical message: `Comment on chapter {chapterId} at {unixSeconds}: {content}`
2. User signs the message with their wallet (`personal_sign` / EIP-191)
3. Frontend `POST`s `{chapterId, content, timestamp, signature}` to the backend
4. `utils/auth.ts` recovers the signer; the request is rejected if the signature does not verify, if the timestamp is more than 5 minutes old, or if the rate limit is exceeded
5. The backend stores the comment with the recovered address as `author`

**Schema**: `comments(id, chapter_id, author, content, signature, created_at)`. Append-only — no edit, no delete. The signature is stored alongside the content so any third party can re-verify authorship later.

**Spam control**: per-address rate limit at the API layer (default: 10 comments per chapter per hour). Because there is no on-chain cost, throttling at this layer is the only defense.
