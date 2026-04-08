import {
  type PublicClient,
  type WalletClient,
  type Hash,
  encodePacked,
  keccak256,
  toHex,
} from "viem";
import { novelCoreAbi, prizePoolAbi, bountyBoardAbi, rulesEngineAbi } from "./abi.js";

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
  novelCore: `0x${string}`;
}

export interface RevealVoteParams {
  novelId: bigint;
  candidateId: bigint;
  salt: `0x${string}`;
  novelCore: `0x${string}`;
}

export interface NominateCandidateParams {
  novelId: bigint;
  chapterId: bigint;
  value?: bigint;
  novelCore: `0x${string}`;
}

export interface TipParams {
  id: bigint;
  value: bigint;
  novelCore: `0x${string}`;
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
  value?: bigint;
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
// Write operations (need walletClient)
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

export async function commitVote(client: WalletClient, params: CommitVoteParams): Promise<Hash> {
  return client.writeContract({
    address: params.novelCore,
    abi: novelCoreAbi,
    functionName: "commitVote",
    args: [params.novelId, params.commitHash],
    value: params.value ?? 0n,
    chain: client.chain,
    account: client.account!,
  });
}

export async function revealVote(client: WalletClient, params: RevealVoteParams): Promise<Hash> {
  return client.writeContract({
    address: params.novelCore,
    abi: novelCoreAbi,
    functionName: "revealVote",
    args: [params.novelId, params.candidateId, params.salt],
    chain: client.chain,
    account: client.account!,
  });
}

export async function startRound(client: WalletClient, novelId: bigint, novelCore: `0x${string}`): Promise<Hash> {
  return client.writeContract({
    address: novelCore,
    abi: novelCoreAbi,
    functionName: "startRound",
    args: [novelId],
    chain: client.chain,
    account: client.account!,
  });
}

export async function closeNomination(client: WalletClient, novelId: bigint, novelCore: `0x${string}`): Promise<Hash> {
  return client.writeContract({
    address: novelCore,
    abi: novelCoreAbi,
    functionName: "closeNomination",
    args: [novelId],
    chain: client.chain,
    account: client.account!,
  });
}

export async function closeCommit(client: WalletClient, novelId: bigint, novelCore: `0x${string}`): Promise<Hash> {
  return client.writeContract({
    address: novelCore,
    abi: novelCoreAbi,
    functionName: "closeCommit",
    args: [novelId],
    chain: client.chain,
    account: client.account!,
  });
}

export async function settleRound(client: WalletClient, novelId: bigint, novelCore: `0x${string}`): Promise<Hash> {
  return client.writeContract({
    address: novelCore,
    abi: novelCoreAbi,
    functionName: "settleRound",
    args: [novelId],
    chain: client.chain,
    account: client.account!,
  });
}

export async function nominateCandidate(client: WalletClient, params: NominateCandidateParams): Promise<Hash> {
  return client.writeContract({
    address: params.novelCore,
    abi: novelCoreAbi,
    functionName: "nominateCandidate",
    args: [params.novelId, params.chapterId],
    value: params.value ?? 0n,
    chain: client.chain,
    account: client.account!,
  });
}

export async function tipNovel(client: WalletClient, params: TipParams): Promise<Hash> {
  return client.writeContract({
    address: params.novelCore,
    abi: novelCoreAbi,
    functionName: "tipNovel",
    args: [params.id],
    value: params.value,
    chain: client.chain,
    account: client.account!,
  });
}

export async function tipChapter(client: WalletClient, params: TipParams): Promise<Hash> {
  return client.writeContract({
    address: params.novelCore,
    abi: novelCoreAbi,
    functionName: "tipChapter",
    args: [params.id],
    value: params.value,
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

export async function claimVotingReward(
  client: WalletClient,
  novelId: bigint,
  round: number,
  novelCore: `0x${string}`,
): Promise<Hash> {
  return client.writeContract({
    address: novelCore,
    abi: novelCoreAbi,
    functionName: "claimVotingReward",
    args: [novelId, round],
    chain: client.chain,
    account: client.account!,
  });
}

export async function completeNovel(client: WalletClient, novelId: bigint, novelCore: `0x${string}`): Promise<Hash> {
  return client.writeContract({
    address: novelCore,
    abi: novelCoreAbi,
    functionName: "completeNovel",
    args: [novelId],
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
    args: [params.novelId, params.proposalType, params.ruleName, params.ruleContent],
    value: params.value ?? 0n,
    chain: client.chain,
    account: client.account!,
  });
}

export async function voteOnRuleProposal(
  client: WalletClient,
  proposalId: bigint,
  rulesEngine: `0x${string}`,
): Promise<Hash> {
  return client.writeContract({
    address: rulesEngine,
    abi: rulesEngineAbi,
    functionName: "voteOnRuleProposal",
    args: [proposalId],
    chain: client.chain,
    account: client.account!,
  });
}

// ============================================================
// Read operations (need publicClient)
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

export async function getRoundData(client: PublicClient, novelId: bigint, round: number, novelCore: `0x${string}`) {
  return client.readContract({
    address: novelCore,
    abi: novelCoreAbi,
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
