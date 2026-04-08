// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IPrizePool
/// @notice Interface for prize pool management, tipping, and reward distribution (V2)
/// @dev Handles per-round reward distribution with creator royalty decay.
///      Creator royalty formula: releaseAmount * CREATOR_DECAY_DIVISOR / (CREATOR_DECAY_DIVISOR + currentRound)
interface IPrizePool {
    // ============================================================
    //                          EVENTS
    // ============================================================

    /// @notice Emitted when funds are deposited into a novel's prize pool
    event PoolDeposited(uint64 indexed novelId, uint256 amount, string reason);

    /// @notice Emitted when per-round rewards are distributed
    event RoundRewardsDistributed(
        uint64 indexed novelId, uint32 round, uint256 creatorRoyalty, uint256 authorRewards, uint256 voterRewards
    );

    /// @notice Emitted when a novel receives a tip
    event TipReceived(uint64 indexed novelId, address indexed tipper, uint256 amount);

    /// @notice Emitted when a chapter receives a tip (50% to author, 50% to pool)
    event ChapterTipped(uint64 indexed novelId, uint64 indexed chapterId, address indexed tipper, uint256 amount);

    /// @notice Emitted when a user claims accumulated rewards
    event RewardClaimed(uint64 indexed novelId, address indexed recipient, uint256 amount);

    /// @notice Emitted when a keeper is rewarded for a state transition
    event KeeperRewardPaid(uint64 indexed novelId, address indexed keeper, uint256 amount);

    // ============================================================
    //                        CONSTANTS
    // ============================================================

    /// @notice Decay divisor for creator royalty: royalty = release * D / (D + round)
    /// @dev Set as a contract-level constant (3). Not configurable per novel.
    ///      Upgradeable via UUPS if adjustment needed.
    // uint256 constant CREATOR_DECAY_DIVISOR = 3;

    // ============================================================
    //                  CALLED BY NOVELCORE
    // ============================================================

    /// @notice Deposit funds into a novel's prize pool
    /// @param novelId The novel ID
    /// @param reason Description of deposit source (e.g. "submissionFee", "nominationFee", "forkFee")
    function deposit(uint64 novelId, string calldata reason) external payable;

    /// @notice Distribute per-round rewards from the prize pool
    /// @dev Splits release amount into creator royalty, author rewards, and voter rewards.
    ///      Creator royalty = release * CREATOR_DECAY_DIVISOR / (CREATOR_DECAY_DIVISOR + currentRound)
    ///      Author rewards credited to pendingRewards; voter rewards returned for VotingEngine.
    /// @param novelId The novel ID
    /// @param currentRound Current round number (for creator royalty decay)
    /// @param creator Novel creator address
    /// @param authors Array of author addresses to reward (de-duplicated new world-line chapters)
    /// @param releaseRate Prize release rate in basis points
    /// @param voterRewardRate Voter reward rate in basis points
    /// @return voterRewards Amount allocated to voter rewards (sent to VotingEngine)
    function distributeRoundRewards(
        uint64 novelId,
        uint32 currentRound,
        address creator,
        address[] calldata authors,
        uint16 releaseRate,
        uint16 voterRewardRate
    ) external returns (uint256 voterRewards);

    /// @notice Process a chapter tip: 50% to author, 50% to prize pool
    /// @dev If push to author fails, the failed portion also goes to prize pool
    /// @param chapterId The chapter ID being tipped
    /// @param author The chapter author address
    /// @param novelId The novel ID (for pool accounting)
    function tipChapter(uint64 chapterId, address author, uint64 novelId) external payable;

    /// @notice Pay keeper reward from a novel's prize pool
    /// @dev Credits amount to keeper's pendingRewards. Returns 0 if pool is insufficient.
    /// @param novelId The novel ID
    /// @param keeper The keeper address to reward
    /// @return amount The reward amount paid (0 if insufficient pool balance)
    function payKeeperReward(uint64 novelId, address keeper) external returns (uint256 amount);

    /// @notice Claim all pending rewards for a novel
    /// @param novelId The novel ID
    /// @param recipient The address to send rewards to
    /// @return amount Total amount claimed
    function claimReward(uint64 novelId, address recipient) external returns (uint256 amount);

    // ============================================================
    //                     PUBLIC ACTIONS
    // ============================================================

    /// @notice Tip a novel (full amount goes to prize pool)
    /// @param novelId The novel to tip
    function tipNovel(uint64 novelId) external payable;

    // ============================================================
    //                        QUERIES
    // ============================================================

    /// @notice Get the current prize pool balance for a novel
    function getPoolBalance(uint64 novelId) external view returns (uint256);

    /// @notice Get pending reward balance for an address
    function getPendingReward(uint64 novelId, address recipient) external view returns (uint256);
}
