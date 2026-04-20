/**
 * Local-only reading progress & bookmarks.
 * All data lives in localStorage; no backend sync in v1.
 */

export interface Bookmark {
  novelId: string;
  leafId: string;
  depth: number;
  novelTitle: string;
  updatedAt: number; // ms epoch
}

const KEY_READ = "reading:read";
const KEY_BOOKMARKS = "reading:bookmarks";

/* ── Read chapters ── */

function loadReadSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(KEY_READ);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveReadSet(s: Set<string>): void {
  localStorage.setItem(KEY_READ, JSON.stringify([...s]));
}

export function markRead(chapterId: string): void {
  if (typeof window === "undefined") return;
  const s = loadReadSet();
  if (!s.has(chapterId)) {
    s.add(chapterId);
    saveReadSet(s);
  }
}

export function getReadSet(): Set<string> {
  return loadReadSet();
}

export function isRead(chapterId: string): boolean {
  return loadReadSet().has(chapterId);
}

/**
 * Given a root→leaf chain of chapter IDs, return the index of the last one
 * already in `readSet` — i.e. where the user should resume. No reads → 0
 * (start at root). Shared by:
 *   - /read page: picks the initial `depth` when resuming a storyline.
 *   - /tree page: picks the "from" endpoint when a node is clicked.
 *   - /novels/[id]: vote-candidate hover actions (Read + Visualize URLs).
 */
export function findResumeIndex(chainIds: readonly string[], readSet: Set<string>): number {
  for (let i = chainIds.length - 1; i >= 0; i--) {
    if (readSet.has(chainIds[i])) return i;
  }
  return 0;
}

/* ── Bookmarks ── */

function loadBookmarkList(): Bookmark[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY_BOOKMARKS);
    if (!raw) return [];
    return JSON.parse(raw) as Bookmark[];
  } catch {
    return [];
  }
}

function saveBookmarkList(list: Bookmark[]): void {
  localStorage.setItem(KEY_BOOKMARKS, JSON.stringify(list));
}

export function saveBookmark(b: Omit<Bookmark, "updatedAt">): void {
  if (typeof window === "undefined") return;
  const list = loadBookmarkList();
  const idx = list.findIndex((x) => x.leafId === b.leafId);
  const next: Bookmark = { ...b, updatedAt: Date.now() };
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  saveBookmarkList(list);
}

export function getBookmarks(): Bookmark[] {
  return loadBookmarkList().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteBookmark(leafId: string): void {
  if (typeof window === "undefined") return;
  const list = loadBookmarkList().filter((b) => b.leafId !== leafId);
  saveBookmarkList(list);
}

export function findBookmark(leafId: string): Bookmark | null {
  return loadBookmarkList().find((b) => b.leafId === leafId) ?? null;
}
