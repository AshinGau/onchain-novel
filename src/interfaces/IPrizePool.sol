// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IPrizePool
/// @notice Interface for prize pool management, tipping, and reward distribution
interface IPrizePool {
    // ============================================================
    //                          EVENTS
    // ============================================================

    event TipReceived(uint256 indexed novelId, address indexed tipper, uint256 amount, uint256 timestamp);
    event PoolDeposited(uint256 indexed novelId, uint256 amount, string reason);
    event RewardDistributed(uint256 indexed novelId, uint256 indexed epoch, uint256 totalAmount, uint256 authorCount);
    event RewardClaimed(uint256 indexed novelId, address indexed author, uint256 amount);

    // ============================================================
    //                     PUBLIC ACTIONS
    // ============================================================

    /// @notice Tip a novel to expand its prize pool
    /// @param novelId Novel ID to tip
    function tipNovel(uint256 novelId) external payable;

    /// @notice Claim pending rewards as an author
    /// @param novelId Novel ID
    function claimReward(uint256 novelId) external;

    // ============================================================
    //                  CALLED BY NOVELCORE
    // ============================================================

    /// @notice Deposit funds into the prize pool (genesis injection / slashed stakes)
    /// @param novelId Novel ID
    /// @param reason Description of the deposit source
    function deposit(uint256 novelId, string calldata reason) external payable;

    /// @notice Distribute epoch rewards to canon chapter authors
    /// @param novelId Novel ID
    /// @param epoch Epoch number for event tracking
    /// @param authors Array of author addresses for canon chapters
    /// @param releaseRate Release rate in basis points
    function distributeEpochRewards(uint256 novelId, uint32 epoch, address[] calldata authors, uint16 releaseRate)
        external;

    // ============================================================
    //                        QUERIES
    // ============================================================

    /// @notice Get current pool balance for a novel
    function getPoolBalance(uint256 novelId) external view returns (uint256);

    /// @notice Get pending (unclaimed) reward for an author
    function getPendingReward(uint256 novelId, address author) external view returns (uint256);

    /// @notice Get total tipped amount for a novel
    function getTotalTipped(uint256 novelId) external view returns (uint256);
}
