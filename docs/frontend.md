# Frontend Design

Next.js 16 + App Router. Data from backend REST API; on-chain writes via wallet (wagmi/viem + RainbowKit).

## 1. Design Principles

- CSS variables define the complete color system (light/dark via `data-theme` attribute), no hardcoded colors
- Semantic CSS classes in `globals.css`, no inline styles or excessive utility classes
- Shared components for repeated patterns (chapter cards, buttons, modals, tx status)
- Responsive: lg+ full N-column layout, md 2-column, sm single-column with tabs
- Reader-subset scope: writing, voting, rule governance, and novel completion flows live in CLI/MCP; the frontend covers discovery, reading, tipping, bounties, forking, and novel creation.

## 2. Pages

```
/                                 -> Landing / intro
/novels                           -> Novel list (paginated, sort, search)
/novels/[id]                      -> Novel home (N-column world line display + info bar)
/novels/[id]/read/[leafId]        -> Reading page (root -> leaf, paginated, centered serif layout)
/novels/[id]/chapter/[chapterId]  -> Chapter detail (content, tips, bounties, comments, fork/continue)
/novels/[id]/tree                 -> Story tree (react-d3-tree, lazy loading, world line highlighting)
/create                           -> Create a new novel (config + root chapter + optional initial rules)
/fork/[novelId]/[chapterId]       -> Fork from an existing chapter (cross-novel reference)
/dashboard                        -> Connected-wallet dashboard (rewards, votes, authored chapters)
```

## 3. Shared Modules

| Module                                   | Role                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `lib/wagmi-config.ts`                    | Exports `wagmiConfig`, `chain`, and `rpcUrl` — single source of chain configuration  |
| `lib/contracts.ts`                       | Contract addresses + ABI imports                                                     |
| `lib/api.ts`                             | `apiFetch` wrapper over backend REST API                                             |
| `lib/format.ts`                          | `formatBalance`, `timeAgo`, `shortAddress`, `parsePositiveDecimal/Int` input guards  |
| `hooks/use-tx-action.ts`                 | Wraps `writeContractAsync` + `useWaitForTransactionReceipt`; status: `idle → confirming → waiting → success \| error` |
| `hooks/use-novel.ts` / `use-chapter.ts`  | React Query–backed data hooks                                                        |
| `components/tx-status.tsx`               | `TxStatusLabel` + `txButtonLabel` — unified tx feedback                              |
| `components/chapter-card-mini.tsx`       | Shared chapter card (list + tree + world-line column views)                          |
| `components/story-tree.tsx`              | react-d3-tree wrapper; children sorted via numeric-aware `localeCompare` (uint64-safe) |

## 4. Key UX Flows

### Voting (Committing Phase)

User sees candidate list → selects candidate → auto-generates salt → computes commitHash → sends `commitVote` with `voteStake` → submits plaintext (encrypted at rest) to backend for keeper-assisted reveal → saves salt to localStorage as backup.

Revealing is automatic via the backend keeper. Manual fallback: read salt from localStorage → send `revealVote`.

### Fork

Chapter page → "Fork This Story" → `/fork/[novelId]/[chapterId]` form (new novel title, config, root chapter content) → calls `forkNovel`. A forkFee = `max(submissionFee, sourcePoolBalance * forkFeeRate / 10000)` is paid to the source pool.

### Tips and Bounties

- `TipButton` and `BountyCreateForm` on the chapter page collect an ETH amount + optional deadline.
- Input is validated through `parsePositiveDecimal` / `parsePositiveInt` before `parseEther` / `BigInt` to surface UX errors instead of throwing.

### Comments

EIP-191 signed, off-chain, append-only. No gas, no on-chain transaction.

### Transaction Lifecycle

`useTxAction` returns `{ send, reset, status, error, txHash, isPending }`. `send(params, onSuccess?)` calls `writeContractAsync`, then the hook observes `useWaitForTransactionReceipt` and fires `onSuccess` only after the receipt resolves. No manual RPC polling.

## 5. Not Implemented (use CLI/MCP)

- Nomination submission UI
- Rule proposal / governance UI (frontend only sets initial creator rules at novel creation)
- Novel completion UI
- Round-keeper transitions (startRound / closeNomination / closeCommit / settle)
