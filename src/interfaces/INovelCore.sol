// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DataTypes} from "../libraries/DataTypes.sol";

/// @title INovelCore
/// @notice Core interface for the Decentralized Novel Protocol V2
/// @dev Writing is always-on; voting is periodic and decoupled from chapter submission
interface INovelCore {
    // ============================================================
    //                          EVENTS
    // ============================================================

    /// @notice Emitted when a new novel is created
    event NovelCreated(uint64 indexed novelId, address indexed creator);

    /// @notice Emitted when a novel is forked from an existing chapter
    event NovelForked(uint64 indexed novelId, uint64 indexed sourceChapterId, address indexed creator);

    /// @notice Emitted when a chapter is submitted (including root chapters)
    event ChapterSubmitted(
        uint64 indexed novelId, uint64 indexed chapterId, address indexed author, uint64 parentId, uint32 depth
    );

    /// @notice Emitted when a new voting round starts (DFS candidates generated)
    event RoundStarted(uint64 indexed novelId, uint32 round, uint64[] candidates);

    /// @notice Emitted when the nomination phase closes and commit phase begins
    event NominationClosed(uint64 indexed novelId, uint32 round);

    /// @notice Emitted when the commit phase closes and reveal phase begins
    event CommitClosed(uint64 indexed novelId, uint32 round);

    /// @notice Emitted when a round is settled and world lines are updated
    event RoundSettled(uint64 indexed novelId, uint32 round, uint64[] worldLines);

    /// @notice Emitted when a vote is committed
    event VoteCommitted(uint64 indexed novelId, uint32 round, address indexed voter);

    /// @notice Emitted when a vote is revealed
    event VoteRevealed(uint64 indexed novelId, uint32 round, address indexed voter, uint64 candidateId);

    /// @notice Emitted when a user claims accumulated rewards
    event RewardClaimed(uint64 indexed novelId, address indexed recipient, uint256 amount);

    /// @notice Emitted when a novel is permanently completed
    event NovelCompleted(uint64 indexed novelId);

    /// @notice Emitted when a novel or chapter receives a tip
    event Tipped(uint64 indexed novelId, uint64 indexed chapterId, address indexed tipper, uint256 amount);

    /// @notice Emitted when a candidate is nominated during Nominating phase
    event CandidateNominated(uint64 indexed novelId, uint32 round, uint64 chapterId, address nominator);

    /// @notice Emitted when a keeper receives a reward for state transition
    event KeeperRewarded(uint64 indexed novelId, address indexed keeper, uint256 amount);

    /// @notice Emitted when novel metadata is updated
    event NovelMetadataUpdated(uint64 indexed novelId, string title, string description, string coverUri);

    // ============================================================
    //                     NOVEL LIFECYCLE
    // ============================================================

    /// @notice Create a new novel with a single root chapter
    /// @param config Novel configuration parameters
    /// @param metadata Novel display metadata (title, description, cover)
    /// @param rootChapter Content submission for the root chapter (depth = 1, parentId = 0)
    /// @return novelId The ID of the newly created novel
    function createNovel(
        DataTypes.NovelConfig calldata config,
        DataTypes.NovelMetadata calldata metadata,
        DataTypes.ContentSubmission calldata rootChapter
    ) external payable returns (uint64 novelId);

    /// @notice Fork from an existing novel's chapter, creating a new novel with fresh root content
    /// @param sourceChapterId Chapter ID in the source novel to fork from
    /// @param config Configuration for the new novel (contentLocation inherited from source)
    /// @param metadata Novel display metadata
    /// @param rootChapter Content submission for the fork root (new content, not a copy)
    /// @return novelId The ID of the forked novel
    function forkNovel(
        uint64 sourceChapterId,
        DataTypes.NovelConfig calldata config,
        DataTypes.NovelMetadata calldata metadata,
        DataTypes.ContentSubmission calldata rootChapter
    ) external payable returns (uint64 novelId);

    // ============================================================
    //                   CHAPTER SUBMISSION
    // ============================================================

    /// @notice Submit a chapter continuation (callable anytime while novel is active)
    /// @dev Requires msg.value >= submissionFee. Fee goes to prize pool.
    /// @param novelId The novel to submit to
    /// @param parentId Parent chapter ID within this novel
    /// @param submission Content submission payload
    function submitChapter(uint64 novelId, uint64 parentId, DataTypes.ContentSubmission calldata submission)
        external
        payable;

