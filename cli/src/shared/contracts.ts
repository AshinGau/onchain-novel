import {
  type PublicClient,
  type WalletClient,
  type Hash,
  encodePacked,
  keccak256,
  toHex,
} from "viem";
import {
  novelCoreAbi,
  roundManagerAbi,
  prizePoolAbi,
  bountyBoardAbi,
  rulesEngineAbi,
  userRegistryAbi,
} from "./abi.js";

// ============================================================
// Types
// ============================================================

export interface NovelConfig {
  minChapterLength: bigint;
  maxChapterLength: bigint;
  submissionFee: bigint;
  worldLineCount: number;
  voteStake: bigint;
  nominationFee: bigint;
  nominateDuration: bigint;
  commitDuration: bigint;
  revealDuration: bigint;
  minRoundGap: bigint;
  prizeReleaseRate: number;
  voterRewardRate: number;
  contentLocation: number;
  contentBaseUrl: string;
  ruleFee: bigint;
  ruleVoteDuration: bigint;
  ruleQuorum: number;
}

export interface NovelMetadata {
  title: string;
  description: string;
  coverUri: string;
}

export interface ContentSubmission {
  contentHash: `0x${string}`;
  declaredLength: bigint;
  content: `0x${string}`;
}

export interface CreateNovelParams {
  config: NovelConfig;
  metadata: NovelMetadata;
  rootChapter: ContentSubmission;
  value?: bigint;
  novelCore: `0x${string}`;
}

export interface SubmitChapterParams {
  novelId: bigint;
  parentId: bigint;
  submission: ContentSubmission;
  value?: bigint;
  novelCore: `0x${string}`;
}

export interface CommitVoteParams {
  novelId: bigint;
  commitHash: `0x${string}`;
  value?: bigint;
  roundManager: `0x${string}`;
}

export interface RevealVoteParams {
  novelId: bigint;
  candidateId: bigint;
  salt: `0x${string}`;
  roundManager: `0x${string}`;
}

export interface NominateCandidateParams {
  novelId: bigint;
  chapterId: bigint;
  value?: bigint;
  roundManager: `0x${string}`;
}

export interface TipParams {
  id: bigint;
  value: bigint;
  prizePool: `0x${string}`;
}

export interface ForkNovelParams {
  sourceChapterId: bigint;
  config: NovelConfig;
  metadata: NovelMetadata;
  rootChapter: ContentSubmission;
  value?: bigint;
  novelCore: `0x${string}`;
}

export interface CreateBountyParams {
  chapterId: bigint;
  deadline: bigint;
  value: bigint;
  bountyBoard: `0x${string}`;
}

export interface ProposeRuleParams {
  novelId: bigint;
  proposalType: number; // 0 = Add, 1 = Delete
  ruleName: string;
  ruleContent: string;
  /** Caller-authored chapter used as eligibility credential (must be on a current world line). */
  chapterId: bigint;
  /** Path proof: [worldLineAncestor, ..., chapterId] via parentId chain. */
  path: bigint[];
  value?: bigint;
  rulesEngine: `0x${string}`;
}

export interface VoteOnRuleProposalParams {
  proposalId: bigint;
  /** Voter-authored chapter used as eligibility credential. */
  chapterId: bigint;
  /** Path proof: [worldLineAncestor, ..., chapterId] via parentId chain. */
  path: bigint[];
  rulesEngine: `0x${string}`;
}

export interface SetCreatorRulesParams {
  novelId: bigint;
  names: string[];
  contents: string[];
  rulesEngine: `0x${string}`;
}

// ============================================================
// Helpers
// ============================================================

/** Compute vote commit hash: keccak256(abi.encodePacked(uint64(candidateId), bytes32(salt))) */
export function computeCommitHash(candidateId: bigint, salt: `0x${string}`): `0x${string}` {
  return keccak256(encodePacked(["uint64", "bytes32"], [candidateId, salt]));
}

/** Convert a user-friendly salt string to bytes32 */
export function toBytes32Salt(salt: string): `0x${string}` {
  const bytes = new TextEncoder().encode(salt);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return ("0x" + hex.padEnd(64, "0")) as `0x${string}`;
}

