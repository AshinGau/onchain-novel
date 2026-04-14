// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DataTypes} from "../libraries/DataTypes.sol";

/// @title INovelCore
/// @notice Core interface for the Decentralized Novel Protocol
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

    /// @notice Emitted when a user claims prize pool rewards
    event RewardClaimed(uint64 indexed novelId, address indexed recipient, uint256 amount);

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
    //                     REWARDS
    // ============================================================

    /// @notice Claim accumulated prize pool rewards (creator royalty, author rewards)
    /// @param novelId The novel to claim rewards from
    function claimReward(uint64 novelId) external;

    // ============================================================
    //                      MANAGEMENT
    // ============================================================

    /// @notice Update novel metadata (only callable by novel creator)
    /// @param novelId The novel
    /// @param metadata New metadata values
    function updateNovelMetadata(uint64 novelId, DataTypes.NovelMetadata calldata metadata) external;

    // ============================================================
    //         PRIVILEGED SETTERS (callable by RoundManager only)
    // ============================================================

    /// @notice Increment currentRound and set the new round phase. Returns the new round number.
    function advanceRound(uint64 novelId, DataTypes.RoundPhase phase, uint64 phaseStartTime)
        external
        returns (uint32 newRound);

    /// @notice Set the round phase and phase start time without changing round number.
    function setNovelPhase(uint64 novelId, DataTypes.RoundPhase phase, uint64 phaseStartTime) external;

    /// @notice Apply round settlement: replace world line ancestors, refresh world-line author flags,
    ///         set lastSettleTime, and reset roundPhase.
    function applyWorldLineSettlement(
        uint64 novelId,
        uint64[] calldata newAncestors,
        uint64[] calldata prevAncestors,
        DataTypes.RoundPhase newPhase,
        uint64 settleTime
    ) external;

    /// @notice Mark a novel as inactive (called by completeNovel).
    function setNovelInactive(uint64 novelId) external;

    // ============================================================
    //                        QUERIES
    // ============================================================

    /// @notice Get the full novel state
    function getNovel(uint64 novelId) external view returns (DataTypes.Novel memory);

    /// @notice Get a chapter by its global ID
    function getChapter(uint64 chapterId) external view returns (DataTypes.Chapter memory);

    /// @notice Get current world line ancestor chapter IDs for a novel
    function getWorldLineAncestors(uint64 novelId) external view returns (uint64[] memory);

    /// @notice Get direct child chapter IDs for a chapter
    function getChapterChildren(uint64 chapterId) external view returns (uint64[] memory);

    /// @notice Check if an address is an author on the current world lines
    /// @dev Used by RulesEngine for rule proposal voting eligibility (auto-generated public mapping getter)
    function isWorldLineAuthor(uint64 novelId, address author) external view returns (bool);

    /// @notice Total number of novels created (auto-generated public counter getter)
    function novelCount() external view returns (uint64);

    /// @notice Total number of chapters across all novels (auto-generated public counter getter)
    function chapterCount() external view returns (uint64);

    /// @notice Get novel metadata
    function getNovelMetadata(uint64 novelId) external view returns (DataTypes.NovelMetadata memory);

}
