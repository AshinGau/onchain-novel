// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IPrizePool} from "../interfaces/IPrizePool.sol";
import {INovelCore} from "../interfaces/INovelCore.sol";
import {DataTypes} from "../libraries/DataTypes.sol";

/// @title PrizePool
/// @notice Manages prize pools for all novels: deposits, tipping, per-round reward distribution, pull-based claims
/// @dev Per-round distribution with creator royalty decay, no protocol fee, no epoch logic
contract PrizePool is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuard,
    PausableUpgradeable,
    UUPSUpgradeable,
    IPrizePool
{
    // ============================================================
    //                        CONSTANTS
    // ============================================================

    /// @notice Decay divisor for creator royalty: royalty = release * D / (D + round)
    uint256 public constant CREATOR_DECAY_DIVISOR = 3;

    /// @notice Minimum tip amount
    uint256 public constant MIN_TIP_AMOUNT = 0.001 ether;

    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Authorized NovelCore contract address (can deposit on novel/chapter creation)
    address public novelCore;

    /// @notice Authorized RoundManager contract address (settles rounds, pays keepers)
    address public roundManager;

    /// @notice Authorized RulesEngine contract address (can deposit rule fees)
    address public rulesEngine;

    /// @notice Authorized BountyBoard contract address (can deposit bounty pool share)
    address public bountyBoard;

    /// @notice Keeper reward amount per state-transition call
    uint256 public keeperRewardAmount;

    /// @notice Novel ID => current pool balance (available for distribution)
    mapping(uint64 => uint256) private _poolBalances;

    /// @notice Novel ID => address => pending reward (claimable)
    mapping(uint64 => mapping(address => uint256)) private _pendingRewards;

    // ============================================================
    //                         ERRORS
    // ============================================================

    error OnlyNovelCore();
    error OnlyRoundManager();
    error TipTooSmall(uint256 amount, uint256 minimum);
    error NoPendingReward();
    error TransferFailed();
    error NoAuthors();
    error ZeroAmount();
    error ChapterNotFound(uint64 chapterId);

    // ============================================================
    //                        MODIFIERS
    // ============================================================

    modifier onlyNovelCore() {
        if (msg.sender != novelCore) revert OnlyNovelCore();
        _;
    }

    modifier onlyRoundManager() {
        if (msg.sender != roundManager) revert OnlyRoundManager();
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

    event NovelCoreUpdated(address indexed oldAddr, address indexed newAddr);
    event RoundManagerUpdated(address indexed oldAddr, address indexed newAddr);
    event RulesEngineUpdated(address indexed oldAddr, address indexed newAddr);
    event BountyBoardUpdated(address indexed oldAddr, address indexed newAddr);
    event KeeperRewardAmountUpdated(uint256 oldAmount, uint256 newAmount);

    function setNovelCore(address newNovelCore) external onlyOwner {
        address old = novelCore;
        novelCore = newNovelCore;
        emit NovelCoreUpdated(old, newNovelCore);
    }

    function setRoundManager(address newRoundManager) external onlyOwner {
        address old = roundManager;
        roundManager = newRoundManager;
        emit RoundManagerUpdated(old, newRoundManager);
    }

    function setRulesEngine(address newRulesEngine) external onlyOwner {
        address old = rulesEngine;
        rulesEngine = newRulesEngine;
        emit RulesEngineUpdated(old, newRulesEngine);
    }

    function setBountyBoard(address newBountyBoard) external onlyOwner {
        address old = bountyBoard;
        bountyBoard = newBountyBoard;
        emit BountyBoardUpdated(old, newBountyBoard);
    }

    function setKeeperRewardAmount(uint256 amount) external onlyOwner {
        uint256 old = keeperRewardAmount;
        keeperRewardAmount = amount;
        emit KeeperRewardAmountUpdated(old, amount);
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
    function tipNovel(uint64 novelId) external payable whenNotPaused nonReentrant {
        if (msg.value < MIN_TIP_AMOUNT) revert TipTooSmall(msg.value, MIN_TIP_AMOUNT);

        _poolBalances[novelId] += msg.value;

        emit TipReceived(novelId, msg.sender, msg.value);
    }

    /// @inheritdoc IPrizePool
    function tipChapter(uint64 chapterId) external payable whenNotPaused nonReentrant {
        if (msg.value < MIN_TIP_AMOUNT) revert TipTooSmall(msg.value, MIN_TIP_AMOUNT);

        DataTypes.Chapter memory ch = INovelCore(novelCore).getChapter(chapterId);
        if (ch.id == 0) revert ChapterNotFound(chapterId);
        address author = ch.author;
        uint64 novelId = ch.novelId;

        uint256 authorShare = msg.value / 2;

        // Push 50% to author; if push fails, 100% goes to pool
        (bool success,) = author.call{value: authorShare}("");
        if (!success) {
            _poolBalances[novelId] += msg.value;
        } else {
            _poolBalances[novelId] += msg.value - authorShare;
        }

        emit ChapterTipped(novelId, chapterId, msg.sender, msg.value);
    }

    /// @inheritdoc IPrizePool
    function claimReward(uint64 novelId, address recipient)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 amount)
    {
        amount = _pendingRewards[novelId][recipient];
        if (amount == 0) revert NoPendingReward();

        // CEI: clear before transfer
        _pendingRewards[novelId][recipient] = 0;

        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit RewardClaimed(novelId, recipient, amount);
    }

    // ============================================================
    //                  CALLED BY NOVELCORE / RULESENGINE
    // ============================================================

    /// @inheritdoc IPrizePool
    function deposit(uint64 novelId, string calldata reason) external payable {
        if (
            msg.sender != novelCore && msg.sender != roundManager && msg.sender != rulesEngine
                && msg.sender != bountyBoard
        ) revert OnlyNovelCore();
        if (msg.value == 0) revert ZeroAmount();

        _poolBalances[novelId] += msg.value;

        emit PoolDeposited(novelId, msg.value, reason);
    }

    /// @inheritdoc IPrizePool
    function distributeRoundRewards(
        uint64 novelId,
        uint32 currentRound,
        address creator,
        address[] calldata authors,
        uint16 releaseRate,
        uint16 voterRewardRate
    ) external onlyRoundManager returns (uint256 voterRewards) {
        if (authors.length == 0) revert NoAuthors();

        uint256 poolBalance = _poolBalances[novelId];
        if (poolBalance == 0) return 0;

        // Calculate round release amount
        uint256 releaseAmount = (poolBalance * releaseRate) / 10000;
        if (releaseAmount == 0) return 0;

        // === Creator Royalty (decaying) ===
        // creatorRoyalty = releaseAmount * D / (D + currentRound)
        uint256 creatorRoyalty = (releaseAmount * CREATOR_DECAY_DIVISOR) / (CREATOR_DECAY_DIVISOR + currentRound);
        if (creatorRoyalty > 0) {
            _pendingRewards[novelId][creator] += creatorRoyalty;
        }

        uint256 remaining = releaseAmount - creatorRoyalty;

        // === Author Rewards ===
        uint256 authorRewards = (remaining * (10000 - voterRewardRate)) / 10000;

        if (authorRewards > 0) {
            uint256 perAuthorReward = authorRewards / authors.length;
            if (perAuthorReward > 0) {
                for (uint256 i = 0; i < authors.length; i++) {
                    _pendingRewards[novelId][authors[i]] += perAuthorReward;
                }
            }
            // Adjust to actual distributed amount (handle rounding dust and perAuthorReward==0 case)
            authorRewards = perAuthorReward * authors.length;
        }

        // === Voter Rewards ===
        voterRewards = remaining - authorRewards;

        // Deduct release from pool
        _poolBalances[novelId] -= releaseAmount;

        // Transfer voterRewards ETH to caller (NovelCore) for forwarding to VotingEngine
        if (voterRewards > 0) {
            (bool success,) = msg.sender.call{value: voterRewards}("");
            if (!success) revert TransferFailed();
        }

        emit RoundRewardsDistributed(novelId, currentRound, creatorRoyalty, authorRewards, voterRewards);

        return voterRewards;
    }

    /// @inheritdoc IPrizePool
    function payKeeperReward(uint64 novelId, address keeper) external onlyRoundManager returns (uint256 amount) {
        amount = keeperRewardAmount;
        if (amount == 0 || _poolBalances[novelId] < amount) return 0;

        _poolBalances[novelId] -= amount;
        _pendingRewards[novelId][keeper] += amount;

        emit KeeperRewardPaid(novelId, keeper, amount);
    }

    // ============================================================
    //                        QUERIES
    // ============================================================

    /// @inheritdoc IPrizePool
    function getPoolBalance(uint64 novelId) external view returns (uint256) {
        return _poolBalances[novelId];
    }

    /// @inheritdoc IPrizePool
    function getPendingReward(uint64 novelId, address recipient) external view returns (uint256) {
        return _pendingRewards[novelId][recipient];
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
