// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DataTypes} from "../libraries/DataTypes.sol";

/// @title INovelCore
/// @notice Core interface for the Decentralized Novel Protocol
interface INovelCore {
    // ============================================================
    //                          EVENTS
    // ============================================================

    event NovelCreated(uint256 indexed novelId, address indexed creator, uint32 genesisChapterCount);
    event NovelForked(uint256 indexed novelId, uint256 indexed sourceNovelId, uint256 sourceChapterId);
    event ChapterSubmitted(
        uint256 indexed novelId,
        uint256 indexed chapterId,
        address indexed author,
        uint256 parentId,
        uint32 chapterIndex
    );
    event RoundPhaseChanged(uint256 indexed novelId, uint32 round, DataTypes.RoundPhase phase);
    event EpochPhaseChanged(uint256 indexed novelId, uint32 epoch, DataTypes.EpochPhase phase);
    event WorldLinesSelected(uint256 indexed novelId, uint32 round, uint256[] selectedChapterIds);
    event CanonEstablished(uint256 indexed novelId, uint32 epoch, uint256 canonWorldLineId);
    event StakeRefunded(uint256 indexed novelId, address indexed author, uint256 amount);
    event StakeSlashed(uint256 indexed novelId, address indexed author, uint256 amount);
    event KeeperRewarded(uint256 indexed novelId, address indexed keeper, uint256 amount);
    event EarlyEpochTriggered(uint256 indexed novelId, uint32 epoch);
    event NovelCompleted(uint256 indexed novelId);
    event NovelMetadataUpdated(uint256 indexed novelId, string title, string description, string coverUri);

    // --- Rules events ---
    event RuleSet(uint256 indexed novelId, string name);
    event RuleDeleted(uint256 indexed novelId, string name);
    event RuleProposed(
        uint256 indexed proposalId, uint256 indexed novelId, address indexed proposer, uint8 proposalType, string ruleName
    );
    event RuleProposalVoted(uint256 indexed proposalId, address indexed voter, uint32 newVoteCount);
    event RuleProposalExecuted(uint256 indexed proposalId, uint256 indexed novelId);

    // ============================================================
    //                     NOVEL LIFECYCLE
    // ============================================================

    /// @notice Create a new novel with multi-chapter genesis and optional initial prize pool
    /// @param config Novel configuration parameters
    /// @param metadata Novel display metadata (title, description, cover)
    /// @param genesisChapters Array of content submissions for genesis chapters
    /// @return novelId The ID of the newly created novel
    function createNovel(
        DataTypes.NovelConfig calldata config,
        DataTypes.NovelMetadata calldata metadata,
        DataTypes.ContentSubmission[] calldata genesisChapters
    ) external payable returns (uint256 novelId);

    /// @notice Fork a novel from a rejected branch
    /// @param originalNovelId Source novel ID
    /// @param branchChapterId Chapter to fork from
    /// @param config Configuration for the new novel
    /// @return novelId The ID of the forked novel
    function forkNovel(
        uint256 originalNovelId,
        uint256 branchChapterId,
        DataTypes.NovelConfig calldata config,
        DataTypes.NovelMetadata calldata metadata
    ) external payable returns (uint256 novelId);

    // ============================================================
    //                   CHAPTER SUBMISSION
    // ============================================================

    /// @notice Submit a chapter continuation (requires stake deposit)
    function submitChapter(uint256 novelId, uint256 parentChapterId, DataTypes.ContentSubmission calldata submission)
        external
        payable
        returns (uint256 chapterId);

    // ============================================================
    //                  ROUND STATE TRANSITIONS
    // ============================================================

    /// @notice Close submission phase and enter voting (requires minDuration + minSubmissions)
    function closeSubmissions(uint256 novelId) external;

    /// @notice Close commit phase and enter reveal phase
    function closeCommit(uint256 novelId) external;

    /// @notice Close reveal phase and settle the round
    function settleRound(uint256 novelId) external;

    // ============================================================
    //                  EPOCH STATE TRANSITIONS
    // ============================================================

    /// @notice Close epoch commit phase
    function closeEpochCommit(uint256 novelId) external;

    /// @notice Close epoch reveal phase and settle the epoch
    function settleEpoch(uint256 novelId) external;

    /// @notice Owner triggers early epoch (skip remaining rounds)
    function triggerEarlyEpoch(uint256 novelId) external;

    /// @notice Deactivate a novel permanently
    function completeNovel(uint256 novelId) external;

    // ============================================================
    //                      STAKE CLAIMS
    // ============================================================

    /// @notice Claim refundable stake deposits
    function claimStakeRefund(uint256 novelId) external;

    // ============================================================
    //                        QUERIES
    // ============================================================

    function getNovel(uint256 novelId) external view returns (DataTypes.Novel memory);
    function getChapter(uint256 chapterId) external view returns (DataTypes.Chapter memory);
    function getActiveWorldLines(uint256 novelId) external view returns (uint256[] memory);
    function getRoundSubmissions(uint256 novelId, uint32 epoch, uint32 round) external view returns (uint256[] memory);
    function getNovelCount() external view returns (uint256);
    function getChapterCount() external view returns (uint256);
    function getClaimableStake(uint256 novelId, address author) external view returns (uint256);
    function getNovelMetadata(uint256 novelId) external view returns (DataTypes.NovelMetadata memory);

    // ============================================================
    //                    METADATA MANAGEMENT
    // ============================================================

    /// @notice Update novel metadata (only callable by novel creator)
    function updateNovelMetadata(uint256 novelId, DataTypes.NovelMetadata calldata metadata) external;

    // ============================================================
    //                         RULES
    // ============================================================

    /// @notice Set rules as the novel creator (only during epoch 1, no voting needed)
    function setCreatorRules(uint256 novelId, string[] calldata names, string[] calldata contents) external;

    /// @notice Propose adding or deleting a rule (requires fee, goes to prize pool)
    function proposeRule(
        uint256 novelId,
        DataTypes.RuleProposalType proposalType,
        string calldata ruleName,
        string calldata ruleContent
    ) external payable returns (uint256 proposalId);

    /// @notice Vote on a rule proposal (canon authors only)
    function voteOnRuleProposal(uint256 proposalId) external;

    // --- Rules queries ---
    function getRule(uint256 novelId, string calldata name) external view returns (string memory);
    function getRuleNames(uint256 novelId) external view returns (string[] memory);
    function getRuleProposal(uint256 proposalId) external view returns (DataTypes.RuleProposal memory);
    function isCanonAuthor(uint256 novelId, address author) external view returns (bool);
}
