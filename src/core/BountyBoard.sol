// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IBountyBoard} from "../interfaces/IBountyBoard.sol";
import {INovelCore} from "../interfaces/INovelCore.sol";
import {IPrizePool} from "../interfaces/IPrizePool.sol";
import {DataTypes} from "../libraries/DataTypes.sol";

/// @title BountyBoard
/// @notice Chapter continuation bounty system: readers incentivize authors to continue specific chapters
/// @dev Standalone module. 20% of bounty goes to prize pool immediately; 80% locked for qualifying authors.
///      Qualifying authors are the authors of **direct child chapters** of the bounty target whose
///      timestamp is on or before the deadline. Deeper descendants are not counted.
contract BountyBoard is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardTransient,
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
    uint64 public bountyCount;

    /// @notice bountyId => Bounty data
    mapping(uint64 => DataTypes.Bounty) private _bounties;

    /// @notice bountyId => author => whether they have claimed their share
    mapping(uint64 => mapping(address => bool)) private _hasClaimed;

    /// @notice chapterId => array of bountyIds targeting that chapter
    mapping(uint64 => uint64[]) private _chapterBounties;

    // ============================================================
    //                         ERRORS
    // ============================================================

    error ChapterNotFound();
    error DeadlineInPast();
    error DeadlineReached();
    error BountyTooSmall(uint256 amount, uint256 minimum);
    error DeadlineNotReached();
    error AlreadyClaimed();
    error BountyFullyClaimed();
    error NoQualifyingAuthors();
    error NotQualifyingAuthor();
    error NotDesignatedAuthor();
    error NotTipper();
    error NotDirectChild();
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
        returns (uint64 bountyId)
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
        uint64 createTime = uint64(block.timestamp);
        _bounties[bountyId] = DataTypes.Bounty({
            chapterId: chapterId,
            tipper: msg.sender,
            lockedAmount: lockedAmount,
            createTime: createTime,
            deadline: deadline,
            designatedChapterId: 0,
            claimed: false
        });

        _chapterBounties[chapterId].push(bountyId);

        emit BountyCreated(bountyId, chapterId, msg.sender, lockedAmount, createTime, deadline);
    }

    /// @inheritdoc IBountyBoard
    function designateBounty(uint64 bountyId, uint64 chapterId) external whenNotPaused {
        DataTypes.Bounty storage bounty = _bounties[bountyId];
        if (msg.sender != bounty.tipper) revert NotTipper();
        if (block.timestamp > bounty.deadline) revert DeadlineReached();

        // Verify chapterId is a direct child of the bounty target AND was submitted within
        // the bounty window — same eligibility rule as _getQualifyingAuthors, so designated
        // path cannot reward pre-existing children the bounty never incentivized.
        DataTypes.Chapter memory child = novelCore.getChapter(chapterId);
        if (child.id == 0) revert ChapterNotFound();
        if (child.parentId != bounty.chapterId) revert NotDirectChild();
        if (child.timestamp < bounty.createTime || child.timestamp > bounty.deadline) revert NotDirectChild();

        bounty.designatedChapterId = chapterId;

        emit BountyDesignated(bountyId, chapterId);
    }

    /// @inheritdoc IBountyBoard
    function claimBounty(uint64 bountyId) external whenNotPaused nonReentrant {
        DataTypes.Bounty storage bounty = _bounties[bountyId];
        if (block.timestamp <= bounty.deadline) revert DeadlineNotReached();
        if (bounty.claimed) revert BountyFullyClaimed();
        if (_hasClaimed[bountyId][msg.sender]) revert AlreadyClaimed();

        // Designated path: full amount to the designated chapter's author
        if (bounty.designatedChapterId != 0) {
            DataTypes.Chapter memory designated = novelCore.getChapter(bounty.designatedChapterId);
            if (msg.sender != designated.author) revert NotDesignatedAuthor();

            _hasClaimed[bountyId][msg.sender] = true;
            bounty.claimed = true;

            _transferETH(msg.sender, bounty.lockedAmount);

            emit BountyClaimed(bountyId, msg.sender, bounty.lockedAmount);
            return;
        }

        // Non-designated path: split equally among qualifying authors
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
        _transferETH(msg.sender, share);

        emit BountyClaimed(bountyId, msg.sender, share);
    }

    /// @inheritdoc IBountyBoard
    function refundBounty(uint64 bountyId) external whenNotPaused nonReentrant {
        DataTypes.Bounty storage bounty = _bounties[bountyId];
        if (block.timestamp <= bounty.deadline) revert DeadlineNotReached();
        if (bounty.claimed) revert BountyFullyClaimed();
        if (msg.sender != bounty.tipper) revert NotTipper();

        // Verify no qualifying children exist
        (, uint256 qualifyingCount) = _getQualifyingAuthors(bountyId);
        if (qualifyingCount > 0) revert QualifyingAuthorsExist();

        // Mark as claimed before transfer (CEI)
        uint256 refundAmount = bounty.lockedAmount;
        bounty.claimed = true;

        _transferETH(msg.sender, refundAmount);

        emit BountyRefunded(bountyId, msg.sender, refundAmount);
    }

    /// @inheritdoc IBountyBoard
    function sweepUnclaimedBounty(uint64 bountyId) external whenNotPaused nonReentrant {
        DataTypes.Bounty storage bounty = _bounties[bountyId];
        if (bounty.claimed) revert BountyFullyClaimed();
        if (msg.sender != bounty.tipper) revert NotTipper();
        if (block.timestamp <= bounty.deadline + CLAIM_GRACE_PERIOD) revert GracePeriodNotExpired();

        // Calculate how much has been claimed already
        (address[] memory qualifyingAuthors, uint256 qualifyingCount) = _getQualifyingAuthors(bountyId);

        uint256 remaining;
        if (qualifyingCount == 0) {
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
            _transferETH(msg.sender, remaining);
        }

        emit BountyRefunded(bountyId, msg.sender, remaining);
    }

    // ============================================================
    //                        QUERIES
    // ============================================================

    /// @inheritdoc IBountyBoard
    function getBounty(uint64 bountyId) external view returns (DataTypes.Bounty memory) {
        return _bounties[bountyId];
    }

    /// @inheritdoc IBountyBoard
    function getBountiesForChapter(uint64 chapterId) external view returns (uint64[] memory) {
        return _chapterBounties[chapterId];
    }

    // ============================================================
    //                    INTERNAL HELPERS
    // ============================================================

    /// @dev Get unique qualifying authors for a bounty (direct children with timestamp <= deadline)
    /// @return authors Array of unique qualifying author addresses (may have trailing zero addresses)
    /// @return count Number of unique qualifying authors
    function _getQualifyingAuthors(uint64 bountyId) internal view returns (address[] memory authors, uint256 count) {
        DataTypes.Bounty storage bounty = _bounties[bountyId];
        uint64[] memory children = novelCore.getChapterChildren(bounty.chapterId);

        // First pass: collect qualifying authors (may contain duplicates)
        address[] memory raw = new address[](children.length);
        uint256 rawCount = 0;

        for (uint256 i = 0; i < children.length; i++) {
            DataTypes.Chapter memory child = novelCore.getChapter(children[i]);
            // Only chapters submitted within [createTime, deadline] qualify.
            // Pre-existing children (written before the bounty was posted) are excluded.
            if (child.timestamp >= bounty.createTime && child.timestamp <= bounty.deadline) {
                raw[rawCount++] = child.author;
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

    /// @dev Transfer ETH to an address, reverting on failure
    function _transferETH(address to, uint256 amount) internal {
        (bool success,) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
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
