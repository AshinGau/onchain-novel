import { parseAbi } from "viem";

/**
 * Contract addresses — read from env, fallback to local dev addresses.
 */
export const NOVEL_CORE_ADDRESS =
  (process.env.NEXT_PUBLIC_NOVEL_CORE_ADDRESS as `0x${string}`) ??
  ("0x0000000000000000000000000000000000000000" as `0x${string}`);

export const ROUND_MANAGER_ADDRESS =
  (process.env.NEXT_PUBLIC_ROUND_MANAGER_ADDRESS as `0x${string}`) ??
  ("0x0000000000000000000000000000000000000000" as `0x${string}`);

export const BOUNTY_BOARD_ADDRESS =
  (process.env.NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS as `0x${string}`) ??
  ("0x0000000000000000000000000000000000000000" as `0x${string}`);

export const PRIZE_POOL_ADDRESS =
  (process.env.NEXT_PUBLIC_PRIZE_POOL_ADDRESS as `0x${string}`) ??
  ("0x0000000000000000000000000000000000000000" as `0x${string}`);

export const VOTING_ENGINE_ADDRESS =
  (process.env.NEXT_PUBLIC_VOTING_ENGINE_ADDRESS as `0x${string}`) ??
  ("0x0000000000000000000000000000000000000000" as `0x${string}`);

export const RULES_ENGINE_ADDRESS =
  (process.env.NEXT_PUBLIC_RULES_ENGINE_ADDRESS as `0x${string}`) ??
  ("0x0000000000000000000000000000000000000000" as `0x${string}`);

export const USER_REGISTRY_ADDRESS =
  (process.env.NEXT_PUBLIC_USER_REGISTRY_ADDRESS as `0x${string}`) ??
  ("0x0000000000000000000000000000000000000000" as `0x${string}`);

/* ============================================================
   NovelCore ABI — slim core: novels/chapters/metadata/claim
   ============================================================ */

export const novelCoreAbi = parseAbi([
  "event ChapterSubmitted(uint64 indexed novelId, uint64 indexed chapterId, address indexed author, uint64 parentId, uint32 depth)",

  "function createNovel((uint64 minChapterLength, uint64 maxChapterLength, uint256 submissionFee, uint32 worldLineCount, uint256 voteStake, uint256 nominationFee, uint64 nominateDuration, uint64 commitDuration, uint64 revealDuration, uint64 minRoundGap, uint16 prizeReleaseRate, uint16 voterRewardRate, uint8 contentLocation, string contentBaseUrl, uint256 ruleFee, uint64 ruleVoteDuration, uint32 ruleQuorum) config, (string title, string description, string coverUri) metadata, (bytes32 contentHash, uint64 declaredLength, bytes content) rootChapter) external payable returns (uint64 novelId)",
  "function forkNovel(uint64 sourceChapterId, (uint64 minChapterLength, uint64 maxChapterLength, uint256 submissionFee, uint32 worldLineCount, uint256 voteStake, uint256 nominationFee, uint64 nominateDuration, uint64 commitDuration, uint64 revealDuration, uint64 minRoundGap, uint16 prizeReleaseRate, uint16 voterRewardRate, uint8 contentLocation, string contentBaseUrl, uint256 ruleFee, uint64 ruleVoteDuration, uint32 ruleQuorum) config, (string title, string description, string coverUri) metadata, (bytes32 contentHash, uint64 declaredLength, bytes content) rootChapter) external payable returns (uint64 novelId)",
  "function submitChapter(uint64 novelId, uint64 parentId, (bytes32 contentHash, uint64 declaredLength, bytes content) submission) external payable",
  "function claimReward(uint64 novelId) external",
  "function updateNovelMetadata(uint64 novelId, (string title, string description, string coverUri) metadata) external",

  "function getNovel(uint64 novelId) external view returns ((uint64 id, address creator, (uint64 minChapterLength, uint64 maxChapterLength, uint256 submissionFee, uint32 worldLineCount, uint256 voteStake, uint256 nominationFee, uint64 nominateDuration, uint64 commitDuration, uint64 revealDuration, uint64 minRoundGap, uint16 prizeReleaseRate, uint16 voterRewardRate, uint8 contentLocation, string contentBaseUrl, uint256 ruleFee, uint64 ruleVoteDuration, uint32 ruleQuorum) config, uint32 currentRound, uint8 roundPhase, uint64 phaseStartTime, uint64 lastSettleTime, bool active))",
  "function getChapter(uint64 chapterId) external view returns ((uint64 id, uint64 novelId, uint64 parentId, address author, bytes32 contentHash, uint64 declaredLength, uint32 depth, uint64 timestamp, uint64[] children))",
  "function getChapterChildren(uint64 chapterId) external view returns (uint64[])",
  "function getWorldLineAncestors(uint64 novelId) external view returns (uint64[])",
  "function isWorldLineAuthor(uint64 novelId, address author) external view returns (bool)",
  "function novelCount() external view returns (uint64)",
  "function chapterCount() external view returns (uint64)",
]);

