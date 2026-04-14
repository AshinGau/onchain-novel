import { parseAbi } from "viem";

// ============================================================
// NovelCore ABI (slim — only chapters/novels/metadata/rewards forward)
// ============================================================
// Event indexed keywords MUST match the Solidity definitions exactly.
// Mismatched indexed causes silent decode failures.

export const novelCoreAbi = parseAbi([
  // --- Events ---
  "event NovelCreated(uint64 indexed novelId, address indexed creator)",
  "event NovelForked(uint64 indexed novelId, uint64 indexed sourceChapterId, address indexed creator)",
  "event ChapterSubmitted(uint64 indexed novelId, uint64 indexed chapterId, address indexed author, uint64 parentId, uint32 depth)",
  "event RewardClaimed(uint64 indexed novelId, address indexed recipient, uint256 amount)",
  "event NovelMetadataUpdated(uint64 indexed novelId, string title, string description, string coverUri)",

  // --- View functions ---
  "function getNovel(uint64 novelId) external view returns ((uint64 id, address creator, (uint64 minChapterLength, uint64 maxChapterLength, uint256 submissionFee, uint32 worldLineCount, uint256 voteStake, uint256 nominationFee, uint64 nominateDuration, uint64 commitDuration, uint64 revealDuration, uint64 minRoundGap, uint16 prizeReleaseRate, uint16 voterRewardRate, uint8 contentLocation, string contentBaseUrl, uint256 ruleFee, uint64 ruleVoteDuration, uint32 ruleQuorum) config, uint32 currentRound, uint8 roundPhase, uint64 phaseStartTime, uint64 lastSettleTime, bool active))",
  "function getNovelMetadata(uint64 novelId) external view returns ((string title, string description, string coverUri))",
  "function getChapter(uint64 chapterId) external view returns ((uint64 id, uint64 novelId, uint64 parentId, address author, bytes32 contentHash, uint64 declaredLength, uint32 depth, uint64 timestamp, uint64[] children))",
  "function getWorldLineAncestors(uint64 novelId) external view returns (uint64[])",
  "function getChapterChildren(uint64 chapterId) external view returns (uint64[])",
  "function verifyChapterPath(uint64 novelId, uint64[] path) external view",
  "function isCurrentWorldLineAncestor(uint64 novelId, uint64 chapterId) external view returns (bool)",
  "function verifyWorldLineAuthor(uint64 novelId, address expectedAuthor, uint64[] path) external view",
  "function novelCount() external view returns (uint64)",
  "function chapterCount() external view returns (uint64)",

  // --- Write functions ---
  "function submitChapter(uint64 novelId, uint64 parentId, (bytes32 contentHash, uint64 declaredLength, bytes content) submission) external payable",
  "function createNovel((uint64 minChapterLength, uint64 maxChapterLength, uint256 submissionFee, uint32 worldLineCount, uint256 voteStake, uint256 nominationFee, uint64 nominateDuration, uint64 commitDuration, uint64 revealDuration, uint64 minRoundGap, uint16 prizeReleaseRate, uint16 voterRewardRate, uint8 contentLocation, string contentBaseUrl, uint256 ruleFee, uint64 ruleVoteDuration, uint32 ruleQuorum) config, (string title, string description, string coverUri) metadata, (bytes32 contentHash, uint64 declaredLength, bytes content) rootChapter) external payable returns (uint64 novelId)",
  "function forkNovel(uint64 sourceChapterId, (uint64 minChapterLength, uint64 maxChapterLength, uint256 submissionFee, uint32 worldLineCount, uint256 voteStake, uint256 nominationFee, uint64 nominateDuration, uint64 commitDuration, uint64 revealDuration, uint64 minRoundGap, uint16 prizeReleaseRate, uint16 voterRewardRate, uint8 contentLocation, string contentBaseUrl, uint256 ruleFee, uint64 ruleVoteDuration, uint32 ruleQuorum) config, (string title, string description, string coverUri) metadata, (bytes32 contentHash, uint64 declaredLength, bytes content) rootChapter) external payable returns (uint64 novelId)",
  "function claimReward(uint64 novelId) external",
  "function updateNovelMetadata(uint64 novelId, (string title, string description, string coverUri) metadata) external",
]);

// ============================================================
// RoundManager ABI (round lifecycle, voting, completion)
// ============================================================

