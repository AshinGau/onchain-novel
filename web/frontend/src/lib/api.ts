import { API_URL } from "./config";

/* ============================================================
   Generic fetch wrapper
   ============================================================ */

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/* ============================================================
   Type definitions (matching backend response shapes)
   ============================================================ */

export interface Novel {
  id: string;
  creator: string;
  title: string;
  description: string;
  cover_uri: string;
  config: NovelConfig;
  current_round: number;
  round_phase: number;
  phase_start_time: string;
  last_settle_time: string;
  active: boolean;
  pool_balance: string;
  total_tipped: string;
  total_funded: string;
  view_count: string;
  last_chapter_at: string;
  created_at: string;
  chapter_count: number;
  author_count: number;
}

export interface NovelConfig {
  minChapterLength: number;
  maxChapterLength: number;
  submissionFee: string;
  worldLineCount: number;
  voteStake: string;
  nominationFee: string;
  nominateDuration: number;
  commitDuration: number;
  revealDuration: number;
  minRoundGap: number;
  prizeReleaseRate: number;
  voterRewardRate: number;
  contentLocation: number;
  contentBaseUrl: string;
}

export interface ChapterSummary {
  id: string;
  parent_id: string;
  author: string;
  depth: number;
  timestamp: string;
  is_world_line: boolean;
  declared_length: number;
  content_hash: string;
  created_at: string;
}

export interface ChapterDetail extends ChapterSummary {
  novel_id: string;
  novel_title: string;
  config: NovelConfig;
  content_text: string | null;
  content_fetched: boolean;
}

export interface ChapterContext {
  id: string;
  parent_id: string;
  author: string;
  depth: number;
  content_text: string | null;
  content_fetched: boolean;
  is_world_line: boolean;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/* ============================================================
   API functions
   ============================================================ */

export function fetchNovels(params: {
  page?: number;
  limit?: number;
  sort?: string;
  filter?: string;
  search?: string;
}) {
  const sp = new URLSearchParams();
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.sort) sp.set("sort", params.sort);
  if (params.filter) sp.set("filter", params.filter);
  if (params.search) sp.set("search", params.search);
  return apiFetch<{ novels: Novel[]; pagination: Pagination }>(
    `/novels?${sp.toString()}`
  );
}

export function fetchNovel(id: string) {
  return apiFetch<Novel>(`/novels/${id}`);
}

export function fetchNovelTree(id: string) {
  return apiFetch<{ chapters: ChapterSummary[] }>(`/novels/${id}/tree`);
}

export function fetchWorldlines(id: string) {
  return apiFetch<{ worldlines: ChapterSummary[] }>(
    `/novels/${id}/worldlines`
  );
}

export function fetchRound(novelId: string, round: number) {
  return apiFetch<{ votes: RoundVote[] }>(
    `/novels/${novelId}/rounds/${round}`
  );
}

export interface RoundVote {
  voter: string;
  revealed: boolean;
  candidate_id: string | null;
  claimed: boolean;
  commit_block: string;
  reveal_block: string | null;
}

export function fetchChapter(id: string) {
  return apiFetch<ChapterDetail>(`/chapters/${id}`);
}

export function fetchChapterContext(id: string) {
  return apiFetch<{ ancestors: ChapterContext[] }>(`/chapters/${id}/context`);
}

export function fetchChapterChildren(id: string) {
  return apiFetch<{ children: ChapterSummary[] }>(`/chapters/${id}/children`);
}

export function fetchChapterBounties(id: string) {
  return apiFetch<{ bounties: Bounty[] }>(`/chapters/${id}/bounties`);
}

export function fetchChapterTips(id: string) {
  return apiFetch<{ tips: Tip[] }>(`/chapters/${id}/tips`);
}

export interface Bounty {
  id: string;
  chapter_id: string;
  novel_id: string;
  tipper: string;
  locked_amount: string;
  deadline: string;
  claimed: boolean;
  refunded: boolean;
  block_number: string;
}

export interface Tip {
  id: string;
  chapter_id: string;
  tipper: string;
  amount: string;
  block_number: string;
}
