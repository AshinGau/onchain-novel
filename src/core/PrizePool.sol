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

    /// @notice Novel ID => author address => pending reward (claimable)
    mapping(uint256 => mapping(address => uint256)) private _pendingRewards;

    /// @notice Minimum tip amount
    uint256 public constant MIN_TIP_AMOUNT = 0.001 ether;

    // ============================================================
    //                         ERRORS
    // ============================================================

    error OnlyNovelCore();
    error TipTooSmall(uint256 amount, uint256 minimum);
    error NoPendingReward();
    error TransferFailed();
    error NoAuthors();
    error ZeroAmount();

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

    /// @notice Initialize the prize pool contract
    /// @param owner_ Initial owner address
    /// @param novelCore_ Authorized NovelCore contract address
    function initialize(address owner_, address novelCore_) external initializer {
        __Ownable_init(owner_);

        __Pausable_init();

        novelCore = novelCore_;
    }

    // ============================================================
    //                     ADMIN FUNCTIONS
    // ============================================================

    /// @notice Update the authorized NovelCore address
    function setNovelCore(address newNovelCore) external onlyOwner {
        novelCore = newNovelCore;
    }

    /// @notice Pause the contract (emergency)
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract
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
    function distributeEpochRewards(uint256 novelId, address[] calldata authors, uint16 releaseRate)
        external
        onlyNovelCore
    {
        if (authors.length == 0) revert NoAuthors();

        uint256 poolBalance = _poolBalances[novelId];
        if (poolBalance == 0) return; // No funds to distribute

        // Calculate epoch release amount: poolBalance * releaseRate / 10000
        uint256 totalRelease = (poolBalance * releaseRate) / 10000;
        if (totalRelease == 0) return;

        // Equal share per chapter (author may appear multiple times for multiple chapters)
        uint256 perChapterReward = totalRelease / authors.length;
        if (perChapterReward == 0) return;

        // Actual total distributed (may be slightly less than totalRelease due to rounding)
        uint256 actualDistributed = perChapterReward * authors.length;

        // Deduct from pool
        _poolBalances[novelId] -= actualDistributed;

        // Credit each author
        for (uint256 i = 0; i < authors.length; i++) {
            _pendingRewards[novelId][authors[i]] += perChapterReward;
        }

        emit RewardDistributed(novelId, 0, actualDistributed, authors.length);
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
}