/* ============================================================
   RoundManager ABI — round lifecycle, voting, completion
   ============================================================ */

export const roundManagerAbi = parseAbi([
  "event RoundStarted(uint64 indexed novelId, uint32 round, uint64[] candidates)",
  "event RoundSettled(uint64 indexed novelId, uint32 round, uint64[] worldLines)",

  "function startRound(uint64 novelId) external",
  "function closeNomination(uint64 novelId) external",
  "function closeCommit(uint64 novelId) external",
  "function settleRound(uint64 novelId) external",
  "function nominateCandidate(uint64 novelId, uint64 chapterId) external payable",
  "function commitVote(uint64 novelId, bytes32 commitHash) external payable",
  "function revealVote(uint64 novelId, uint64 candidateId, bytes32 salt) external",
  "function claimVotingReward(uint64 novelId, uint32 round) external",
  "function completeNovel(uint64 novelId) external",

  "function getRoundData(uint64 novelId, uint32 round) external view returns ((uint64[] candidates, bool[] candidateIsEligible, uint64[] prevWorldLines, uint64 nominateEndTime, uint64 commitEndTime, uint64 revealEndTime, bool settled))",
]);

/* ============================================================
   PrizePool ABI
   ============================================================ */

export const prizePoolAbi = parseAbi([
  "function getPendingReward(uint64 novelId, address user) external view returns (uint256)",
  "function getPoolBalance(uint64 novelId) external view returns (uint256)",
  "function tipNovel(uint64 novelId) external payable",
  "function tipChapter(uint64 chapterId) external payable",
]);

/* ============================================================
   VotingEngine ABI
   ============================================================ */

export const votingEngineAbi = parseAbi([
  "function claimVotingReward(uint64 novelId, uint32 round) external",
]);

/* ============================================================
   RulesEngine ABI
   ============================================================ */

export const rulesEngineAbi = parseAbi([
  "function setCreatorRules(uint64 novelId, string[] names, string[] contents) external",
]);

/* ============================================================
   BountyBoard ABI
   ============================================================ */

export const bountyBoardAbi = parseAbi([
  "function createBounty(uint64 chapterId, uint64 deadline) external payable returns (uint256 bountyId)",
  "function designateBounty(uint256 bountyId, uint64 chapterId) external",
  "function claimBounty(uint256 bountyId) external",
  "function refundBounty(uint256 bountyId) external",
]);

/* ============================================================
   UserRegistry ABI — standalone nickname registry
   ============================================================ */

export const userRegistryAbi = parseAbi([
  "event NicknameSet(address indexed user, bytes32 nickname)",
  "function nicknames(address user) external view returns (bytes32)",
  "function setNickname(bytes32 nickname) external",
]);
