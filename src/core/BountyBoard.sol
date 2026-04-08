// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IBountyBoard} from "../interfaces/IBountyBoard.sol";
import {INovelCore} from "../interfaces/INovelCore.sol";
import {IPrizePool} from "../interfaces/IPrizePool.sol";
import {DataTypes} from "../libraries/DataTypes.sol";

/// @title BountyBoard
/// @notice Chapter continuation bounty system: readers incentivize authors to continue specific chapters
/// @dev V2 standalone module. 20% of bounty goes to prize pool immediately; 80% locked for qualifying authors.
contract BountyBoard is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuard,
    PausableUpgradeable,
    UUPSUpgradeable,
    IBountyBoard
{
    // ============================================================
    //                        CONSTANTS
    // ============================================================

    /// @notice Minimum bounty amount
    uint256 public constant MIN_BOUNTY_AMOUNT = 0.001 ether;

    /// @notice Prize pool share in basis points (20%)
    uint256 private constant POOL_SHARE_BPS = 2000;

    /// @notice Basis points denominator
    uint256 private constant BPS_DENOMINATOR = 10000;

    /// @notice Grace period after deadline for authors to claim before tipper can sweep
    uint256 public constant CLAIM_GRACE_PERIOD = 30 days;

    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice NovelCore contract for reading chapter data
    INovelCore public novelCore;

    /// @notice PrizePool contract for depositing the 20% share
    IPrizePool public prizePool;

    /// @notice Total number of bounties created (used as incrementing ID)
    uint256 public bountyCount;

    /// @notice bountyId => Bounty data
    mapping(uint256 => DataTypes.Bounty) private _bounties;

    /// @notice bountyId => author => whether they have claimed their share
    mapping(uint256 => mapping(address => bool)) private _hasClaimed;

    /// @notice chapterId => array of bountyIds targeting that chapter
    mapping(uint64 => uint256[]) private _chapterBounties;

    // ============================================================
    //                         ERRORS
    // ============================================================

    error ChapterNotFound();
    error DeadlineInPast();
    error BountyTooSmall(uint256 amount, uint256 minimum);
    error DeadlineNotReached();
    error AlreadyClaimed();
    error BountyFullyClaimed();
    error NoQualifyingAuthors();
    error NotQualifyingAuthor();
    error NotTipper();
    error QualifyingAuthorsExist();
    error TransferFailed();
    error GracePeriodNotExpired();

    // ============================================================
    //                      INITIALIZER
    // ============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address novelCore_, address prizePool_) external initializer {
        __Ownable_init(owner_);
        __Pausable_init();
        novelCore = INovelCore(novelCore_);
        prizePool = IPrizePool(prizePool_);
    }

    // ============================================================
    //                     ADMIN FUNCTIONS
    // ============================================================

    function setNovelCore(address newNovelCore) external onlyOwner {
        novelCore = INovelCore(newNovelCore);
    }

    function setPrizePool(address newPrizePool) external onlyOwner {
        prizePool = IPrizePool(newPrizePool);
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

    /// @inheritdoc IBountyBoard
    function createBounty(uint64 chapterId, uint64 deadline)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256 bountyId)
    {
        if (msg.value < MIN_BOUNTY_AMOUNT) revert BountyTooSmall(msg.value, MIN_BOUNTY_AMOUNT);
        if (deadline <= block.timestamp) revert DeadlineInPast();

        // Validate chapter exists by reading it from NovelCore
        DataTypes.Chapter memory chapter = novelCore.getChapter(chapterId);
        if (chapter.id == 0) revert ChapterNotFound();

        // Calculate shares: 20% to prize pool, 80% locked
        uint256 poolShare = (msg.value * POOL_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 lockedAmount = msg.value - poolShare;

        // Deposit 20% to prize pool for the chapter's novel
        prizePool.deposit{value: poolShare}(chapter.novelId, "bounty");

        // Store bounty
        bountyId = bountyCount++;
        _bounties[bountyId] = DataTypes.Bounty({
            chapterId: chapterId,
            tipper: msg.sender,
            lockedAmount: lockedAmount,
            deadline: deadline,
            claimed: false
        });

        _chapterBounties[chapterId].push(bountyId);

        emit BountyCreated(bountyId, chapterId, msg.sender, lockedAmount, deadline);
    }

    /// @inheritdoc IBountyBoard
    function claimBounty(uint256 bountyId) external whenNotPaused nonReentrant {
        DataTypes.Bounty storage bounty = _bounties[bountyId];
        if (block.timestamp <= bounty.deadline) revert DeadlineNotReached();
        if (bounty.claimed) revert BountyFullyClaimed();
        if (_hasClaimed[bountyId][msg.sender]) revert AlreadyClaimed();

        // Get qualifying authors: descendants with timestamp <= deadline
        (address[] memory qualifyingAuthors, uint256 qualifyingCount) = _getQualifyingAuthors(bountyId);
        if (qualifyingCount == 0) revert NoQualifyingAuthors();

        // Check msg.sender is a qualifying author
        bool isQualifying = false;
        for (uint256 i = 0; i < qualifyingCount; i++) {
            if (qualifyingAuthors[i] == msg.sender) {
                isQualifying = true;
                break;
            }
        }
        if (!isQualifying) revert NotQualifyingAuthor();

        // Calculate equal share
        uint256 share = bounty.lockedAmount / qualifyingCount;

        // Mark claimed before transfer (CEI)
        _hasClaimed[bountyId][msg.sender] = true;

        // Check if all qualifying authors have now claimed
        bool allClaimed = true;
        for (uint256 i = 0; i < qualifyingCount; i++) {
            if (!_hasClaimed[bountyId][qualifyingAuthors[i]]) {
                allClaimed = false;
                break;
            }
        }
        if (allClaimed) {
            bounty.claimed = true;
            // Last claimer receives remainder (rounding dust)
            share = bounty.lockedAmount - (share * (qualifyingCount - 1));
        }

        // Transfer share to author
        (bool success,) = msg.sender.call{value: share}("");
        if (!success) revert TransferFailed();

        emit BountyClaimed(bountyId, msg.sender, share);
    }

    /// @inheritdoc IBountyBoard
    function refundBounty(uint256 bountyId) external whenNotPaused nonReentrant {
        DataTypes.Bounty storage bounty = _bounties[bountyId];
        if (block.timestamp <= bounty.deadline) revert DeadlineNotReached();
        if (bounty.claimed) revert BountyFullyClaimed();
        if (msg.sender != bounty.tipper) revert NotTipper();

        // Verify no qualifying descendants exist
        (, uint256 qualifyingCount) = _getQualifyingAuthors(bountyId);
        if (qualifyingCount > 0) revert QualifyingAuthorsExist();

        // Mark as claimed before transfer (CEI)
        uint256 refundAmount = bounty.lockedAmount;
        bounty.claimed = true;

        // Transfer locked amount back to tipper
        (bool success,) = msg.sender.call{value: refundAmount}("");
        if (!success) revert TransferFailed();

        emit BountyRefunded(bountyId, msg.sender, refundAmount);
    }

    /// @inheritdoc IBountyBoard
    function sweepUnclaimedBounty(uint256 bountyId) external whenNotPaused nonReentrant {
        DataTypes.Bounty storage bounty = _bounties[bountyId];
        if (bounty.claimed) revert BountyFullyClaimed();
        if (msg.sender != bounty.tipper) revert NotTipper();
        if (block.timestamp <= bounty.deadline + CLAIM_GRACE_PERIOD) revert GracePeriodNotExpired();

        // Calculate how much has been claimed already
        (address[] memory qualifyingAuthors, uint256 qualifyingCount) = _getQualifyingAuthors(bountyId);

        uint256 remaining;
        if (qualifyingCount == 0) {
            // No qualifying authors — full refund (same as refundBounty but after grace period)
            remaining = bounty.lockedAmount;
        } else {
            uint256 perShare = bounty.lockedAmount / qualifyingCount;
            uint256 totalClaimed = 0;
            for (uint256 i = 0; i < qualifyingCount; i++) {
                if (_hasClaimed[bountyId][qualifyingAuthors[i]]) {
                    totalClaimed += perShare;
                }
            }
            remaining = bounty.lockedAmount - totalClaimed;
        }

        bounty.claimed = true;

        if (remaining > 0) {
            (bool success,) = msg.sender.call{value: remaining}("");
            if (!success) revert TransferFailed();
        }

        emit BountyRefunded(bountyId, msg.sender, remaining);
    }

    // ============================================================
    //                        QUERIES
    // ============================================================

    /// @inheritdoc IBountyBoard
    function getBounty(uint256 bountyId) external view returns (DataTypes.Bounty memory) {
        return _bounties[bountyId];
    }

    /// @inheritdoc IBountyBoard
    function getBountiesForChapter(uint64 chapterId) external view returns (uint256[] memory) {
        return _chapterBounties[chapterId];
    }

    // ============================================================
    //                    INTERNAL HELPERS
    // ============================================================

    /// @dev Get unique qualifying authors for a bounty (descendants with timestamp <= deadline)
    /// @return authors Array of unique qualifying author addresses (may have trailing zero addresses)
    /// @return count Number of unique qualifying authors
    function _getQualifyingAuthors(uint256 bountyId) internal view returns (address[] memory authors, uint256 count) {
        DataTypes.Bounty storage bounty = _bounties[bountyId];
        uint64[] memory descendants = novelCore.getChapterDescendants(bounty.chapterId);

        // First pass: collect qualifying authors (may contain duplicates)
        address[] memory raw = new address[](descendants.length);
        uint256 rawCount = 0;

        for (uint256 i = 0; i < descendants.length; i++) {
            DataTypes.Chapter memory desc = novelCore.getChapter(descendants[i]);
            if (desc.timestamp <= bounty.deadline) {
                raw[rawCount++] = desc.author;
            }
        }

        // Second pass: deduplicate
        authors = new address[](rawCount);
        count = 0;

        for (uint256 i = 0; i < rawCount; i++) {
            bool duplicate = false;
            for (uint256 j = 0; j < count; j++) {
                if (authors[j] == raw[i]) {
                    duplicate = true;
                    break;
                }
            }
            if (!duplicate) {
                authors[count++] = raw[i];
            }
        }
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
