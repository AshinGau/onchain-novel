/**
 * Human-readable ABIs for the Onchain Novel protocol contracts.
 * Only includes the essential function signatures needed by the MCP tools.
 */

export const novelCoreAbi = [
  // Novel lifecycle
  "function createNovel((uint64 minChapterLength, uint64 maxChapterLength, uint64 roundMinDuration, uint32 roundMinSubmissions, uint32 worldLineCount, uint32 roundsPerEpoch, uint16 prizeReleaseRate, uint16 voterRewardRate, uint64 commitDuration, uint64 revealDuration, uint256 stakeAmount, uint8 pollutionRounds, uint8 pollutionThreshold, uint8 contentLocation, string contentBaseUrl) config, (string title, string description, string coverUri) metadata, (bytes32 contentHash, uint64 declaredLength, bytes content)[] genesisChapters) external payable returns (uint256 novelId)",
  "function forkNovel(uint256 originalNovelId, uint256 branchChapterId, (uint64 minChapterLength, uint64 maxChapterLength, uint64 roundMinDuration, uint32 roundMinSubmissions, uint32 worldLineCount, uint32 roundsPerEpoch, uint16 prizeReleaseRate, uint16 voterRewardRate, uint64 commitDuration, uint64 revealDuration, uint256 stakeAmount, uint8 pollutionRounds, uint8 pollutionThreshold, uint8 contentLocation, string contentBaseUrl) config, (string title, string description, string coverUri) metadata) external payable returns (uint256 novelId)",
  "function completeNovel(uint256 novelId) external",
  "function updateNovelMetadata(uint256 novelId, (string title, string description, string coverUri) metadata) external",

  // Chapter submission
  "function submitChapter(uint256 novelId, uint256 parentChapterId, (bytes32 contentHash, uint64 declaredLength, bytes content) submission) external payable returns (uint256 chapterId)",

  // Round state transitions
  "function closeSubmissions(uint256 novelId) external",
  "function closeCommit(uint256 novelId) external",
  "function settleRound(uint256 novelId) external",

  // Epoch state transitions
  "function closeEpochCommit(uint256 novelId) external",
  "function settleEpoch(uint256 novelId) external",
  "function triggerEarlyEpoch(uint256 novelId) external",

  // Stake
  "function claimStakeRefund(uint256 novelId) external",

  // Queries
  "function getNovel(uint256 novelId) external view returns ((uint256 id, address creator, (uint64 minChapterLength, uint64 maxChapterLength, uint64 roundMinDuration, uint32 roundMinSubmissions, uint32 worldLineCount, uint32 roundsPerEpoch, uint16 prizeReleaseRate, uint16 voterRewardRate, uint64 commitDuration, uint64 revealDuration, uint256 stakeAmount, uint8 pollutionRounds, uint8 pollutionThreshold, uint8 contentLocation, string contentBaseUrl) config, uint32 currentRound, uint32 currentEpoch, uint8 roundPhase, uint8 epochPhase, uint256 phaseStartTime, uint32 genesisChapterCount, uint32 cumulativeCanonChapters, bool active, uint256 forkSourceNovelId, uint256 forkSourceChapterId))",
  "function getChapter(uint256 chapterId) external view returns ((uint256 id, uint256 novelId, uint256 parentId, address author, bytes32 contentHash, uint64 declaredLength, uint32 round, uint32 epoch, uint32 chapterIndex, uint256 voteCount, bool isWorldLine, bool isCanon))",
  "function getActiveWorldLines(uint256 novelId) external view returns (uint256[])",
  "function getRoundSubmissions(uint256 novelId, uint32 round) external view returns (uint256[])",
  "function getNovelCount() external view returns (uint256)",
  "function getChapterCount() external view returns (uint256)",
  "function getClaimableStake(uint256 novelId, address author) external view returns (uint256)",
  "function getNovelMetadata(uint256 novelId) external view returns ((string title, string description, string coverUri))",

  // Events
  "event NovelCreated(uint256 indexed novelId, address indexed creator, uint32 genesisCount)",
  "event NovelForked(uint256 indexed novelId, uint256 indexed sourceNovelId, uint256 sourceChapterId)",
  "event NovelCompleted(uint256 indexed novelId)",
  "event ChapterSubmitted(uint256 indexed novelId, uint256 indexed chapterId, address indexed author, uint256 parentChapterId, uint32 chapterIndex)",
  "event RoundPhaseChanged(uint256 indexed novelId, uint32 round, uint8 phase)",
  "event EpochPhaseChanged(uint256 indexed novelId, uint32 epoch, uint8 phase)",
  "event WorldLinesSelected(uint256 indexed novelId, uint32 round, uint256[] selectedIds)",
  "event CanonEstablished(uint256 indexed novelId, uint32 epoch, uint256 canonWorldLineId)",
  "event EarlyEpochTriggered(uint256 indexed novelId, uint32 epoch)",
  "event StakeRefunded(uint256 indexed novelId, address indexed author, uint256 amount)",
  "event StakeSlashed(uint256 indexed novelId, address indexed author, uint256 amount)",
  "event KeeperRewarded(uint256 indexed novelId, address indexed keeper, uint256 amount)",
  "event ChapterContentStored(uint256 indexed novelId, uint256 indexed chapterId, bytes content)",
  "event NovelMetadataUpdated(uint256 indexed novelId, string title, string description, string coverUri)",
] as const;

