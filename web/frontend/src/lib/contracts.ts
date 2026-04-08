import { parseAbi } from "viem";

/**
 * Contract addresses — read from env, fallback to local dev addresses.
 * After deploying, set NEXT_PUBLIC_NOVEL_CORE_ADDRESS etc.
 */
export const NOVEL_CORE_ADDRESS =
  (process.env.NEXT_PUBLIC_NOVEL_CORE_ADDRESS as `0x${string}`) ??
  ("0x0000000000000000000000000000000000000000" as `0x${string}`);

export const BOUNTY_BOARD_ADDRESS =
  (process.env.NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS as `0x${string}`) ??
  ("0x0000000000000000000000000000000000000000" as `0x${string}`);

/* ============================================================
   NovelCore ABI (write + view functions used by frontend)
   ============================================================ */

export const novelCoreAbi = parseAbi([
  // Write
  "function submitChapter(uint64 novelId, uint64 parentId, (bytes32 contentHash, uint64 declaredLength, bytes content) submission) external payable",
  "function commitVote(uint64 novelId, bytes32 commitHash) external payable",
  "function revealVote(uint64 novelId, uint64 candidateId, bytes32 salt) external",
  "function claimReward(uint64 novelId) external",
  "function claimVotingReward(uint64 novelId, uint32 round) external",
  "function tipNovel(uint64 novelId) external payable",
  "function tipChapter(uint64 chapterId) external payable",

  // View
  "function getNovel(uint64 novelId) external view returns ((uint64 id, address creator, (uint64 minChapterLength, uint64 maxChapterLength, uint256 submissionFee, uint32 worldLineCount, uint256 voteStake, uint256 nominationFee, uint64 nominateDuration, uint64 commitDuration, uint64 revealDuration, uint64 minRoundGap, uint16 prizeReleaseRate, uint16 voterRewardRate, uint8 contentLocation, string contentBaseUrl, uint256 ruleFee, uint64 ruleVoteDuration, uint32 ruleQuorum) config, uint32 currentRound, uint8 roundPhase, uint64 phaseStartTime, uint64 lastSettleTime, bool active))",
  "function getChapter(uint64 chapterId) external view returns ((uint64 id, uint64 novelId, uint64 parentId, address author, bytes32 contentHash, uint64 declaredLength, uint32 depth, uint64 timestamp, uint64[] descendants))",
  "function getRoundData(uint64 novelId, uint32 round) external view returns ((uint64[] candidates, bool[] candidateIsEligible, uint64[] prevWorldLines, uint64 nominateEndTime, uint64 commitEndTime, uint64 revealEndTime, bool settled))",
  "function getVoteCommit(uint64 novelId, uint32 round, address voter) external view returns (bytes32)",
]);

/* ============================================================
   BountyBoard ABI
   ============================================================ */

export const bountyBoardAbi = parseAbi([
  "function createBounty(uint64 chapterId, uint64 deadline) external payable returns (uint256 bountyId)",
  "function claimBounty(uint256 bountyId) external",
  "function refundBounty(uint256 bountyId) external",
]);
