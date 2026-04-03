// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IPrizePool} from "../interfaces/IPrizePool.sol";

/// @title PrizePool
/// @notice Manages prize pools for all novels: genesis deposits, tipping, epoch distribution, pull-based claims
contract PrizePool is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuard,
    PausableUpgradeable,
    UUPSUpgradeable,
    IPrizePool
{
    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Authorized NovelCore contract address
    address public novelCore;

    /// @notice Novel ID => current pool balance (available for distribution)
    mapping(uint256 => uint256) private _poolBalances;

    /// @notice Novel ID => total tipped amount (cumulative, for stats)
    mapping(uint256 => uint256) private _totalTipped;

    /// @notice Novel ID => address => pending reward (claimable)
    mapping(uint256 => mapping(address => uint256)) private _pendingRewards;

    /// @notice Minimum tip amount
    uint256 public constant MIN_TIP_AMOUNT = 0.001 ether;

    /// @notice Protocol fee rate in basis points (e.g., 500 = 5%), max 1000 (10%)
    uint16 public protocolFeeRate;

    /// @notice Protocol treasury address
    address public protocolTreasury;

    // ============================================================
    //                         ERRORS
    // ============================================================

    error OnlyNovelCore();
    error TipTooSmall(uint256 amount, uint256 minimum);
    error NoPendingReward();
    error TransferFailed();
    error NoAuthors();
    error ZeroAmount();
    error InvalidRate();

    // ============================================================
    //                        MODIFIERS
    // ============================================================

    modifier onlyNovelCore() {
        if (msg.sender != novelCore) revert OnlyNovelCore();
        _;
    }

    // ============================================================
    //                      INITIALIZER
    // ============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address novelCore_) external initializer {
        __Ownable_init(owner_);
        __Pausable_init();

        novelCore = novelCore_;
    }

    // ============================================================
    //                     ADMIN FUNCTIONS
    // ============================================================

    function setNovelCore(address newNovelCore) external onlyOwner {
        novelCore = newNovelCore;
    }

    /// @notice Set protocol fee rate (basis points, max 1000 = 10%)
    function setProtocolFeeRate(uint16 rate) external onlyOwner {
        if (rate > 1000) revert InvalidRate();
        protocolFeeRate = rate;
    }

    /// @notice Set protocol treasury address
    function setProtocolTreasury(address treasury) external onlyOwner {
        protocolTreasury = treasury;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============================================================
    //                     PUBLIC ACTIONS
    // ============================================================

    /// @inheritdoc IPrizePool
    function tipNovel(uint256 novelId) external payable whenNotPaused nonReentrant {
        if (msg.value < MIN_TIP_AMOUNT) revert TipTooSmall(msg.value, MIN_TIP_AMOUNT);

        _poolBalances[novelId] += msg.value;
        _totalTipped[novelId] += msg.value;

        emit TipReceived(novelId, msg.sender, msg.value, block.timestamp);
    }

    /// @inheritdoc IPrizePool
    function claimReward(uint256 novelId) external whenNotPaused nonReentrant {
        uint256 amount = _pendingRewards[novelId][msg.sender];
        if (amount == 0) revert NoPendingReward();

        // CEI: clear before transfer
        _pendingRewards[novelId][msg.sender] = 0;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit RewardClaimed(novelId, msg.sender, amount);
    }

    // ============================================================
    //                  CALLED BY NOVELCORE
    // ============================================================

    /// @inheritdoc IPrizePool
    function deposit(uint256 novelId, string calldata reason) external payable onlyNovelCore {
        if (msg.value == 0) revert ZeroAmount();

        _poolBalances[novelId] += msg.value;

        emit PoolDeposited(novelId, msg.value, reason);
    }

    /// @inheritdoc IPrizePool
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
    ) external onlyNovelCore returns (uint256 voterRewardPool) {
        if (authors.length == 0) revert NoAuthors();

        uint256 poolBalance = _poolBalances[novelId];
        if (poolBalance == 0) return 0;

        // Calculate epoch release amount
        uint256 totalRelease = (poolBalance * releaseRate) / 10000;
        if (totalRelease == 0) return 0;

        // === Layer 0: Protocol Fee ===
        uint256 protocolFee = 0;
        if (protocolFeeRate > 0 && protocolTreasury != address(0)) {
            protocolFee = (totalRelease * protocolFeeRate) / 10000;
            if (protocolFee > 0) {
                _pendingRewards[novelId][protocolTreasury] += protocolFee;
                totalRelease -= protocolFee;
            }
        }

        // === Layer 1: Creator Royalty ===
        // creatorRoyalty = totalRelease * 1 / (1 + C)
        // Fixed G=1 regardless of genesis count to prevent inflation exploit
        uint256 creatorRoyalty = 0;
        uint256 c = uint256(cumulativeCanonChapters);
        {
            creatorRoyalty = totalRelease / (1 + c);
            if (creatorRoyalty > 0) {
                _pendingRewards[novelId][creator] += creatorRoyalty;
                emit CreatorRoyaltyDistributed(novelId, epoch, creator, creatorRoyalty);
            }
        }

        uint256 remaining = totalRelease - creatorRoyalty;

        // === Layer 2: Author Rewards ===
        // authorPool = remaining * (10000 - voterRewardRate) / 10000
        uint256 authorPool = (remaining * (10000 - voterRewardRate)) / 10000;

        if (authorPool > 0) {
            uint256 perChapterReward = authorPool / authors.length;
            if (perChapterReward > 0) {
                for (uint256 i = 0; i < authors.length; i++) {
                    _pendingRewards[novelId][authors[i]] += perChapterReward;
                }
                // Adjust authorPool to actual distributed (handle rounding)
                authorPool = perChapterReward * authors.length;
            }
        }

        // === Layer 3: Voter Rewards ===
        voterRewardPool = remaining - authorPool;

        // Deduct total release + protocol fee from pool
        _poolBalances[novelId] -= (totalRelease + protocolFee);

        // Send voter reward ETH directly to VotingEngine
        if (voterRewardPool > 0) {
            (bool success,) = votingEngine.call{value: voterRewardPool}("");
            if (!success) revert TransferFailed();
        }

        emit RewardDistributed(novelId, epoch, totalRelease + protocolFee, authors.length);

        return voterRewardPool;
    }

    /// @inheritdoc IPrizePool
    function payKeeperReward(uint256 novelId, address keeper, uint256 amount)
        external
        onlyNovelCore
        returns (bool paid)
    {
        if (amount == 0 || _poolBalances[novelId] < amount) return false;

        _poolBalances[novelId] -= amount;
        _pendingRewards[novelId][keeper] += amount;

        emit KeeperRewardPaid(novelId, keeper, amount);
        return true;
    }

    // ============================================================
    //                        QUERIES
    // ============================================================

    /// @inheritdoc IPrizePool
    function getPoolBalance(uint256 novelId) external view returns (uint256) {
        return _poolBalances[novelId];
    }

    /// @inheritdoc IPrizePool
    function getPendingReward(uint256 novelId, address author) external view returns (uint256) {
        return _pendingRewards[novelId][author];
    }

    /// @inheritdoc IPrizePool
    function getTotalTipped(uint256 novelId) external view returns (uint256) {
        return _totalTipped[novelId];
    }

    // ============================================================
    //                     UUPS UPGRADE
    // ============================================================

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ============================================================
    //                    STORAGE GAP
    // ============================================================

    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;
}
