/**
 * REST API DTO types — the contract between backend responses and every
 * client (frontend, CLI, agents). Backend route handlers should shape their
 * JSON responses to match these; clients rely on them for compile-time
 * safety.
 *
 * BigInt-valued chain data is serialized as decimal strings in JSON.
 */

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

export type LineMode = "canon" | "longest" | "active" | "funded";

export interface NovelLine {
  leafId: string;
  ancestorId: string;
  chain: ChapterSummary[];
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

export interface Bounty {
  id: string;
  chapter_id: string;
  novel_id: string;
  tipper: string;
  locked_amount: string;
  create_time: string;
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

export interface Comment {
  id: number;
  chapter_id: string;
  author: string;
  content: string;
  created_at: string;
}

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
  rewardClaims: {
    novel_id: string;
    source: string;
    amount: string;
    round: number | null;
    block_number: string;
    created_at: string;
    novel_title: string;
  }[];
  participatedNovels: { novel_id: string; novel_title: string }[];
}