/**
 * Build a world-line proof path from a chapter to one of the current worldLineAncestors.
 *
 * Returns `[ancestorId, ..., chapterId]` (parent chain, ancestor at head). Returns `null`
 * if the chapter is not on any current world line. Used to prove eligibility for
 * RulesEngine.proposeRule / voteOnRuleProposal.
 *
 * This is a read-only off-chain computation (one EXTCALL per chapter on the path).
 */
export async function buildWorldLineProof(
  client: PublicClient,
  novelCore: `0x${string}`,
  novelId: bigint,
  chapterId: bigint,
): Promise<bigint[] | null> {
  const ancestors = (await client.readContract({
    address: novelCore,
    abi: novelCoreAbi,
    functionName: "getWorldLineAncestors",
    args: [novelId],
  })) as readonly bigint[];

  for (const ancestor of ancestors) {
    const path: bigint[] = [];
    let cur = ancestor;
    // Walk parent chain from ancestor toward root
    while (cur !== 0n) {
      path.push(cur);
      if (cur === chapterId) return path;
      const ch = (await client.readContract({
        address: novelCore,
        abi: novelCoreAbi,
        functionName: "getChapter",
        args: [cur],
      })) as { parentId: bigint; depth: number };
      if (ch.depth <= 1) break;
      cur = ch.parentId;
    }
  }
  return null;
}

/** Build a ContentSubmission from text content */
export function buildContentSubmission(content: string): ContentSubmission {
  const encoded = new TextEncoder().encode(content);
  const contentBytes = toHex(encoded);
  const contentHash = keccak256(contentBytes);
  return {
    contentHash,
    declaredLength: BigInt(encoded.length),
    content: contentBytes,
  };
}

// ============================================================
// NovelCore writes
// ============================================================

export async function createNovel(client: WalletClient, params: CreateNovelParams): Promise<Hash> {
  return client.writeContract({
    address: params.novelCore,
    abi: novelCoreAbi,
    functionName: "createNovel",
    args: [params.config, params.metadata, params.rootChapter],
    value: params.value ?? 0n,
    chain: client.chain,
    account: client.account!,
  });
}

export async function submitChapter(client: WalletClient, params: SubmitChapterParams): Promise<Hash> {
  return client.writeContract({
    address: params.novelCore,
    abi: novelCoreAbi,
    functionName: "submitChapter",
    args: [params.novelId, params.parentId, params.submission],
    value: params.value ?? 0n,
    chain: client.chain,
    account: client.account!,
  });
}

export async function forkNovel(client: WalletClient, params: ForkNovelParams): Promise<Hash> {
  return client.writeContract({
    address: params.novelCore,
    abi: novelCoreAbi,
    functionName: "forkNovel",
    args: [params.sourceChapterId, params.config, params.metadata, params.rootChapter],
    value: params.value ?? 0n,
    chain: client.chain,
    account: client.account!,
  });
}

export async function claimReward(client: WalletClient, novelId: bigint, novelCore: `0x${string}`): Promise<Hash> {
  return client.writeContract({
    address: novelCore,
    abi: novelCoreAbi,
    functionName: "claimReward",
    args: [novelId],
    chain: client.chain,
    account: client.account!,
  });
}

// ============================================================
// RoundManager writes
// ============================================================

export async function commitVote(client: WalletClient, params: CommitVoteParams): Promise<Hash> {
  return client.writeContract({
    address: params.roundManager,
    abi: roundManagerAbi,
    functionName: "commitVote",
    args: [params.novelId, params.commitHash],
    value: params.value ?? 0n,
    chain: client.chain,
    account: client.account!,
  });
}

export async function revealVote(client: WalletClient, params: RevealVoteParams): Promise<Hash> {
  return client.writeContract({
    address: params.roundManager,
    abi: roundManagerAbi,
    functionName: "revealVote",
    args: [params.novelId, params.candidateId, params.salt],
    chain: client.chain,
    account: client.account!,
  });
}

export async function startRound(client: WalletClient, novelId: bigint, roundManager: `0x${string}`): Promise<Hash> {
  return client.writeContract({
    address: roundManager,
    abi: roundManagerAbi,
    functionName: "startRound",
    args: [novelId],
    chain: client.chain,
    account: client.account!,
  });
}

