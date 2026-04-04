## Web QA Plan: Scan → Test → Fix → Optimize

Eight full iterations. Status: **All eight iterations completed.**

---

### Iteration 1 — Security & Data Integrity ✅

**Changes made:**

- [x] **B1** Created `utils/validate.ts` with `validateAddress()` middleware and `safeInt()` — applied to all user/notification routes
- [x] **B2** Replaced all `parseInt(req.query.*)` with `safeInt()` across novels.ts, chapters.ts, users.ts, notifications.ts
- [x] **B3** Comment deletion made atomic (single `UPDATE...RETURNING` instead of SELECT then UPDATE)
- [x] **B4** Sort param validated against whitelist, returns 400 for unknown values
- [x] **B5/B6** Indexer batch processing: individual event failures now caught and logged without rolling back the entire batch
- [x] **B7** `ContentLocation` enum created in backend, replaces magic number `0` across handlers and content-fetcher
- [x] Fork fee validation added (must be >= source novel stake amount)

**Files modified:** `utils/validate.ts` (new), `api/novels.ts`, `api/chapters.ts`, `api/users.ts`, `api/notifications.ts`, `indexer/index.ts`, `indexer/handlers.ts`, `indexer/content-fetcher.ts`

---

### Iteration 2 — Frontend Transaction Lifecycle ✅

**Changes made:**

- [x] **F1/F2** Created `hooks/use-tx-action.ts` — wraps `writeContract` + `useWaitForTransactionReceipt` into clean lifecycle: `idle → signing → confirming → success/error`. `onSuccess` callback fires only after on-chain confirmation.
- [x] **F3/F4/F5** Create/Fork pages: replaced `setTimeout` redirect with `useTxAction({ onSuccess })`, shows proper signing/confirming states, error recovery
- [x] **F6** PhaseTransition: rewritten with `useTxAction`, adds retry button on error
- [x] **F7** TipModal: added `query: { enabled: !!hash }` to `useWaitForTransactionReceipt`
- [x] **F8** RewardsPanel: each Claim button now has its own `useTxAction` instance via `ClaimButton` component — no tx conflicts
- [x] **VotePanel**: complete rewrite — each `CandidateRow` has its own `commitTx` and `revealTx` via `useTxAction`. Vote saved to localStorage only after tx confirms. Error shown inline per candidate.
- [x] **VoteButton**: same pattern — `pendingSalt` tracked, saved only on success. Error recovery with "Try again" button.

**Files modified/created:** `hooks/use-tx-action.ts` (new), `app/create/page.tsx`, `app/fork/.../page.tsx`, `components/phase-transition.tsx`, `components/vote-panel.tsx`, `components/vote-button.tsx`, `components/rewards-panel.tsx`, `components/tip-modal.tsx`

---

### Iteration 3 — UI Consistency & Code Dedup ✅

**Changes made:**

- [x] **U1** Dashboard: added explicit error state (`fetchError`) — shows red error banner instead of silent empty state. API calls check `r.ok` before parsing JSON.
- [x] **U3** Default stake "0.01" moved to `lib/config.ts` as `DEFAULT_STAKE` — used in VotePanel, VoteButton, TipModal
- [x] **U5** Worldlines fetch made conditional (only when epoch voting phase is active)
- [x] **F9** ReportModal: stripped non-functional form fields, replaced with "Coming Soon" message. Removed unused imports (viem, wagmi writeContract, reportRegistryAbi).

**Files modified:** `app/dashboard/page.tsx`, `app/novels/[id]/page.tsx`, `lib/config.ts`, `components/vote-panel.tsx`, `components/vote-button.tsx`, `components/tip-modal.tsx`, `components/report-modal.tsx`

---

### Iteration 4 — Frontend Page-by-Page Bug Scan ✅

**Changes made:**

