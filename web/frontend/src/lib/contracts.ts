import { parseAbi, keccak256, encodePacked } from "viem";

export const NOVEL_CORE_ADDRESS = (process.env.NEXT_PUBLIC_NOVEL_CORE_ADDRESS || "0x") as `0x${string}`;
export const VOTING_ENGINE_ADDRESS = (process.env.NEXT_PUBLIC_VOTING_ENGINE_ADDRESS || "0x") as `0x${string}`;
export const PRIZE_POOL_ADDRESS = (process.env.NEXT_PUBLIC_PRIZE_POOL_ADDRESS || "0x") as `0x${string}`;
export const REPORT_REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_REPORT_REGISTRY_ADDRESS || "0x") as `0x${string}`;
export const RULES_ENGINE_ADDRESS = (process.env.NEXT_PUBLIC_RULES_ENGINE_ADDRESS || "0x") as `0x${string}`;

export const prizePoolAbi = parseAbi([
  "function tipNovel(uint256 novelId) external payable",
  "function claimReward(uint256 novelId) external",
  "function getPoolBalance(uint256 novelId) external view returns (uint256)",
  "function getPendingReward(uint256 novelId, address author) external view returns (uint256)",
  // Errors
  "error TipTooSmall()",
  "error NoPendingReward()",
  "error TransferFailed()",
  "error NoAuthors()",
  "error ZeroAmount()",
  "error InvalidRate()",
]);

export const votingEngineAbi = parseAbi([
  "function commitVote(uint256 novelId, uint256 votingRoundId, bytes32 commitHash) external payable",
  "function revealVote(uint256 novelId, uint256 votingRoundId, uint256 candidateId, bytes32 salt) external",
  "function claimVotingReward(uint256 novelId, uint256 votingRoundId) external",
  "function getVoteCommit(uint256 novelId, uint256 votingRoundId, address voter) external view returns ((bytes32 commitHash, uint256 stakeAmount, bool revealed, bool claimed, uint256 revealedCandidateId))",
  // Errors
  "error AlreadyCommitted()",
  "error NotCommitted()",
  "error AlreadyRevealed()",
  "error InvalidReveal()",
  "error InvalidCandidate()",
  "error AlreadyTallied()",
  "error NotTallied()",
  "error AlreadyClaimed()",
  "error NoCandidates()",
  "error NotRevealed()",
  "error ZeroStake()",
  "error CommitPhaseClosed()",
  "error RevealNotOpen()",
  "error TransferFailed()",
]);

export const novelCoreAbi = parseAbi([
  "function claimStakeRefund(uint256 novelId) external",
  "function getClaimableStake(uint256 novelId, address author) external view returns (uint256)",
  "function submitChapter(uint256 novelId, uint256 parentChapterId, (bytes32 contentHash, uint64 declaredLength, bytes content) submission) external payable returns (uint256 chapterId)",
  "function createNovel((uint64 minChapterLength, uint64 maxChapterLength, uint64 roundMinDuration, uint32 roundMinSubmissions, uint32 worldLineCount, uint32 roundsPerEpoch, uint16 prizeReleaseRate, uint16 voterRewardRate, uint64 commitDuration, uint64 revealDuration, uint256 stakeAmount, uint8 spamRounds, uint8 spamThreshold, uint8 contentLocation, string contentBaseUrl, uint256 ruleFee, uint64 ruleVoteDuration, uint32 ruleQuorum) config, (string title, string description, string coverUri) metadata, (bytes32 contentHash, uint64 declaredLength, bytes content)[] bootstrapChapters) external payable returns (uint256 novelId)",
  "function forkNovel(uint256 originalNovelId, uint256 branchChapterId, (uint64 minChapterLength, uint64 maxChapterLength, uint64 roundMinDuration, uint32 roundMinSubmissions, uint32 worldLineCount, uint32 roundsPerEpoch, uint16 prizeReleaseRate, uint16 voterRewardRate, uint64 commitDuration, uint64 revealDuration, uint256 stakeAmount, uint8 spamRounds, uint8 spamThreshold, uint8 contentLocation, string contentBaseUrl, uint256 ruleFee, uint64 ruleVoteDuration, uint32 ruleQuorum) config, (string title, string description, string coverUri) metadata, (bytes32 contentHash, uint64 declaredLength, bytes content)[] bootstrapChapters) external payable returns (uint256 novelId)",
  "function getNovel(uint256 novelId) external view returns ((uint256 id, address creator, (uint64 minChapterLength, uint64 maxChapterLength, uint64 roundMinDuration, uint32 roundMinSubmissions, uint32 worldLineCount, uint32 roundsPerEpoch, uint16 prizeReleaseRate, uint16 voterRewardRate, uint64 commitDuration, uint64 revealDuration, uint256 stakeAmount, uint8 spamRounds, uint8 spamThreshold, uint8 contentLocation, string contentBaseUrl, uint256 ruleFee, uint64 ruleVoteDuration, uint32 ruleQuorum) config, uint32 currentRound, uint32 currentEpoch, uint8 roundPhase, uint8 epochPhase, uint256 phaseStartTime, uint32 bootstrapChapterCount, uint32 cumulativeCanonChapters, bool active, uint256 forkSourceNovelId, uint256 forkSourceChapterId))",
  // State transition functions (permissionless — anyone can call when conditions are met)
  "function closeSubmissions(uint256 novelId) external",
  "function closeCommit(uint256 novelId) external",
  "function settleRound(uint256 novelId) external",
  "function closeEpochCommit(uint256 novelId) external",
  "function settleEpoch(uint256 novelId) external",
  // Errors
  "error InvalidConfig()",
  "error NovelNotFound()",
  "error NovelNotActive()",
  "error ChapterNotFound()",
  "error NotWorldLine()",
  "error InvalidStakeAmount()",
  "error ContentLengthOutOfRange()",
  "error WrongRoundPhase()",
  "error WrongEpochPhase()",
  "error RoundConditionsNotMet()",
  "error PhaseNotExpired()",
  "error NoStakeToRefund()",
  "error TransferFailed()",
  "error ChapterNotInNovel()",
  "error BranchNotRejected()",
  "error InvalidBootstrapInput()",
  "error InsufficientForkFee()",
  "error NotNovelCreator()",
  "error InvalidMetadata()",
  "error ContentHashMismatch()",
  "error OnchainContentRequired()",
  "error OnchainContentForbidden()",
]);

export const rulesEngineAbi = parseAbi([
  "function setCreatorRules(uint256 novelId, string[] names, string[] contents) external",
]);

export const reportRegistryAbi = parseAbi([
  "function reportContent(uint256 novelId, uint256 chapterId, bytes32 evidenceHash) external payable returns (uint256 reportId)",
  // Errors
  "error BondTooSmall()",
  "error ReportNotFound()",
  "error ReportAlreadyResolved()",
  "error TransferFailed()",
]);

/**
 * Compute votingRoundId matching the contract's _computeVotingRoundId:
 * uint256(keccak256(abi.encodePacked(novelId, epoch, round, isEpoch)))
 */
export function computeVotingRoundId(
  novelId: bigint,
  epoch: number,
  round: number,
  isEpoch: boolean
): string {
  const hash = keccak256(
    encodePacked(
      ["uint256", "uint32", "uint32", "bool"],
      [novelId, epoch, round, isEpoch]
    )
  );
  // Convert bytes32 hash to uint256 string
  return BigInt(hash).toString();
}
