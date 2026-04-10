# Frontend Design

Next.js 16 + App Router. Data from backend REST API; on-chain writes via wallet (wagmi/viem).

## 1. Design Principles

- CSS variables define complete color system (light/dark via `data-theme` attribute), no hardcoded colors
- Semantic CSS classes in `globals.css`, no inline styles or excessive utility classes
- Shared components for repeated patterns (chapter cards, buttons, modals)
- Responsive: lg+ full N-column layout, md 2-column, sm single-column with tabs

## 2. Pages

```
/novels                           -> Novel list (paginated, sort, search)
/novels/[id]                      -> Novel home (N-column world line display + info bar)
/novels/[id]/read/[leafId]        -> Reading page (root -> leaf, paginated, centered serif layout)
/novels/[id]/chapter/[chapterId]  -> Chapter detail (content, tips, bounties, comments, vote/fork/continue)
/novels/[id]/tree                 -> Story tree (react-d3-tree, lazy loading, world line highlighting)
```

## 3. Key UX Flows

### Voting (Committing Phase)

User sees candidate list -> selects candidate -> auto-generates salt -> computes commitHash -> sends `commitVote` + `voteStake` -> submits plaintext to backend for keeper-assisted reveal -> saves salt to localStorage as backup.

Revealing is automatic via Keeper. Manual fallback available (read salt from localStorage -> send `revealVote`).

### Fork

Chapter page -> "Fork This Story" -> dialog (new novel title, config, root chapter content) -> calls `forkNovel` with this chapter as parent.

### Comments

EIP-191 signed, off-chain, append-only. No gas, no on-chain transaction.

## 4. Not Implemented (Frontend)

- Nominating UI (use CLI/MCP)
- Rule management / governance UI (use CLI; frontend only sets initial rules at novel creation)
- Novel completion UI (use CLI)