- [x] **F10** DiscoverTabs: added `res.ok` check, error state display, and race condition fix via `fetchId` ref counter — prevents out-of-order responses from overwriting correct data
- [x] **F11** NotificationBell: added `res.ok` check before parsing JSON responses
- [x] **F12** Canon page: `parseInt(ch)` now handles NaN from invalid query params (falls back to 0)
- [x] **F13** `timeAgo()`: added `isNaN` guard — returns empty string instead of "NaN d ago" on invalid dates
- [x] **B8** Content-fetcher: fixed SQL injection — replaced direct `${ContentLocation.Onchain}` interpolation with parameterized `$1` placeholder
- [x] **B9** Phase timestamp fix: `RoundPhaseChanged` and `EpochPhaseChanged` handlers now use actual block timestamp via `getBlockTimestamp()` instead of block number — fixes broken phase countdown timers

**Files modified:** `discover-tabs.tsx`, `notification-bell.tsx`, `canon/page.tsx`, `lib/format.ts`, `indexer/content-fetcher.ts`, `indexer/handlers.ts`

---

### Iteration 5 — Deep Component Audit ✅

**Changes made:**

- [x] **F14** Write page: refactored from raw `useWriteContract`/`useWaitForTransactionReceipt` to `useTxAction` — consistent tx lifecycle, proper signing/confirming states, error display
- [x] **F15** Write page context bug: fixed API response shape mismatch — page expected `{ chapter }` but API returns `{ ancestors }`. Parent chapter content now displays correctly
- [x] **B10** Chapters API: removed redundant `view_count` increment — the chapter detail endpoint was double-counting (once in chapters.ts, once when fetching novel for phase data)
- [x] **B11** Vote handlers: voter address now lowercased in `VoteCommitted`, `VoteRevealed`, `VotingRewardClaimed` — prevents case-sensitive lookup failures
- [x] **B12** NFT handler: `ON CONFLICT DO NOTHING` → `ON CONFLICT (token_id) DO NOTHING` — explicit conflict target

**Files modified:** `app/write/[novelId]/[parentId]/page.tsx`, `api/chapters.ts`, `indexer/handlers.ts`

---

### Iteration 6 — Backend API Audit ✅

**Changes made:**

- [x] **B13** Vote dedup: added `ON CONFLICT DO NOTHING` to `VoteCommitted` insert — prevents duplicate votes if events are reprocessed
- [x] **B14** Context API: replaced N+1 sequential queries with single recursive CTE — O(1) queries instead of O(depth)
- [x] **B15** Migration 006: added unique index on `votes(novel_id, voting_round_id, LOWER(voter))`, partial index for unrevealed votes, indexes for notification participation queries, notification recipient index
- [x] **B16** Fixed pre-existing TypeScript error in `validate.ts` — `req.params.address` type annotation

**Files modified/created:** `indexer/handlers.ts`, `api/chapters.ts`, `utils/validate.ts`, `migrations/006_vote_unique.sql` (new)

---

### Iteration 7 — End-to-End Flow Validation ✅

**Validated with local-node.sh:**

- [x] Novel creation → indexer picks up → genesis chapter content decoded from calldata
- [x] Chapter submission from 3 different accounts → meets `roundMinSubmissions`
- [x] `closeSubmissions` → phase correctly moves to Committing with proper unix timestamp
- [x] Vote commit from 2 voters → votes recorded with lowercased addresses
- [x] `closeCommit` → Revealing phase with correct timestamp
- [x] Vote reveal → both votes revealed and candidate IDs recorded
- [x] `settleRound` → world lines selected, vote counts updated
- [x] Notifications: phase changes, reveal reminders all correctly generated
- [x] Context API (recursive CTE) returns correct ancestor chain
- [x] Frontend SSR renders novel pages correctly

---

### Iteration 8 — Final Polish & Tests ✅

**Test Results:**

- Frontend (vitest): **27/27 passing**
- Solidity (forge): **62/62 passing**
- Backend (tsc): **0 errors**

### Remaining Items (future iterations)

- Notification polling should pause when browser tab is inactive
- Content upload endpoint (`content.ts`) has TODO stubs for External/HTTP modes
- Consider extracting metadata form (title/description/coverUri) shared between create and fork
