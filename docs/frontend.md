# Frontend Design

Next.js 16 + App Router. Data from backend REST API; on-chain writes via wallet (wagmi/viem).

## 0. Code Standards

### 0.1 Module Reuse

- Same UI patterns must be extracted into components; no copy-paste
- Example: chapter cards use the same `<ChapterCard>` in lists, trees, and search results
- Base elements (buttons, inputs, modals, toasts) are unified under `components/ui/`

### 0.2 Color Scheme

CSS variables define a complete color system; no hardcoded colors in components:

```css
:root {
  --color-primary: #6366f1;       /* indigo-500 */
  --color-primary-hover: #4f46e5; /* indigo-600 */
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;
  --color-bg: #ffffff;
  --color-bg-secondary: #f9fafb;
  --color-bg-tertiary: #f3f4f6;
  --color-text: #111827;
  --color-text-secondary: #6b7280;
  --color-text-muted: #9ca3af;
  --color-border: #e5e7eb;
  --color-worldline-1: #6366f1;
  --color-worldline-2: #8b5cf6;
  --color-worldline-3: #ec4899;
  --color-worldline-4: #f59e0b;
  --color-worldline-5: #10b981;
}

[data-theme="dark"] {
  --color-bg: #0f172a;
  --color-bg-secondary: #1e293b;
  --color-bg-tertiary: #334155;
  --color-text: #f1f5f9;
  --color-text-secondary: #94a3b8;
  --color-text-muted: #64748b;
  --color-border: #334155;
}
```

All components reference `var(--color-xxx)`, never raw `#xxx` or `rgb()`.

### 0.3 CSS Style Standards

**No inline styles or excessive utility classes on HTML elements.** Use semantic CSS classes:

```css
/* globals.css -- predefined semantic classes */

/* Layout */
.container { max-width: 1200px; margin: 0 auto; padding: 0 1rem; }
.stack { display: flex; flex-direction: column; gap: 1rem; }
.row { display: flex; align-items: center; gap: 0.5rem; }

/* Typography */
.text-heading { font-size: 1.5rem; font-weight: 700; color: var(--color-text); }
.text-body { font-size: 1rem; line-height: 1.75; color: var(--color-text); }
.text-caption { font-size: 0.875rem; color: var(--color-text-secondary); }

/* Cards */
.card { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 0.75rem; padding: 1.25rem; }

/* Reading typography */
.prose { max-width: 680px; margin: 0 auto; font-family: Georgia, 'Noto Serif', serif; line-height: 1.9; }
```

### 0.4 Theme Switching

- `data-theme` attribute on `<html>`
- All colors via CSS variables; switching theme = changing `data-theme="dark"`
- Persisted to localStorage; defaults to system `prefers-color-scheme`

### 0.5 Responsive Layout

Breakpoints: sm(640px), md(768px), lg(1024px), xl(1280px).

Key adaptations:
- **Novel home N columns**: `lg+` shows N columns side-by-side; `md` shows 2; `sm-` tab-switches single column
- **Reading page**: centered single column at all sizes, max-width 680px
- **Story tree**: `sm-` suggests desktop viewing, still allows zoom
- **Navbar**: `sm-` collapses to hamburger menu

---

## 1. Page Structure

```
/novels                         -> Novel list
/novels/[id]                    -> Novel home (N-column chain display + info)
/novels/[id]/read/[leafId]      -> Reading page (root -> leaf paginated reading)
/novels/[id]/chapter/[chapterId]-> Chapter page (single chapter detail + navigation)
/novels/[id]/tree               -> Story tree (BFS tree visualization)
```

## 2. Novel List `/novels`

- Paginated list, 10-20 per page
- Sort: latest / most active (chapter count) / largest pool
- Search: by title
- Each card: title, creator, chapter count, world line count, pool balance, current round/phase
- Click -> novel home

## 3. Novel Home `/novels/[id]`

### 3.1 Top Info Bar

```
Novel Title
Creator: 0x1234...  |  Round 3 - Idle  |  Pool: 1.5 ETH  |  N=3 world lines
[Continue] [Vote] [Tip] [Rules] [Fork]
```

- Vote button: only during Committing/Revealing phases
- Continue button: always available
- Frontend does not expose Nominating operations (reserved for CLI/MCP users)

### 3.2 N-Column Chain Display

Each world line gets one column showing the chain from root to its deepest descendant. Middle sections collapse showing chapter count; click to expand.

Mobile: N columns become tab-switched single column.

