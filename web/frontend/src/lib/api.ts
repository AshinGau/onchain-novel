export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export async function signedFetch(
  url: string,
  method: string,
  body: Record<string, unknown>,
  address: string,
  signMessageAsync: (args: { message: string }) => Promise<string>,
) {
  const bodyStr = JSON.stringify(body);
  const signature = await signMessageAsync({ message: bodyStr });
  return fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-address": address,
      "x-signature": signature,
    },
    body: bodyStr,
  });
}

export async function fetchApi<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// Type definitions for API responses
export interface Novel {
  id: string;
  creator: string;
  title: string;
  description: string;
  cover_uri: string;
  config: NovelConfig;
  current_round: number;
  current_epoch: number;
  round_phase: number;
  epoch_phase: number;
  phase_start_time: string;
  bootstrap_chapter_count: number;
  cumulative_canon_chapters: number;
  active: boolean;
  content_location: number;
  fork_source_novel_id: string | null;
  fork_source_chapter_id: string | null;
  pool_balance: string;
  total_tipped: string;
  total_funded: string;
  view_count: string;
  last_chapter_at: string | null;
  created_at: string;
  chapter_count?: string;
  author_count?: string;
}

export interface NovelConfig {
  minChapterLength: string;
  maxChapterLength: string;
  roundMinDuration: string;
  roundMinSubmissions: number;
  worldLineCount: number;
  roundsPerEpoch: number;
  prizeReleaseRate: number;
  voterRewardRate: number;
  commitDuration: string;
  revealDuration: string;
  stakeAmount: string;
  spamRounds: number;
  spamThreshold: number;
  contentLocation: number;
  contentBaseUrl: string;
  ruleFee: string;
  ruleVoteDuration: string;
  ruleQuorum: number;
}

export interface Chapter {
  id: string;
  novel_id: string;
  parent_id: string;
  author: string;
  content_hash: string;
  declared_length: string;
  round: number;
  epoch: number;
  chapter_index: number;
  vote_count: string;
  is_world_line: boolean;
  is_canon: boolean;
  content_text: string | null;
  content_fetched: boolean;
  created_at: string;
  novel_title?: string;
  config?: NovelConfig;
}

export interface TreeChapter {
  id: string;
  parent_id: string;
  author: string;
  chapter_index: number;
  round: number;
  epoch: number;
  vote_count: string;
  is_world_line: boolean;
  is_canon: boolean;
  created_at: string;
}

export const ROUND_PHASES = ["Submitting", "Committing", "Revealing", "Settling"] as const;
export const EPOCH_PHASES = ["Rounds", "Committing", "Revealing", "Settling"] as const;

