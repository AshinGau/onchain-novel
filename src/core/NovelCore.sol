// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {INovelCore} from "../interfaces/INovelCore.sol";
import {IVotingEngine} from "../interfaces/IVotingEngine.sol";
import {IPrizePool} from "../interfaces/IPrizePool.sol";
import {IRulesEngine} from "../interfaces/IRulesEngine.sol";
import {DataTypes} from "../libraries/DataTypes.sol";

/// @title NovelCore
/// @notice Stateful core: novels, chapters, world-line ancestors, world-line author flags.
///         Handles novel/chapter CRUD and views. All round-related logic lives in RoundManager.
/// @dev UUPS-upgradeable. RoundManager mutates phase/world-line state via privileged setters.
contract NovelCore is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuard,
    PausableUpgradeable,
    UUPSUpgradeable,
    INovelCore
{
    // (UUPS / OZ initializers wired below)
    // ─────── Constants ───────
    uint16 internal constant FORK_FEE_RATE = 100; // 1% of source pool, in bps
    uint256 internal constant MIN_SUBMISSION_FEE = 0.0001 ether;
    uint32 internal constant MAX_WORLD_LINE_COUNT = 16;
    uint16 private constant BPS_DENOMINATOR = 10000;
    uint256 private constant MAX_TREE_WALK_STEPS = 1000;

    // ─────── Storage: external modules ───────
    IVotingEngine public votingEngine;
    IPrizePool public prizePool;
    IRulesEngine public rulesEngine;
    address public roundManager;

    // ─────── Storage: data ───────
    uint64 public novelCount;
    uint64 public chapterCount;
    mapping(uint64 => DataTypes.Novel) private _novels;
    mapping(uint64 => DataTypes.Chapter) private _chapters;
    mapping(uint64 => DataTypes.NovelMetadata) private _novelMetadata;
    mapping(uint64 => uint64) private _novelRootId;
    mapping(uint64 => uint64[]) private _worldLineAncestors;
    mapping(uint64 => mapping(address => bool)) public isWorldLineAuthor;

    // ─────── Errors ───────
    error InvalidConfig(uint8 code);
    error NovelNotFound(uint64 novelId);
    error ChapterNotFound(uint64 chapterId);
    error InvalidFee(uint256 sent, uint256 required);
    error ContentLengthOutOfRange(uint64 length, uint64 min, uint64 max);
    error TransferFailed();
    error NotNovelCreator(uint64 novelId, address caller);
    error InvalidMetadata();
    error ContentHashMismatch(bytes32 expected, bytes32 actual);
    error OnchainContentRequired();
    error OnchainContentForbidden();
    error InsufficientForkFee(uint256 sent, uint256 required);
    error ZeroAddress();
    error OnlyRoundManager();

    // ─────── Modifiers ───────
    modifier onlyRoundManager() {
        if (msg.sender != roundManager) revert OnlyRoundManager();
        _;
    }

    // ─────── Initializer ───────
    function initialize(address owner_, address votingEngine_, address prizePool_, address rulesEngine_)
        external
        initializer
    {
        if (
            owner_ == address(0) || votingEngine_ == address(0) || prizePool_ == address(0)
                || rulesEngine_ == address(0)
        ) revert ZeroAddress();
        __Ownable_init(owner_);
        __Pausable_init();
        votingEngine = IVotingEngine(votingEngine_);
        prizePool = IPrizePool(prizePool_);
        rulesEngine = IRulesEngine(rulesEngine_);
    }

    // ─────── Admin ───────
    function setVotingEngine(address addr) external onlyOwner {
        if (addr == address(0)) revert ZeroAddress();
        votingEngine = IVotingEngine(addr);
    }

    function setPrizePool(address addr) external onlyOwner {
        if (addr == address(0)) revert ZeroAddress();
        prizePool = IPrizePool(addr);
    }

    function setRulesEngine(address addr) external onlyOwner {
        if (addr == address(0)) revert ZeroAddress();
        rulesEngine = IRulesEngine(addr);
    }

    function setRoundManager(address addr) external onlyOwner {
        if (addr == address(0)) revert ZeroAddress();
        roundManager = addr;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ════════════════════════════════════════════════════
    //                 NOVEL LIFECYCLE
    // ════════════════════════════════════════════════════

    function createNovel(
        DataTypes.NovelConfig calldata config,
        DataTypes.NovelMetadata calldata metadata,
        DataTypes.ContentSubmission calldata rootChapter
    ) external payable whenNotPaused returns (uint64 novelId) {
        _validateConfig(config);
        _validateMetadata(metadata);
        _validateSubmission(config, rootChapter);

        if (msg.value < config.submissionFee) revert InvalidFee(msg.value, config.submissionFee);

        uint64 rootId;
        (novelId, rootId) = _initNovelAndRoot(config, metadata, rootChapter, 0);

        if (msg.value > 0) prizePool.deposit{value: msg.value}(novelId, "genesis");

        emit NovelCreated(novelId, msg.sender);
        emit ChapterSubmitted(novelId, rootId, msg.sender, 0, 1);
    }

    function forkNovel(
        uint64 sourceChapterId,
        DataTypes.NovelConfig calldata config,
        DataTypes.NovelMetadata calldata metadata,
        DataTypes.ContentSubmission calldata rootChapter
    ) external payable whenNotPaused returns (uint64 novelId) {
        DataTypes.Chapter storage sourceCh = _chapters[sourceChapterId];
        if (sourceCh.id == 0) revert ChapterNotFound(sourceChapterId);

        uint64 sourceNovelId = sourceCh.novelId;
        DataTypes.Novel storage sourceNovel = _novels[sourceNovelId];

        uint256 sourcePoolBalance = prizePool.getPoolBalance(sourceNovelId);
        uint256 forkFee = sourcePoolBalance * FORK_FEE_RATE / BPS_DENOMINATOR;
        if (forkFee < config.submissionFee) forkFee = config.submissionFee;
        uint256 totalRequired = forkFee + config.submissionFee;
        if (msg.value < totalRequired) revert InsufficientForkFee(msg.value, totalRequired);

        _validateConfig(config);
        _validateMetadata(metadata);

        DataTypes.NovelConfig memory finalConfig = config;
        finalConfig.contentLocation = sourceNovel.config.contentLocation;
        finalConfig.contentBaseUrl = sourceNovel.config.contentBaseUrl;

        _validateSubmission(finalConfig, rootChapter);

        uint64 rootId;
        (novelId, rootId) = _initNovelAndRoot(finalConfig, metadata, rootChapter, sourceChapterId);

        prizePool.deposit{value: forkFee}(sourceNovelId, "forkFee");

        uint256 remaining = msg.value - forkFee;
        if (remaining > 0) prizePool.deposit{value: remaining}(novelId, "genesis");

        emit NovelForked(novelId, sourceChapterId, msg.sender);
        emit ChapterSubmitted(novelId, rootId, msg.sender, sourceChapterId, 1);
    }

    function _initNovelAndRoot(
        DataTypes.NovelConfig memory config,
        DataTypes.NovelMetadata calldata metadata,
        DataTypes.ContentSubmission calldata rootChapter,
        uint64 rootParentId
    ) private returns (uint64 novelId, uint64 rootId) {
        novelId = ++novelCount;
        _novels[novelId] = DataTypes.Novel({
            id: novelId,
            creator: msg.sender,
            config: config,
            currentRound: 0,
            roundPhase: DataTypes.RoundPhase.Idle,
            phaseStartTime: uint64(block.timestamp),
            lastSettleTime: 0,
            active: true
        });
        _novelMetadata[novelId] = metadata;

        rootId = ++chapterCount;
        _chapters[rootId] = DataTypes.Chapter({
            id: rootId,
            novelId: novelId,
            parentId: rootParentId,
            author: msg.sender,
            contentHash: rootChapter.contentHash,
            declaredLength: rootChapter.declaredLength,
            depth: 1,
            timestamp: uint64(block.timestamp),
            children: new uint64[](0)
        });
        _novelRootId[novelId] = rootId;
        _worldLineAncestors[novelId].push(rootId);
        isWorldLineAuthor[novelId][msg.sender] = true;
    }

    // ════════════════════════════════════════════════════
    //               CHAPTER SUBMISSION
    // ════════════════════════════════════════════════════

    function submitChapter(uint64 novelId, uint64 parentId, DataTypes.ContentSubmission calldata submission)
        external
        payable
        whenNotPaused
    {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);

        DataTypes.Chapter storage parent = _chapters[parentId];
        if (parent.id == 0 || parent.novelId != novelId) revert ChapterNotFound(parentId);

        if (msg.value < novel.config.submissionFee) revert InvalidFee(msg.value, novel.config.submissionFee);

        _validateSubmission(novel.config, submission);

        uint32 newDepth = parent.depth + 1;
        uint64 chapterId = ++chapterCount;

        _chapters[chapterId] = DataTypes.Chapter({
            id: chapterId,
            novelId: novelId,
            parentId: parentId,
            author: msg.sender,
            contentHash: submission.contentHash,
            declaredLength: submission.declaredLength,
            depth: newDepth,
            timestamp: uint64(block.timestamp),
            children: new uint64[](0)
        });
        _chapters[parentId].children.push(chapterId);

        if (msg.value > 0) prizePool.deposit{value: msg.value}(novelId, "submissionFee");

        emit ChapterSubmitted(novelId, chapterId, msg.sender, parentId, newDepth);
    }

    // ════════════════════════════════════════════════════
    //                     REWARDS
    // ════════════════════════════════════════════════════

    function claimReward(uint64 novelId) external nonReentrant whenNotPaused {
        uint256 amount = prizePool.claimReward(novelId, msg.sender);
        if (amount > 0) emit RewardClaimed(novelId, msg.sender, amount);
    }

    // ════════════════════════════════════════════════════
    //                 METADATA UPDATE
    // ════════════════════════════════════════════════════

    function updateNovelMetadata(uint64 novelId, DataTypes.NovelMetadata calldata metadata) external {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (novel.creator != msg.sender) revert NotNovelCreator(novelId, msg.sender);
        _validateMetadata(metadata);
        _novelMetadata[novelId] = metadata;
        emit NovelMetadataUpdated(novelId, metadata.title, metadata.description, metadata.coverUri);
    }

    // ════════════════════════════════════════════════════
    //         PRIVILEGED SETTERS (onlyRoundManager)
    // ════════════════════════════════════════════════════

    function advanceRound(uint64 novelId, DataTypes.RoundPhase phase, uint64 phaseStartTime)
        external
        onlyRoundManager
        returns (uint32 newRound)
    {
        DataTypes.Novel storage novel = _novels[novelId];
        novel.currentRound++;
        novel.roundPhase = phase;
        novel.phaseStartTime = phaseStartTime;
        return novel.currentRound;
    }

    function setNovelPhase(uint64 novelId, DataTypes.RoundPhase phase, uint64 phaseStartTime)
        external
        onlyRoundManager
    {
        DataTypes.Novel storage novel = _novels[novelId];
        novel.roundPhase = phase;
        novel.phaseStartTime = phaseStartTime;
    }

    function applyWorldLineSettlement(
        uint64 novelId,
        uint64[] calldata newAncestors,
        uint64[] calldata prevAncestors,
        DataTypes.RoundPhase newPhase,
        uint64 settleTime
    ) external onlyRoundManager {
        // Clear flags from prev paths
        for (uint256 i = 0; i < prevAncestors.length; i++) {
            _walkAndSetAuthorFlag(novelId, prevAncestors[i], false);
        }

        // Replace ancestors atomically
        delete _worldLineAncestors[novelId];
        for (uint256 i = 0; i < newAncestors.length; i++) {
            _worldLineAncestors[novelId].push(newAncestors[i]);
        }

        // Set flags on new paths
        for (uint256 i = 0; i < newAncestors.length; i++) {
            _walkAndSetAuthorFlag(novelId, newAncestors[i], true);
        }

        DataTypes.Novel storage novel = _novels[novelId];
        novel.roundPhase = newPhase;
        novel.lastSettleTime = settleTime;
        novel.phaseStartTime = settleTime;
    }

    function setNovelInactive(uint64 novelId) external onlyRoundManager {
        _novels[novelId].active = false;
    }

    /// @dev Walk parent chain from `chapterId` up to root, setting/clearing the world-line author flag.
    function _walkAndSetAuthorFlag(uint64 novelId, uint64 chapterId, bool flag) private {
        uint64 current = chapterId;
        for (uint256 step = 0; step < MAX_TREE_WALK_STEPS && current != 0; step++) {
            DataTypes.Chapter storage ch = _chapters[current];
            if (ch.novelId != novelId) break;
            isWorldLineAuthor[novelId][ch.author] = flag;
            if (ch.depth <= 1) break;
            current = ch.parentId;
        }
    }

    // ════════════════════════════════════════════════════
    //                       VIEWS
    // ════════════════════════════════════════════════════

    function getNovel(uint64 novelId) external view returns (DataTypes.Novel memory) {
        return _novels[novelId];
    }

    function getChapter(uint64 chapterId) external view returns (DataTypes.Chapter memory) {
        return _chapters[chapterId];
    }

    function getWorldLineAncestors(uint64 novelId) external view returns (uint64[] memory) {
        return _worldLineAncestors[novelId];
    }

    function getChapterChildren(uint64 chapterId) external view returns (uint64[] memory) {
        return _chapters[chapterId].children;
    }

    function getNovelMetadata(uint64 novelId) external view returns (DataTypes.NovelMetadata memory) {
        return _novelMetadata[novelId];
    }

    // ════════════════════════════════════════════════════
    //                    VALIDATORS
    // ════════════════════════════════════════════════════

    /// @dev Config error codes:
    ///  1=minChapterLength  2=maxChapterLength  3=worldLineCount  4=voteStake
    ///  5=commitDuration  6=revealDuration  7=prizeReleaseRate  8=voterRewardRate
    ///  9=nominateDuration  10=contentBaseUrl  11=ruleVoteDuration
    ///  12=submissionFee  13=worldLineCount upper bound  14=voteStake > submissionFee
    function _validateConfig(DataTypes.NovelConfig calldata config) internal pure {
        if (config.minChapterLength == 0) revert InvalidConfig(1);
        if (config.maxChapterLength <= config.minChapterLength) revert InvalidConfig(2);
        if (config.worldLineCount == 0) revert InvalidConfig(3);
        if (config.voteStake == 0) revert InvalidConfig(4);
        if (config.commitDuration == 0) revert InvalidConfig(5);
        if (config.revealDuration == 0) revert InvalidConfig(6);
        if (config.prizeReleaseRate > 5000) revert InvalidConfig(7);
        if (config.voterRewardRate > 5000) revert InvalidConfig(8);
        if (config.nominateDuration == 0) revert InvalidConfig(9);
        if (config.contentLocation != DataTypes.ContentLocation.Onchain && bytes(config.contentBaseUrl).length == 0) {
            revert InvalidConfig(10);
        }
        if (config.ruleQuorum > 0 && config.ruleVoteDuration == 0) revert InvalidConfig(11);
        if (config.submissionFee < MIN_SUBMISSION_FEE) revert InvalidConfig(12);
        if (config.worldLineCount > MAX_WORLD_LINE_COUNT) revert InvalidConfig(13);
        if (config.voteStake > config.submissionFee) revert InvalidConfig(14);
    }

    function _validateMetadata(DataTypes.NovelMetadata calldata metadata) internal pure {
        if (bytes(metadata.title).length == 0 || bytes(metadata.title).length > 256) revert InvalidMetadata();
    }

    function _validateSubmission(DataTypes.NovelConfig memory config, DataTypes.ContentSubmission calldata sub)
        internal
        pure
    {
        if (sub.contentHash == bytes32(0)) revert ContentHashMismatch(bytes32(0), bytes32(0));

        if (sub.declaredLength < config.minChapterLength || sub.declaredLength > config.maxChapterLength) {
            revert ContentLengthOutOfRange(sub.declaredLength, config.minChapterLength, config.maxChapterLength);
        }

        if (config.contentLocation == DataTypes.ContentLocation.Onchain) {
            if (sub.content.length == 0) revert OnchainContentRequired();
            if (uint64(sub.content.length) != sub.declaredLength) {
                revert ContentLengthOutOfRange(
                    uint64(sub.content.length), config.minChapterLength, config.maxChapterLength
                );
            }
            bytes32 computed = keccak256(sub.content);
            if (computed != sub.contentHash) revert ContentHashMismatch(sub.contentHash, computed);
        } else {
            if (sub.content.length != 0) revert OnchainContentForbidden();
        }
    }

    /// @notice Accept ETH from PrizePool only
    receive() external payable {
        if (msg.sender != address(prizePool)) revert TransferFailed();
    }

    // ─────── UUPS ───────
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ─────── Storage gap ───────
    uint256[42] private __gap;
}
