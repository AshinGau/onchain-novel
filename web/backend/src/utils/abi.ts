import { parseAbi } from "viem";

export const novelCoreAbi = parseAbi([
  "event NovelCreated(uint256 indexed novelId, address indexed creator, uint32 bootstrapChapterCount)",
  "event NovelForked(uint256 indexed novelId, uint256 indexed sourceNovelId, uint256 sourceChapterId)",
  "event NovelCompleted(uint256 indexed novelId)",
  "event ChapterSubmitted(uint256 indexed novelId, uint256 indexed chapterId, address indexed author, uint256 parentId, uint32 chapterIndex)",
  "event RoundPhaseChanged(uint256 indexed novelId, uint32 round, uint8 phase)",
  "event EpochPhaseChanged(uint256 indexed novelId, uint32 epoch, uint8 phase)",
  "event WorldLinesSelected(uint256 indexed novelId, uint32 round, uint256[] selectedChapterIds)",
  "event CanonEstablished(uint256 indexed novelId, uint32 epoch, uint256 canonWorldLineId)",
  "event StakeRefunded(uint256 indexed novelId, address indexed author, uint256 amount)",
  "event StakeSlashed(uint256 indexed novelId, address indexed author, uint256 amount)",
  "event KeeperRewarded(uint256 indexed novelId, address indexed keeper, uint256 amount)",
  "event EarlyEpochTriggered(uint256 indexed novelId, uint32 epoch)",
  "event NovelMetadataUpdated(uint256 indexed novelId, string title, string description, string coverUri)",
  "function getNovel(uint256 novelId) external view returns ((uint256 id, address creator, (uint64 minChapterLength, uint64 maxChapterLength, uint64 roundMinDuration, uint32 roundMinSubmissions, uint32 worldLineCount, uint32 roundsPerEpoch, uint16 prizeReleaseRate, uint16 voterRewardRate, uint64 commitDuration, uint64 revealDuration, uint256 stakeAmount, uint8 spamRounds, uint8 spamThreshold, uint8 contentLocation, string contentBaseUrl, uint256 ruleFee, uint64 ruleVoteDuration, uint32 ruleQuorum) config, uint32 currentRound, uint32 currentEpoch, uint8 roundPhase, uint8 epochPhase, uint256 phaseStartTime, uint32 bootstrapChapterCount, uint32 cumulativeCanonChapters, bool active, uint256 forkSourceNovelId, uint256 forkSourceChapterId))",
  "function getNovelMetadata(uint256 novelId) external view returns ((string title, string description, string coverUri))",
  "function getChapter(uint256 chapterId) external view returns ((uint256 id, uint256 novelId, uint256 parentId, address author, bytes32 contentHash, uint64 declaredLength, uint32 round, uint32 epoch, uint32 chapterIndex, uint256 voteCount, bool isWorldLine, bool isCanon))",
  "function getActiveWorldLines(uint256 novelId) external view returns (uint256[])",
  "function getNovelCount() external view returns (uint256)",
  "function getChapterCount() external view returns (uint256)",
  "function submitChapter(uint256 novelId, uint256 parentChapterId, (bytes32 contentHash, uint64 declaredLength, bytes content) submission) external payable returns (uint256 chapterId)",
  "function createNovel((uint64 minChapterLength, uint64 maxChapterLength, uint64 roundMinDuration, uint32 roundMinSubmissions, uint32 worldLineCount, uint32 roundsPerEpoch, uint16 prizeReleaseRate, uint16 voterRewardRate, uint64 commitDuration, uint64 revealDuration, uint256 stakeAmount, uint8 spamRounds, uint8 spamThreshold, uint8 contentLocation, string contentBaseUrl, uint256 ruleFee, uint64 ruleVoteDuration, uint32 ruleQuorum) config, (string title, string description, string coverUri) metadata, (bytes32 contentHash, uint64 declaredLength, bytes content)[] bootstrapChapters) external payable returns (uint256 novelId)",
  "function forkNovel(uint256 originalNovelId, uint256 branchChapterId, (uint64 minChapterLength, uint64 maxChapterLength, uint64 roundMinDuration, uint32 roundMinSubmissions, uint32 worldLineCount, uint32 roundsPerEpoch, uint16 prizeReleaseRate, uint16 voterRewardRate, uint64 commitDuration, uint64 revealDuration, uint256 stakeAmount, uint8 spamRounds, uint8 spamThreshold, uint8 contentLocation, string contentBaseUrl, uint256 ruleFee, uint64 ruleVoteDuration, uint32 ruleQuorum) config, (string title, string description, string coverUri) metadata, (bytes32 contentHash, uint64 declaredLength, bytes content)[] bootstrapChapters) external payable returns (uint256 novelId)",
]);

export const votingEngineAbi = parseAbi([
  "event VoteCommitted(uint256 indexed novelId, uint256 indexed votingRoundId, address indexed voter)",
  "event VoteRevealed(uint256 indexed novelId, uint256 indexed votingRoundId, address indexed voter, uint256 candidateId)",
  "event VotesTallied(uint256 indexed novelId, uint256 indexed votingRoundId, uint256[] rankedCandidateIds)",
  "event VotingRewardClaimed(uint256 indexed novelId, uint256 indexed votingRoundId, address indexed voter, uint256 totalAmount)",
  "event UnrevealedStakesSwept(uint256 indexed novelId, uint256 indexed votingRoundId, uint256 totalUnrevealed)",
  "event CommitPhaseEnded(uint256 indexed novelId, uint256 indexed votingRoundId)",
]);

export const prizePoolAbi = parseAbi([
  "event TipReceived(uint256 indexed novelId, address indexed tipper, uint256 amount, uint256 timestamp)",
  "event RewardClaimed(uint256 indexed novelId, address indexed claimant, uint256 amount)",
  "event RewardDistributed(uint256 indexed novelId, uint32 epoch, uint256 totalAmount, uint256 authorCount)",
  "function getPoolBalance(uint256 novelId) external view returns (uint256)",
  "function getTotalTipped(uint256 novelId) external view returns (uint256)",
]);

export const chapterNFTAbi = parseAbi([
  "event ChapterNFTMinted(uint256 indexed tokenId, uint256 indexed novelId, uint256 indexed chapterId, address author, uint32 epoch)",
]);

export const rulesEngineAbi = parseAbi([
  "event RuleSet(uint256 indexed novelId, string name)",
  "event RuleDeleted(uint256 indexed novelId, string name)",
  "event RuleProposed(uint256 indexed proposalId, uint256 indexed novelId, address indexed proposer, uint8 proposalType, string ruleName)",
  "event RuleProposalVoted(uint256 indexed proposalId, address indexed voter, uint32 newVoteCount)",
  "event RuleProposalExecuted(uint256 indexed proposalId, uint256 indexed novelId)",
  "function getRule(uint256 novelId, string name) external view returns (string)",
  "function getRuleNames(uint256 novelId) external view returns (string[])",
  "function getRuleProposal(uint256 proposalId) external view returns ((uint256 id, uint256 novelId, address proposer, uint8 proposalType, string ruleName, string ruleContent, uint256 createdAt, uint32 voteCount, bool executed))",
  "function setCreatorRules(uint256 novelId, string[] names, string[] contents) external",
]);