export const roundManagerAbi = parseAbi([
  // --- Events ---
  "event KeeperUpdated(address indexed oldAddr, address indexed newAddr)",
  "event RoundStarted(uint64 indexed novelId, uint32 round, uint64[] candidates)",
  "event NominationClosed(uint64 indexed novelId, uint32 round)",
  "event CommitClosed(uint64 indexed novelId, uint32 round)",
  "event RoundSettled(uint64 indexed novelId, uint32 round, uint64[] worldLines)",
  "event CandidateNominated(uint64 indexed novelId, uint32 round, uint64 chapterId, address nominator)",
  "event VoteCommitted(uint64 indexed novelId, uint32 round, address indexed voter)",
  "event VoteRevealed(uint64 indexed novelId, uint32 round, address indexed voter, uint64 candidateId)",
  "event RewardClaimed(uint64 indexed novelId, address indexed recipient, uint256 amount)",
  "event NovelCompleted(uint64 indexed novelId)",
  "event KeeperRewarded(uint64 indexed novelId, address indexed keeper, uint256 amount)",

  // --- View ---
  "function getRoundData(uint64 novelId, uint32 round) external view returns ((uint64[] candidates, uint64 nominateEndTime, uint64 commitEndTime, uint64 revealEndTime, bool settled))",
  "function keeper() external view returns (address)",

  // --- Admin ---
  "function setKeeper(address newKeeper) external",

  // --- Write ---
  "function startRound(uint64 novelId, uint64[] leaves) external",
  "function closeNomination(uint64 novelId) external",
  "function closeCommit(uint64 novelId) external",
  "function settleRound(uint64 novelId, uint64[][] winnerPaths) external",
  "function nominateCandidate(uint64 novelId, uint64[] path) external payable",
  "function commitVote(uint64 novelId, bytes32 commitHash) external payable",
  "function revealVote(uint64 novelId, uint64 candidateId, bytes32 salt) external",
  "function claimVotingReward(uint64 novelId, uint32 round) external",
  "function completeNovel(uint64 novelId, uint64[][] finalPaths) external",
]);

// ============================================================
// VotingEngine ABI
// ============================================================

export const votingEngineAbi = parseAbi([
  "event VotingInitialized(uint64 indexed novelId, uint32 indexed round, uint256 candidateCount)",
  "event VoteCommitted(uint64 indexed novelId, uint32 indexed round, address indexed voter)",
  "event VoteRevealed(uint64 indexed novelId, uint32 indexed round, address indexed voter, uint64 candidateId)",
  "event VotesTallied(uint64 indexed novelId, uint32 indexed round, uint64[] rankedCandidateIds)",
  "event VoterRewardsSettled(uint64 indexed novelId, uint32 indexed round, uint256 totalRewardPool)",
  "event VotingRewardClaimed(uint64 indexed novelId, uint32 indexed round, address indexed voter, uint256 amount)",
]);

// ============================================================
// PrizePool ABI (tipping is now public on PrizePool)
// ============================================================

export const prizePoolAbi = parseAbi([
  "event PoolDeposited(uint64 indexed novelId, uint256 amount, string reason)",
  "event RoundRewardsDistributed(uint64 indexed novelId, uint32 round, uint256 creatorRoyalty, uint256 authorRewards, uint256 voterRewards)",
  "event TipReceived(uint64 indexed novelId, address indexed tipper, uint256 amount)",
  "event ChapterTipped(uint64 indexed novelId, uint64 indexed chapterId, address indexed tipper, uint256 amount)",
  "event RewardClaimed(uint64 indexed novelId, address indexed recipient, uint256 amount)",
  "event KeeperRewardPaid(uint64 indexed novelId, address indexed keeper, uint256 amount)",

  "function getPoolBalance(uint64 novelId) external view returns (uint256)",
  "function tipNovel(uint64 novelId) external payable",
  "function tipChapter(uint64 chapterId) external payable",
]);

// ============================================================
// BountyBoard ABI
// ============================================================

export const bountyBoardAbi = parseAbi([
  "event BountyCreated(uint64 indexed bountyId, uint64 indexed chapterId, address indexed tipper, uint256 lockedAmount, uint64 deadline)",
  "event BountyDesignated(uint64 indexed bountyId, uint64 indexed chapterId)",
  "event BountyClaimed(uint64 indexed bountyId, address indexed author, uint256 amount)",
  "event BountyRefunded(uint64 indexed bountyId, address indexed tipper, uint256 amount)",

  "function createBounty(uint64 chapterId, uint64 deadline) external payable returns (uint64 bountyId)",
  "function designateBounty(uint64 bountyId, uint64 chapterId) external",
  "function claimBounty(uint64 bountyId) external",
  "function refundBounty(uint64 bountyId) external",
]);

// ============================================================
// RulesEngine ABI
// ============================================================

export const rulesEngineAbi = parseAbi([
  "event RuleSet(uint64 indexed novelId, string name)",
  "event RuleDeleted(uint64 indexed novelId, string name)",
  "event RuleProposed(uint64 indexed proposalId, uint64 indexed novelId, address indexed proposer, uint8 proposalType, string ruleName)",
  "event RuleProposalVoted(uint64 indexed proposalId, address indexed voter, uint32 newVoteCount)",
  "event RuleProposalExecuted(uint64 indexed proposalId, uint64 indexed novelId)",

  "function getRule(uint64 novelId, string name) external view returns (string)",
  "function getRuleNames(uint64 novelId) external view returns (string[])",
  "function getRuleProposal(uint64 proposalId) external view returns ((uint64 id, uint64 novelId, uint64 createdAt, address proposer, uint8 proposalType, uint32 voteCount, bool executed, string ruleName, string ruleContent))",
  "function setCreatorRules(uint64 novelId, string[] names, string[] contents) external",
  "function proposeRule(uint64 novelId, uint8 proposalType, string ruleName, string ruleContent, uint64[] path) external payable returns (uint64 proposalId)",
  "function voteOnRuleProposal(uint64 proposalId, uint64[] path) external",
]);

// ============================================================
// UserRegistry ABI (standalone nicknames)
// ============================================================

export const userRegistryAbi = parseAbi([
  "event NicknameSet(address indexed user, bytes32 nickname)",
  "function nicknames(address user) external view returns (bytes32)",
  "function setNickname(bytes32 nickname) external",
]);