### 3.3 Other Branches

Non-longest branches from worldLineAncestor descendants shown as collapsible list below the main chain.

## 4. Reading Page `/novels/[id]/read/[leafId]`

- Full story line from root to leafId, paginated
- Data: `GET /api/chapters/:leafId/context`
- Navigation: prev/next chapter (keyboard arrows or swipe)
- Progress bar at top
- "Continue this story line" button at the end
- Centered layout, max-width 680px, serif font

## 5. Chapter Page `/novels/[id]/chapter/[chapterId]`

- Navigation: Previous (parent) | Continue (descendants list) | Story Tree
- Full content, author, depth, timestamp
- Tips/bounties count
- [Tip] [Create Bounty] [Continue] buttons
- If current chapter is a round candidate: [Vote for This] button
- Vote flow: enter salt -> commit (stake voteStake) -> wait for reveal phase -> reveal
- Salt stored in localStorage

## 6. Story Tree `/novels/[id]/tree`

- BFS tree visualization using **react-d3-tree**
- Lazy loading: initial `maxLoadDepth` layers, click to load more
- Custom node style: chapterId, author, depth, first-line preview, world line badge
- World line nodes highlighted
- Interactions: click -> chapter page, double-click -> expand/collapse, right-click -> read/continue/vote

## 7. Wallet Integration

- wagmi + viem
- Connect wallet button in top navbar
- Write operations (continue, vote, tip, bounty) require wallet
- Read operations do not require wallet
- Refresh page data after transaction confirmation

## 8. Voting Flow (Frontend)

Frontend handles only Committing and Revealing phases, not Nominating.

**Committing**: user sees candidate list -> selects candidate -> enters salt (or auto-generates) -> computes commitHash = keccak256(encodePacked(uint64(candidateId), bytes32(salt))) -> sends commitVote + voteStake -> saves salt + candidateId to localStorage.

**Revealing**: reads salt + candidateId from localStorage -> sends revealVote -> shows "revealed, awaiting settlement."

## 9. Data Flow

| Page | Data Source |
|------|------------|
| Novel list | `GET /api/novels` |
| Novel home | `GET /api/novels/:id` + `/worldlines` + `/tree` |
| Reading page | `GET /api/chapters/:id/context` |
| Chapter page | `GET /api/chapters/:id` + `/children` + `/bounties` + `/tips` |
| Story tree | `GET /api/novels/:id/tree` |
| Vote candidates | `GET /api/novels/:id/rounds/:round` |
| User info | `GET /api/users/:address/chapters` + `/votes` + `/rewards` |

## 10. Not Implemented (Frontend)

- Nominating UI (use CLI/MCP)
- Comment system (backend API preserved, frontend deferred)
- User profile page
- Fork creation UI (use CLI)
- Rule management UI (use CLI)
- Novel completion UI (use CLI)

## 11. Component Structure

```
web/frontend/src/
  app/
    layout.tsx                    # Global layout (navbar, wallet connect)
    page.tsx                      # Home -> redirect /novels
    novels/
      page.tsx                    # Novel list
      [id]/
        page.tsx                  # Novel home (N-column chain display)
        read/[leafId]/page.tsx    # Reading page
        chapter/[chapterId]/page.tsx # Chapter page
        tree/page.tsx             # Story tree
  components/
    novel-card.tsx                # Novel list card
    novel-info.tsx                # Novel info bar
    chain-column.tsx              # World line column
    chapter-card-mini.tsx         # Chapter card (compact)
    chapter-reader.tsx            # Reader (pagination)
    chapter-editor.tsx            # Continuation editor
    collapsed-chapters.tsx        # Collapsed chapter range
    vote-panel.tsx                # Vote panel (commit/reveal)
    story-tree.tsx                # react-d3-tree wrapper
    nav-bar.tsx                   # Navigation bar
    providers.tsx                 # App providers (wallet, theme)
    ui/                           # Base UI components
  lib/
    api.ts                        # Backend API client
    contracts.ts                  # Contract interaction (wagmi hooks)
    vote-storage.ts               # localStorage salt storage
    config.ts                     # Contract addresses, chain config
    format.ts                     # Formatting utilities
    utils.ts                      # General utilities
    wagmi-config.ts               # Wagmi chain/transport config
  hooks/
    use-novel.ts                  # Novel data hook
    use-chapter.ts                # Chapter data hook
    use-tx-action.ts              # Transaction send + wait for confirmation
```