export async function closeNomination(
  client: WalletClient,
  novelId: bigint,
  roundManager: `0x${string}`,
): Promise<Hash> {
  return client.writeContract({
    address: roundManager,
    abi: roundManagerAbi,
    functionName: "closeNomination",
    args: [novelId],
    chain: client.chain,
    account: client.account!,
  });
}

export async function closeCommit(client: WalletClient, novelId: bigint, roundManager: `0x${string}`): Promise<Hash> {
  return client.writeContract({
    address: roundManager,
    abi: roundManagerAbi,
    functionName: "closeCommit",
    args: [novelId],
    chain: client.chain,
    account: client.account!,
  });
}

export async function settleRound(client: WalletClient, novelId: bigint, roundManager: `0x${string}`): Promise<Hash> {
  return client.writeContract({
    address: roundManager,
    abi: roundManagerAbi,
    functionName: "settleRound",
    args: [novelId],
    chain: client.chain,
    account: client.account!,
  });
}

export async function nominateCandidate(client: WalletClient, params: NominateCandidateParams): Promise<Hash> {
  return client.writeContract({
    address: params.roundManager,
    abi: roundManagerAbi,
    functionName: "nominateCandidate",
    args: [params.novelId, params.chapterId],
    value: params.value ?? 0n,
    chain: client.chain,
    account: client.account!,
  });
}

export async function claimVotingReward(
  client: WalletClient,
  novelId: bigint,
  round: number,
  roundManager: `0x${string}`,
): Promise<Hash> {
  return client.writeContract({
    address: roundManager,
    abi: roundManagerAbi,
    functionName: "claimVotingReward",
    args: [novelId, round],
    chain: client.chain,
    account: client.account!,
  });
}

export async function completeNovel(
  client: WalletClient,
  novelId: bigint,
  roundManager: `0x${string}`,
): Promise<Hash> {
  return client.writeContract({
    address: roundManager,
    abi: roundManagerAbi,
    functionName: "completeNovel",
    args: [novelId],
    chain: client.chain,
    account: client.account!,
  });
}

// ============================================================
// PrizePool writes (tipping)
// ============================================================

export async function tipNovel(client: WalletClient, params: TipParams): Promise<Hash> {
  return client.writeContract({
    address: params.prizePool,
    abi: prizePoolAbi,
    functionName: "tipNovel",
    args: [params.id],
    value: params.value,
    chain: client.chain,
    account: client.account!,
  });
}

export async function tipChapter(client: WalletClient, params: TipParams): Promise<Hash> {
  return client.writeContract({
    address: params.prizePool,
    abi: prizePoolAbi,
    functionName: "tipChapter",
    args: [params.id],
    value: params.value,
    chain: client.chain,
    account: client.account!,
  });
}

// ============================================================
// UserRegistry writes
// ============================================================

export async function setNickname(
  client: WalletClient,
  nickname: `0x${string}`,
  userRegistry: `0x${string}`,
): Promise<Hash> {
  return client.writeContract({
    address: userRegistry,
    abi: userRegistryAbi,
    functionName: "setNickname",
    args: [nickname],
    chain: client.chain,
    account: client.account!,
  });
}

// ============================================================
// BountyBoard / RulesEngine writes
// ============================================================

export async function createBounty(client: WalletClient, params: CreateBountyParams): Promise<Hash> {
  return client.writeContract({
    address: params.bountyBoard,
    abi: bountyBoardAbi,
    functionName: "createBounty",
    args: [params.chapterId, params.deadline],
    value: params.value,
    chain: client.chain,
    account: client.account!,
  });
}

export interface DesignateBountyParams {
  bountyId: bigint;
  chapterId: bigint;
  bountyBoard: `0x${string}`;
}

export async function designateBounty(client: WalletClient, params: DesignateBountyParams): Promise<Hash> {
  return client.writeContract({
    address: params.bountyBoard,
    abi: bountyBoardAbi,
    functionName: "designateBounty",
    args: [params.bountyId, params.chapterId],
    chain: client.chain,
    account: client.account!,
  });
}

export async function claimBounty(client: WalletClient, bountyId: bigint, bountyBoard: `0x${string}`): Promise<Hash> {
  return client.writeContract({
    address: bountyBoard,
    abi: bountyBoardAbi,
    functionName: "claimBounty",
    args: [bountyId],
    chain: client.chain,
    account: client.account!,
  });
}

