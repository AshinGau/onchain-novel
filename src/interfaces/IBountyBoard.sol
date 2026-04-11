// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DataTypes} from "../libraries/DataTypes.sol";

/// @title IBountyBoard
/// @notice Interface for the chapter continuation bounty system
/// @dev Readers place bounties on chapters to incentivize continuations.
///      20% of bounty goes to prize pool immediately; 80% locked for qualifying authors.
///      Qualifying authors = authors of **direct child chapters** of the target whose timestamp
///      is on or before the deadline (deeper descendants are not counted).
///      If no qualifying continuations by the deadline, the locked amount is refundable to the tipper.
interface IBountyBoard {
    // ============================================================
    //                          EVENTS
    // ============================================================

    /// @notice Emitted when a bounty is created
    event BountyCreated(
        uint256 indexed bountyId,
        uint64 indexed chapterId,
        address indexed tipper,
        uint256 lockedAmount,
        uint64 deadline
    );

    /// @notice Emitted when a qualifying author claims their share of a bounty
    event BountyClaimed(uint256 indexed bountyId, address indexed author, uint256 amount);

    /// @notice Emitted when the tipper designates a preferred continuation
    event BountyDesignated(uint256 indexed bountyId, uint64 indexed chapterId);

    /// @notice Emitted when a bounty is refunded to the tipper (no continuations before deadline)
    event BountyRefunded(uint256 indexed bountyId, address indexed tipper, uint256 amount);

    // ============================================================
    //                         ACTIONS
    // ============================================================

    /// @notice Create a bounty on a chapter to incentivize continuations
    /// @dev msg.value is the total bounty amount. 20% goes to prize pool, 80% locked.
    /// @param chapterId The target chapter ID to continue from
    /// @param deadline Timestamp by which continuations must be submitted
    /// @return bountyId The ID of the created bounty
    function createBounty(uint64 chapterId, uint64 deadline) external payable returns (uint256 bountyId);

    /// @notice Designate a preferred continuation for the bounty (tipper only, before deadline)
    /// @dev If designated, the full 80% goes to that chapter's author on claim.
    ///      If not designated by deadline, 80% is split equally among all qualifying authors.
    /// @param bountyId The bounty ID
    /// @param chapterId The preferred chapter (must be a direct child of the bounty target, submitted before deadline)
    function designateBounty(uint256 bountyId, uint64 chapterId) external;

    /// @notice Claim a share of a bounty as a qualifying author (deadline must have passed)
    /// @dev If tipper designated a chapter, only that chapter's author can claim the full amount.
    ///      Otherwise, locked amount is split equally among all qualifying authors.
    /// @param bountyId The bounty ID to claim from
    function claimBounty(uint256 bountyId) external;

    /// @notice Refund a bounty to the tipper (deadline passed, no qualifying continuations)
    /// @param bountyId The bounty ID to refund
    function refundBounty(uint256 bountyId) external;

    /// @notice Sweep unclaimed bounty shares back to tipper after grace period
    /// @dev Only callable by the tipper, after deadline + CLAIM_GRACE_PERIOD.
    ///      Prevents permanent fund lock when qualifying authors don't claim.
    /// @param bountyId The bounty ID to sweep
    function sweepUnclaimedBounty(uint256 bountyId) external;

    // ============================================================
    //                        QUERIES
    // ============================================================

    /// @notice Get the full bounty data
    function getBounty(uint256 bountyId) external view returns (DataTypes.Bounty memory);

    /// @notice Get all bounty IDs targeting a specific chapter
    function getBountiesForChapter(uint64 chapterId) external view returns (uint256[] memory);
}
