## Web QA Plan: Scan → Test → Fix → Optimize

Three full iterations. Status: **All three iterations completed.**

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

### Test Results

- Frontend (vitest): **27/27 passing**
- Solidity (forge): **62/62 passing**

### Remaining Items (future iterations)

- Notification polling should pause when browser tab is inactive
- Write page byte validation could run on submit in addition to blur
- Content upload endpoint (`content.ts`) has TODO stubs for External/HTTP modes
- Consider extracting metadata form (title/description/coverUri) shared between create and fork
