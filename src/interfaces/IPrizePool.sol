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
    event CreatorRoyaltyDistributed(uint256 indexed novelId, uint256 indexed epoch, address creator, uint256 amount);
    event RewardClaimed(uint256 indexed novelId, address indexed author, uint256 amount);
    event KeeperRewardPaid(uint256 indexed novelId, address indexed keeper, uint256 amount);

    // ============================================================
    //                     PUBLIC ACTIONS
    // ============================================================

    /// @notice Tip a novel to expand its prize pool
    function tipNovel(uint256 novelId) external payable;

    /// @notice Claim pending rewards (creator royalty, author rewards, keeper rewards)
    function claimReward(uint256 novelId) external;

    // ============================================================
    //                  CALLED BY NOVELCORE
    // ============================================================

    /// @notice Deposit funds into the prize pool (genesis injection / slashed stakes)
    function deposit(uint256 novelId, string calldata reason) external payable;

    /// @notice Distribute epoch rewards with three-layer split:
    ///         1. Creator royalty (decaying)
    ///         2. Author rewards (equal per canon chapter)
    ///         3. Voter rewards (sent to votingEngine as ETH)
    /// @return voterRewardPool Amount sent to votingEngine for voter accuracy rewards
    function distributeEpochRewards(
        uint256 novelId,
        uint32 epoch,
        address creator,
        address[] calldata authors,
        uint16 releaseRate,
        uint32 genesisChapterCount,
        uint32 cumulativeCanonChapters,
        uint16 voterRewardRate,
        address payable votingEngine
    ) external returns (uint256 voterRewardPool);

    /// @notice Pay keeper reward from novel's prize pool (credited to _pendingRewards)
    /// @return paid Whether reward was paid (false if pool insufficient)
    function payKeeperReward(uint256 novelId, address keeper, uint256 amount) external returns (bool paid);

    // ============================================================
    //                        QUERIES
    // ============================================================

    function getPoolBalance(uint256 novelId) external view returns (uint256);
    function getPendingReward(uint256 novelId, address author) external view returns (uint256);
    function getTotalTipped(uint256 novelId) external view returns (uint256);
}