export async function refundBounty(
  client: WalletClient,
  bountyId: bigint,
  bountyBoard: `0x${string}`,
): Promise<Hash> {
  return client.writeContract({
    address: bountyBoard,
    abi: bountyBoardAbi,
    functionName: "refundBounty",
    args: [bountyId],
    chain: client.chain,
    account: client.account!,
  });
}

export async function setCreatorRules(client: WalletClient, params: SetCreatorRulesParams): Promise<Hash> {
  return client.writeContract({
    address: params.rulesEngine,
    abi: rulesEngineAbi,
    functionName: "setCreatorRules",
    args: [params.novelId, params.names, params.contents],
    chain: client.chain,
    account: client.account!,
  });
}

export async function proposeRule(client: WalletClient, params: ProposeRuleParams): Promise<Hash> {
  return client.writeContract({
    address: params.rulesEngine,
    abi: rulesEngineAbi,
    functionName: "proposeRule",
    args: [
      params.novelId,
      params.proposalType,
      params.ruleName,
      params.ruleContent,
      params.chapterId,
      params.path,
    ],
    value: params.value ?? 0n,
    chain: client.chain,
    account: client.account!,
  });
}

export async function voteOnRuleProposal(client: WalletClient, params: VoteOnRuleProposalParams): Promise<Hash> {
  return client.writeContract({
    address: params.rulesEngine,
    abi: rulesEngineAbi,
    functionName: "voteOnRuleProposal",
    args: [params.proposalId, params.chapterId, params.path],
    chain: client.chain,
    account: client.account!,
  });
}

// ============================================================
// Reads
// ============================================================

export async function getNovel(client: PublicClient, novelId: bigint, novelCore: `0x${string}`) {
  return client.readContract({
    address: novelCore,
    abi: novelCoreAbi,
    functionName: "getNovel",
    args: [novelId],
  });
}

export async function getChapter(client: PublicClient, chapterId: bigint, novelCore: `0x${string}`) {
  return client.readContract({
    address: novelCore,
    abi: novelCoreAbi,
    functionName: "getChapter",
    args: [chapterId],
  });
}

export async function getWorldLineAncestors(client: PublicClient, novelId: bigint, novelCore: `0x${string}`) {
  return client.readContract({
    address: novelCore,
    abi: novelCoreAbi,
    functionName: "getWorldLineAncestors",
    args: [novelId],
  });
}

export async function getRoundData(
  client: PublicClient,
  novelId: bigint,
  round: number,
  roundManager: `0x${string}`,
) {
  return client.readContract({
    address: roundManager,
    abi: roundManagerAbi,
    functionName: "getRoundData",
    args: [novelId, round],
  });
}

export async function getNovelMetadata(client: PublicClient, novelId: bigint, novelCore: `0x${string}`) {
  return client.readContract({
    address: novelCore,
    abi: novelCoreAbi,
    functionName: "getNovelMetadata",
    args: [novelId],
  });
}

export async function getPoolBalance(client: PublicClient, novelId: bigint, prizePool: `0x${string}`) {
  return client.readContract({
    address: prizePool,
    abi: prizePoolAbi,
    functionName: "getPoolBalance",
    args: [novelId],
  });
}

export async function getRuleNames(client: PublicClient, novelId: bigint, rulesEngine: `0x${string}`) {
  return client.readContract({
    address: rulesEngine,
    abi: rulesEngineAbi,
    functionName: "getRuleNames",
    args: [novelId],
  });
}

export async function getRule(client: PublicClient, novelId: bigint, name: string, rulesEngine: `0x${string}`) {
  return client.readContract({
    address: rulesEngine,
    abi: rulesEngineAbi,
    functionName: "getRule",
    args: [novelId, name],
  });
}

export async function getRuleProposal(client: PublicClient, proposalId: bigint, rulesEngine: `0x${string}`) {
  return client.readContract({
    address: rulesEngine,
    abi: rulesEngineAbi,
    functionName: "getRuleProposal",
    args: [proposalId],
  });
}

export async function getNickname(client: PublicClient, user: `0x${string}`, userRegistry: `0x${string}`) {
  return client.readContract({
    address: userRegistry,
    abi: userRegistryAbi,
    functionName: "nicknames",
    args: [user],
  });
}