    // ============================================================
    //                  ROUND STATE TRANSITIONS
    // ============================================================

    /// @notice Start a new voting round (keeper-driven)
    /// @dev Performs DFS from worldLineAncestors to generate candidate set.
    ///      Requires: minRoundGap elapsed since last settle, DFS finds >= 1 candidate.
    /// @param novelId The novel to start a round for
    function startRound(uint64 novelId) external;

    /// @notice Close nomination phase and enter commit phase
    /// @dev Requires: nominateDuration has elapsed
    /// @param novelId The novel
    function closeNomination(uint64 novelId) external;

    /// @notice Close commit phase and enter reveal phase
    /// @dev Requires: commitDuration has elapsed
    /// @param novelId The novel
    function closeCommit(uint64 novelId) external;

    /// @notice Settle the round: tally votes, select world lines, distribute rewards
    /// @dev Requires: revealDuration has elapsed. Returns to Idle phase.
    /// @param novelId The novel
    function settleRound(uint64 novelId) external;

    // ============================================================
    //                   NOMINATION & VOTING
    // ============================================================

    /// @notice Nominate an additional candidate chain during Nominating phase
    /// @dev Requires msg.value >= nominationFee. Fee goes to prize pool.
    /// @param novelId The novel
    /// @param chapterId The chapter ID representing the chain to nominate
    function nominateCandidate(uint64 novelId, uint64 chapterId) external payable;

    /// @notice Submit an encrypted vote commitment during Committing phase
    /// @dev commitHash = keccak256(abi.encodePacked(candidateId, salt)).
    ///      Requires msg.value >= voteStake. One vote per address per round.
    /// @param novelId The novel
    /// @param commitHash The encrypted vote hash
    function commitVote(uint64 novelId, bytes32 commitHash) external payable;

    /// @notice Reveal a previously committed vote during Revealing phase
    /// @param novelId The novel
    /// @param candidateId The chapter ID voted for
    /// @param salt The salt used in the commit hash
    function revealVote(uint64 novelId, uint64 candidateId, bytes32 salt) external;

    // ============================================================
    //                     REWARDS & TIPS
    // ============================================================

    /// @notice Claim accumulated rewards (creator royalty, author rewards, keeper rewards)
    /// @param novelId The novel to claim rewards from
    function claimReward(uint64 novelId) external;

    /// @notice Tip a novel (full amount goes to prize pool)
    /// @param novelId The novel to tip
    function tipNovel(uint64 novelId) external payable;

    /// @notice Tip a specific chapter (50% to author, 50% to prize pool)
    /// @param chapterId The chapter to tip
    function tipChapter(uint64 chapterId) external payable;

    // ============================================================
    //                      MANAGEMENT
    // ============================================================

    /// @notice Permanently complete a novel (creator anytime, anyone after inactivity timeout)
    /// @param novelId The novel to complete
    function completeNovel(uint64 novelId) external;

    /// @notice Update novel metadata (only callable by novel creator)
    /// @param novelId The novel
    /// @param metadata New metadata values
    function updateNovelMetadata(uint64 novelId, DataTypes.NovelMetadata calldata metadata) external;

    // ============================================================
    //                        QUERIES
    // ============================================================

    /// @notice Get the full novel state
    function getNovel(uint64 novelId) external view returns (DataTypes.Novel memory);

    /// @notice Get a chapter by its global ID
    function getChapter(uint64 chapterId) external view returns (DataTypes.Chapter memory);

    /// @notice Get current world line ancestor chapter IDs for a novel
    function getWorldLineAncestors(uint64 novelId) external view returns (uint64[] memory);

    /// @notice Get round data for a specific round
    function getRoundData(uint64 novelId, uint32 round) external view returns (DataTypes.RoundData memory);

    /// @notice Get descendant chapter IDs for a chapter
    function getChapterDescendants(uint64 chapterId) external view returns (uint64[] memory);

    /// @notice Check if an address is an author on the current world lines
    /// @dev Used by RulesEngine for rule proposal voting eligibility
    function isWorldLineAuthor(uint64 novelId, address author) external view returns (bool);

    /// @notice Get the total number of novels created
    function getNovelCount() external view returns (uint64);

    /// @notice Get the total number of chapters across all novels
    function getChapterCount() external view returns (uint64);

    /// @notice Get novel metadata
    function getNovelMetadata(uint64 novelId) external view returns (DataTypes.NovelMetadata memory);
}
