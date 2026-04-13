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
  ruleFee: string;
  ruleVoteDuration: number;
  ruleQuorum: number;
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
  timestamp: string;
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

export function fetchNovelTree(id: string, maxDepth?: number) {
  const params = maxDepth ? `?maxDepth=${maxDepth}` : "";
  return apiFetch<{ chapters: ChapterSummary[]; hasMore: boolean; maxDepth: number }>(`/novels/${id}/tree${params}`);
}

export function fetchWorldlines(id: string) {
  return apiFetch<{ worldlines: ChapterSummary[] }>(
    `/novels/${id}/worldlines`
  );
}

export function fetchRound(novelId: string, round: number) {
  return apiFetch<{ votes: RoundVote[]; candidates: RoundCandidate[] }>(
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

export interface RoundCandidate {
  chapter_id: string;
  position: number;
  author: string;
  depth: number;
  timestamp: string;
  parent_id: string;
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
  designated_chapter_id: number;
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

/* ============================================================
   Nicknames
   ============================================================ */

export function fetchNickname(address: string) {
  return apiFetch<{ nickname: string | null }>(`/users/${address}/nickname`);
}

export function fetchNicknamesBatch(addresses: string[]) {
  if (addresses.length === 0) return Promise.resolve({ nicknames: {} as Record<string, string> });
  return apiFetch<{ nicknames: Record<string, string> }>(
    `/users/nicknames/batch?addresses=${addresses.join(",")}`
  );
}

/* ============================================================
   User dashboard
   ============================================================ */

export interface UserChapter {
  id: string;
  novel_id: string;
  depth: number;
  timestamp: string;
  is_world_line: boolean;
  created_at: string;
  novel_title: string;
  comment_count: number;
  vote_count: number;
}

export interface UserVote {
  novel_id: string;
  round: number;
  voter: string;
  revealed: boolean;
  candidate_id: string | null;
  claimed: boolean;
  commit_block: string;
  novel_title: string;
  round_phase: number;
}

export interface RewardSummary {
  unclaimedVotes: { novel_id: string; round: number; novel_title: string }[];
  rewardClaims: { novel_id: string; source: string; amount: string; round: number | null; block_number: string; created_at: string; novel_title: string }[];
  participatedNovels: { novel_id: string; novel_title: string }[];
}

export function fetchUserChapters(address: string) {
  return apiFetch<{ chapters: UserChapter[] }>(`/users/${address}/chapters`);
}

export function fetchUserVotes(address: string, page = 1) {
  return apiFetch<{ votes: UserVote[]; total: number }>(`/users/${address}/votes?page=${page}`);
}

export function fetchUserRewards(address: string) {
  return apiFetch<RewardSummary>(`/users/${address}/rewards`);
}

/* ============================================================
   Comments (off-chain, EIP-191 signed)
   ============================================================ */

export interface Comment {
  id: number;
  chapter_id: string;
  author: string;
  content: string;
  created_at: string;
}

export function fetchComments(chapterId: string, page = 1, limit = 20) {
  return apiFetch<{ comments: Comment[] }>(
    `/chapters/${chapterId}/comments?page=${page}&limit=${limit}`
  );
}

/**
 * POST a signed comment. Returns the created comment row on success,
 * or { status, error } on failure (does NOT throw on 4xx).
 */
export async function postComment(
  chapterId: string,
  body: { address: string; content: string; timestamp: number; signature: string },
): Promise<{ ok: true; comment: Comment } | { ok: false; status: number; error: string }> {
  const res = await fetch(`${API_URL}/chapters/${chapterId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 201) {
    const comment = (await res.json()) as Comment;
    return { ok: true, comment };
  }
  const text = await res.text().catch(() => "");
  return { ok: false, status: res.status, error: text };
}

/* ============================================================
   Keeper-assisted reveal: submit plaintext vote
   ============================================================ */

export async function submitVotePlaintext(body: {
  address: string;
  novelId: number;
  round: number;
  candidateId: number;
  salt: `0x${string}`;
  timestamp: number;
  signature: string;
}): Promise<{ status: number; ok: boolean }> {
  const res = await fetch(`${API_URL}/votes/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, ok: res.status === 201 };
}