export const votingEngineAbi = [
  // Voter actions
  "function commitVote(uint256 novelId, uint256 votingRoundId, bytes32 commitHash) external payable",
  "function revealVote(uint256 novelId, uint256 votingRoundId, uint256 candidateId, bytes32 salt) external",
  "function claimVotingReward(uint256 novelId, uint256 votingRoundId) external",
  "function sweepUnrevealedStakes(uint256 novelId, uint256 votingRoundId) external",

  // Queries
  "function getVoteCommit(uint256 novelId, uint256 votingRoundId, address voter) external view returns ((bytes32 commitHash, uint256 stakeAmount, bool revealed, bool claimed, uint256 revealedCandidateId))",
  "function getVoteCount(uint256 novelId, uint256 votingRoundId, uint256 candidateId) external view returns (uint256)",
  "function getCandidates(uint256 novelId, uint256 votingRoundId) external view returns (uint256[])",

  // Events
  "event VoteCommitted(uint256 indexed novelId, uint256 indexed votingRoundId, address indexed voter)",
  "event VoteRevealed(uint256 indexed novelId, uint256 indexed votingRoundId, address indexed voter, uint256 candidateId)",
  "event VotingRewardClaimed(uint256 indexed novelId, uint256 indexed votingRoundId, address indexed voter, uint256 amount)",
  "event UnrevealedStakesSwept(uint256 indexed novelId, uint256 indexed votingRoundId, uint256 totalUnrevealed)",
  "event VotingInitialized(uint256 indexed novelId, uint256 votingRoundId, uint256 candidateCount)",
  "event VotesTallied(uint256 indexed novelId, uint256 votingRoundId, uint256[] rankedIds)",
  "event VoterRewardsDeposited(uint256 indexed novelId, uint256 totalAmount, uint256 roundCount)",
  "event CommitPhaseEnded(uint256 indexed novelId, uint256 indexed votingRoundId)",
] as const;

export const prizePoolAbi = [
  // Public actions
  "function tipNovel(uint256 novelId) external payable",
  "function claimReward(uint256 novelId) external",

  // Queries
  "function getPoolBalance(uint256 novelId) external view returns (uint256)",
  "function getPendingReward(uint256 novelId, address author) external view returns (uint256)",
  "function getTotalTipped(uint256 novelId) external view returns (uint256)",

  // Events
  "event TipReceived(uint256 indexed novelId, address indexed tipper, uint256 amount, uint256 timestamp)",
  "event RewardClaimed(uint256 indexed novelId, address indexed claimant, uint256 amount)",
  "event RewardDistributed(uint256 indexed novelId, uint32 epoch, uint256 totalReleased, uint256 authorCount)",
] as const;

export const chapterNFTAbi = [
  // Queries
  "function getChapterInfo(uint256 tokenId) external view returns ((uint256 novelId, uint256 chapterId, uint32 epoch, address author, bytes32 contentHash))",
  "function isChapterMinted(uint256 novelId, uint256 chapterId) external view returns (bool)",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function balanceOf(address owner) external view returns (uint256)",

  // Events
  "event ChapterNFTMinted(uint256 indexed tokenId, uint256 indexed novelId, uint256 chapterId, address author, uint32 epoch)",
] as const;
