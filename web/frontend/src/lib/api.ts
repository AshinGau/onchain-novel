/**
 * Frontend REST client — thin adapter around @onchain-novel/shared/api.
 *
 * Browser code uses a relative "/api" base (Next.js rewrite proxies to the
 * backend, same-origin, no CORS). Server components (SSR / RSC) use an
 * absolute URL because Node's fetch requires one; BACKEND_URL is baked in by
 * next.config.ts at build time from config.yaml's frontend.backendUrl.
 */

import { createApiClient } from "@onchain-novel/shared/api";

const isServer = typeof window === "undefined";
const baseUrl = isServer ? (process.env.BACKEND_URL as string) : "";

const api = createApiClient({ baseUrl });

// Re-export DTO types so consumers keep importing from "@/lib/api".
export type {
  Bounty,
  ChapterContext,
  ChapterDetail,
  ChapterSummary,
  Comment,
  LineMode,
  Novel,
  NovelConfig,
  NovelLine,
  Pagination,
  RewardSummary,
  RoundCandidate,
  RoundVote,
  Tip,
  UserChapter,
  UserVote,
} from "@onchain-novel/shared/api";

// Function-style exports (previous surface). Forwarded onto the client
// instance so existing call sites compile unchanged.
export const fetchNovels = api.fetchNovels.bind(api);
export const fetchNovel = api.fetchNovel.bind(api);
export const fetchNovelTree = api.fetchNovelTree.bind(api);
export const fetchWorldlines = api.fetchWorldlines.bind(api);
export const fetchNovelLines = api.fetchNovelLines.bind(api);
export const fetchRound = api.fetchRound.bind(api);
export const fetchChapter = api.fetchChapter.bind(api);
export const fetchChapterContext = api.fetchChapterContext.bind(api);
export const fetchChapterChildren = api.fetchChapterChildren.bind(api);
export const fetchChapterBounties = api.fetchChapterBounties.bind(api);
export const fetchChapterTips = api.fetchChapterTips.bind(api);
export const fetchComments = api.fetchComments.bind(api);
export const fetchNickname = api.fetchNickname.bind(api);
export const fetchNicknamesBatch = api.fetchNicknamesBatch.bind(api);
export const fetchUserChapters = api.fetchUserChapters.bind(api);
export const fetchUserVotes = api.fetchUserVotes.bind(api);
export const fetchUserRewards = api.fetchUserRewards.bind(api);
export const postComment = api.postComment.bind(api);
export const submitVotePlaintext = api.submitVotePlaintext.bind(api);
