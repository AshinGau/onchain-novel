/**
 * Typed REST client for the backend. Works against both absolute URLs
 * (SSR / Node) and relative paths like "/api" (browser via Next.js
 * reverse proxy — same-origin, no CORS).
 *
 * Construct once per caller with `createApiClient(baseUrl)`.
 */

import type {
  Bounty,
  ChapterContext,
  ChapterDetail,
  ChapterSummary,
  Comment,
  LineMode,
  Novel,
  NovelLine,
  Pagination,
  RewardSummary,
  RoundCandidate,
  RoundVote,
  Tip,
  UserChapter,
  UserVote,
} from "./types.js";

export interface ApiClient {
  fetchNovels(params: {
    page?: number;
    limit?: number;
    sort?: string;
    filter?: string;
    search?: string;
  }): Promise<{ novels: Novel[]; pagination: Pagination }>;
  fetchNovel(id: string | number | bigint): Promise<Novel>;
  fetchNovelTree(
    id: string | number | bigint,
    maxDepth?: number,
  ): Promise<{ chapters: ChapterSummary[]; hasMore: boolean; maxDepth: number }>;
  fetchWorldlines(id: string | number | bigint): Promise<{ worldlines: ChapterSummary[] }>;
  fetchNovelLines(
    id: string | number | bigint,
    mode?: LineMode,
    limit?: number,
  ): Promise<{ mode: LineMode; lines: NovelLine[] }>;
  fetchRound(
    novelId: string | number | bigint,
    round: number,
  ): Promise<{ votes: RoundVote[]; candidates: RoundCandidate[] }>;
  fetchChapter(id: string | number | bigint): Promise<ChapterDetail>;
  fetchChapterContext(
    id: string | number | bigint,
  ): Promise<{ ancestors: ChapterContext[] }>;
  fetchChapterChildren(
    id: string | number | bigint,
  ): Promise<{ children: ChapterSummary[] }>;
  fetchChapterBounties(id: string | number | bigint): Promise<{ bounties: Bounty[] }>;
  fetchChapterTips(id: string | number | bigint): Promise<{ tips: Tip[] }>;
  fetchComments(
    chapterId: string | number | bigint,
    page?: number,
    limit?: number,
  ): Promise<{ comments: Comment[] }>;
  fetchNickname(address: string): Promise<{ nickname: string | null }>;
  fetchNicknamesBatch(
    addresses: string[],
  ): Promise<{ nicknames: Record<string, string> }>;
  fetchUserChapters(address: string): Promise<{ chapters: UserChapter[] }>;
  fetchUserVotes(
    address: string,
    page?: number,
  ): Promise<{ votes: UserVote[]; total: number }>;
  fetchUserRewards(address: string): Promise<RewardSummary>;
  postComment(
    chapterId: string | number | bigint,
    body: { address: string; content: string; timestamp: number; signature: string },
  ): Promise<PostResult<Comment>>;
  submitVotePlaintext(body: {
    address: string;
    novelId: number;
    round: number;
    candidateId: number;
    salt: `0x${string}`;
    timestamp: number;
    signature: string;
  }): Promise<{ status: number; ok: boolean }>;
  /** Raw GET for callers that need a one-off path not covered above. */
  get<T = unknown>(path: string): Promise<T>;
  /** Raw POST with JSON body, returns status + parsed body (does NOT throw on 4xx/5xx). */
  post<T = unknown>(path: string, body: unknown): Promise<{ status: number; body: T | null }>;
}

export type PostResult<T> =
  | { ok: true; comment: T }
  | { ok: false; status: number; error: string };

export interface ApiClientOptions {
  /**
   * Base URL — may be absolute (e.g. "http://127.0.0.1:3001") or a path-only
   * prefix like "/api" (same-origin via Next.js rewrite). The string "/api"
   * should NOT be included in the base; it's appended internally.
   */
  baseUrl: string;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const base = options.baseUrl.replace(/\/+$/, "");
  // If the caller passed the API root (e.g. "/api" or "http://.../api"), strip
  // the trailing "/api" so we can prepend it ourselves. Callers historically
  // passed URLs with or without /api; we normalize here.
  const root = base.endsWith("/api") ? base : `${base}/api`;

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${root}${path}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T | null }> {
    const res = await fetch(`${root}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let parsed: T | null = null;
    try {
      parsed = (await res.json()) as T;
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed };
  }

  return {
    get,
    post,

    fetchNovels(params) {
      const sp = new URLSearchParams();
      if (params.page) sp.set("page", String(params.page));
      if (params.limit) sp.set("limit", String(params.limit));
      if (params.sort) sp.set("sort", params.sort);
      if (params.filter) sp.set("filter", params.filter);
      if (params.search) sp.set("search", params.search);
      return get(`/novels?${sp.toString()}`);
    },
    fetchNovel(id) {
      return get(`/novels/${id}`);
    },
    fetchNovelTree(id, maxDepth) {
      const q = maxDepth ? `?maxDepth=${maxDepth}` : "";
      return get(`/novels/${id}/tree${q}`);
    },
    fetchWorldlines(id) {
      return get(`/novels/${id}/worldlines`);
    },
    fetchNovelLines(id, mode = "longest", limit) {
      const sp = new URLSearchParams({ mode });
      if (limit) sp.set("limit", String(limit));
      return get(`/novels/${id}/lines?${sp.toString()}`);
    },
    fetchRound(novelId, round) {
      return get(`/novels/${novelId}/rounds/${round}`);
    },
    fetchChapter(id) {
      return get(`/chapters/${id}`);
    },
    fetchChapterContext(id) {
      return get(`/chapters/${id}/context`);
    },
    fetchChapterChildren(id) {
      return get(`/chapters/${id}/children`);
    },
    fetchChapterBounties(id) {
      return get(`/chapters/${id}/bounties`);
    },
    fetchChapterTips(id) {
      return get(`/chapters/${id}/tips`);
    },
    fetchComments(chapterId, page = 1, limit = 20) {
      return get(`/chapters/${chapterId}/comments?page=${page}&limit=${limit}`);
    },
    fetchNickname(address) {
      return get(`/users/${address}/nickname`);
    },
    fetchNicknamesBatch(addresses) {
      if (addresses.length === 0) {
        return Promise.resolve({ nicknames: {} as Record<string, string> });
      }
      return get(`/users/nicknames/batch?addresses=${addresses.join(",")}`);
    },
    fetchUserChapters(address) {
      return get(`/users/${address}/chapters`);
    },
    fetchUserVotes(address, page = 1) {
      return get(`/users/${address}/votes?page=${page}`);
    },
    fetchUserRewards(address) {
      return get(`/users/${address}/rewards`);
    },
    async postComment(chapterId, body) {
      const r = await post<Comment>(`/chapters/${chapterId}/comments`, body);
      if (r.status === 201 && r.body) return { ok: true, comment: r.body };
      return {
        ok: false,
        status: r.status,
        error: r.body ? JSON.stringify(r.body) : "",
      };
    },
    async submitVotePlaintext(body) {
      const r = await post(`/votes/submit`, body);
      return { status: r.status, ok: r.status === 201 };
    },
  };
}
