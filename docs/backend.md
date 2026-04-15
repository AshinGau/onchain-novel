# Backend Design (Indexer + REST API + Keeper)

Event indexer + read-only query API + optional Keeper service.

## 1. Indexer

- Polls on-chain events from 5 contract addresses (NovelCore, VotingEngine, PrizePool, BountyBoard, RulesEngine)
- Adaptive batch size + RPC rotation + exponential backoff retry
- Each event batch processed in a single DB transaction; individual event failure does not affect the batch
- Confirmation blocks (`INDEXER_CONFIRMATION_BLOCKS`) for reorg safety

## 2. Keeper Service

Optional; activates when `KEEPER_PRIVATE_KEY` is configured. Reads novel state from DB, auto-triggers phase transitions.

```
Every N seconds, scan active novels:
  Idle       && lastSettleTime + minRoundGap <= now       -> startRound(novelId)
  Nominating && phaseStartTime + nominateDuration <= now  -> closeNomination(novelId)
  Committing && phaseStartTime + commitDuration <= now    -> closeCommit(novelId)
  Revealing  && phaseStartTime + revealDuration <= now    -> batch revealVote for stored votes, then settleRound(novelId)
```

Transaction failure (already executed by another keeper) silently skipped. Without configuration, backend degrades to pure indexer + API.

### 2.1 Keeper-Assisted Reveal

When reveal phase begins, Keeper batch-reveals all stored plaintext votes before calling `settleRound`:

1. Query `pending_votes` table for `(novelId, round)` where status = `committed`
2. For each vote, call `revealVote(novelId, voter, candidateId, salt)` on-chain using Keeper wallet (permissionless — anyone can submit on behalf of the voter; keeper pays gas)
3. Mark vote as `revealed` in DB; on tx failure mark `failed` (vote was likely already self-revealed)
4. After all reveals processed, proceed to `settleRound` when reveal duration expires

Stored votes are encrypted at rest (`VOTE_ENCRYPTION_KEY` env var). Votes are purged after round settlement.

## 3. REST API

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

## 4. Comment System (Off-Chain)

Comments live entirely off-chain in PostgreSQL — no consensus value, no fee, never touch the chain. Authentication is per-comment via EIP-191 wallet signature, so authorship is cryptographically verifiable without gas.

- Frontend builds canonical message: `Comment on chapter {chapterId} at {unixSeconds}: {content}`
- User signs with wallet (`personal_sign` / EIP-191)
- Backend recovers signer, rejects if signature invalid, timestamp >5min old, or rate limit exceeded
- Append-only (no edit / delete). Signature stored alongside content for third-party re-verification
- Spam control: per-address rate limit (default 10 comments per chapter per hour)
