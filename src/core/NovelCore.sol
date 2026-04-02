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
import {IChapterNFT} from "../interfaces/IChapterNFT.sol";
import {DataTypes} from "../libraries/DataTypes.sol";

/// @title NovelCore
/// @notice Core contract managing novel lifecycle, chapter tree, Round/Epoch state machine,
///         staking, and pollution tracking. Coordinates VotingEngine, PrizePool, and ChapterNFT.
/// @dev Designed for multi-Agent collaborative novel creation on-chain.
contract NovelCore is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuard,
    PausableUpgradeable,
    UUPSUpgradeable,
    INovelCore
{
    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice External module references
    IVotingEngine public votingEngine;
    IPrizePool public prizePool;
    IChapterNFT public chapterNFT;

    /// @notice Novel counter (also used as next novel ID)
    uint256 private _novelCount;

    /// @notice Chapter counter (also used as next chapter ID, global across all novels)
    uint256 private _chapterCount;

    /// @notice Novel ID => Novel data
    mapping(uint256 => DataTypes.Novel) private _novels;

    /// @notice Chapter ID => Chapter data
    mapping(uint256 => DataTypes.Chapter) private _chapters;

    /// @notice Novel ID => current active world line chapter IDs
    mapping(uint256 => uint256[]) private _activeWorldLines;

    /// @notice Novel ID => round number => submitted chapter IDs
    mapping(uint256 => mapping(uint32 => uint256[])) private _roundSubmissions;

    /// @notice Novel ID => author => stake balance (refundable)
    mapping(uint256 => mapping(address => uint256)) private _stakeBalances;

    /// @notice Novel ID => author => pollution tracking
    mapping(uint256 => mapping(address => DataTypes.PollutionRecord)) private _pollutionRecords;

    /// @notice Novel ID => author => locked stake amount (in-flight, not yet settled)
    mapping(uint256 => mapping(address => uint256)) private _lockedStakes;

    /// @notice Global keeper reward amount (owner-settable, per state transition call)
    uint256 public keeperRewardAmount;

    // ============================================================
    //                         ERRORS
    // ============================================================

    error InvalidConfig(string reason);
    error NovelNotFound(uint256 novelId);
    error NovelNotActive(uint256 novelId);
    error ChapterNotFound(uint256 chapterId);
    error NotWorldLine(uint256 chapterId);
    error InvalidStakeAmount(uint256 sent, uint256 required);
    error ContentLengthOutOfRange(uint64 length, uint64 min, uint64 max);
    error WrongRoundPhase(DataTypes.RoundPhase expected, DataTypes.RoundPhase actual);
    error WrongEpochPhase(DataTypes.EpochPhase expected, DataTypes.EpochPhase actual);
    error RoundConditionsNotMet();
    error PhaseNotExpired();
    error NoStakeToRefund();
    error TransferFailed();
    error ChapterNotInNovel(uint256 chapterId, uint256 novelId);
    error BranchNotRejected(uint256 chapterId);
    error InvalidGenesisInput();
    error InsufficientForkFee(uint256 sent, uint256 required);

    // ============================================================
    //                      INITIALIZER
    // ============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address votingEngine_, address prizePool_, address chapterNFT_)
        external
        initializer
    {
        __Ownable_init(owner_);
        __Pausable_init();

        votingEngine = IVotingEngine(votingEngine_);
        prizePool = IPrizePool(prizePool_);
        chapterNFT = IChapterNFT(chapterNFT_);
    }

    // ============================================================
    //                     ADMIN FUNCTIONS
    // ============================================================

    event VotingEngineUpdated(address indexed oldAddr, address indexed newAddr);
    event PrizePoolUpdated(address indexed oldAddr, address indexed newAddr);
    event ChapterNFTUpdated(address indexed oldAddr, address indexed newAddr);
    event KeeperRewardAmountUpdated(uint256 oldAmount, uint256 newAmount);

    function setVotingEngine(address addr) external onlyOwner {
        address old = address(votingEngine);
        votingEngine = IVotingEngine(addr);
        emit VotingEngineUpdated(old, addr);
    }

    function setPrizePool(address addr) external onlyOwner {
        address old = address(prizePool);
        prizePool = IPrizePool(addr);
        emit PrizePoolUpdated(old, addr);
    }

    function setChapterNFT(address addr) external onlyOwner {
        address old = address(chapterNFT);
        chapterNFT = IChapterNFT(addr);
        emit ChapterNFTUpdated(old, addr);
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

    /// @notice Deactivate a novel (no more submissions or voting)
    /// @param novelId Novel to deactivate
    function completeNovel(uint256 novelId) external onlyOwner {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (!novel.active) revert NovelNotActive(novelId);

        // Only allow completion during Submitting phase (not mid-vote)
        if (novel.roundPhase != DataTypes.RoundPhase.Submitting) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Submitting, novel.roundPhase);
        }

        novel.active = false;

        // Unlock stakes for current round submissions (round will never settle)
        uint256[] storage submissions = _roundSubmissions[novelId][novel.currentRound];
        uint256 stakeAmt = novel.config.stakeAmount;
        for (uint256 i = 0; i < submissions.length; i++) {
            address author = _chapters[submissions[i]].author;
            if (_lockedStakes[novelId][author] >= stakeAmt) {
                _lockedStakes[novelId][author] -= stakeAmt;
            }
        }

        emit NovelCompleted(novelId);
    }

    // ============================================================
    //                   NOVEL LIFECYCLE
    // ============================================================

    /// @inheritdoc INovelCore
    function createNovel(
        DataTypes.NovelConfig calldata config,
        bytes32[] calldata genesisContentHashes,
        uint64[] calldata genesisLengths
    ) external payable whenNotPaused returns (uint256 novelId) {
        _validateConfig(config);
        if (genesisContentHashes.length == 0) revert InvalidGenesisInput();
        if (genesisContentHashes.length != genesisLengths.length) revert InvalidGenesisInput();
        if (genesisContentHashes.length > config.worldLineCount) revert InvalidGenesisInput();

        novelId = ++_novelCount;

        _novels[novelId] = DataTypes.Novel({
            id: novelId,
            creator: msg.sender,
            config: config,
            currentRound: 1,
            currentEpoch: 1,
            roundPhase: DataTypes.RoundPhase.Submitting,
            epochPhase: DataTypes.EpochPhase.Rounds,
            phaseStartTime: block.timestamp,
            genesisChapterCount: uint32(genesisContentHashes.length),
            cumulativeCanonChapters: 0,
            active: true,
            forkSourceNovelId: 0,
            forkSourceChapterId: 0
        });

        // Create genesis chapters — each becomes an initial active world line
        for (uint256 i = 0; i < genesisContentHashes.length; i++) {
            if (genesisLengths[i] < config.minChapterLength || genesisLengths[i] > config.maxChapterLength) {
                revert ContentLengthOutOfRange(genesisLengths[i], config.minChapterLength, config.maxChapterLength);
            }

            uint256 genesisChapterId = ++_chapterCount;
            _chapters[genesisChapterId] = DataTypes.Chapter({
                id: genesisChapterId,
                novelId: novelId,
                parentId: 0,
                author: msg.sender,
                contentHash: genesisContentHashes[i],
                declaredLength: genesisLengths[i],
                round: 0,
                epoch: 0,
                chapterIndex: 0,
                voteCount: 0,
                isWorldLine: true,
                isCanon: false
            });

            _activeWorldLines[novelId].push(genesisChapterId);
        }

        // Deposit initial prize pool if any ETH sent
        if (msg.value > 0) {
            prizePool.deposit{value: msg.value}(novelId, "genesis");
        }

        emit NovelCreated(novelId, msg.sender, uint32(genesisContentHashes.length));
    }

    /// @inheritdoc INovelCore
    function forkNovel(uint256 originalNovelId, uint256 branchChapterId, DataTypes.NovelConfig calldata config)
        external
        payable
        whenNotPaused
        returns (uint256 novelId)
    {
        DataTypes.Novel storage sourceNovel = _novels[originalNovelId];
        if (sourceNovel.id == 0) revert NovelNotFound(originalNovelId);

        DataTypes.Chapter storage branch = _chapters[branchChapterId];
        if (branch.id == 0) revert ChapterNotFound(branchChapterId);
        if (branch.novelId != originalNovelId) revert ChapterNotInNovel(branchChapterId, originalNovelId);
        if (branch.isCanon) revert BranchNotRejected(branchChapterId);

        // Fork fee: must pay at least the original novel's stakeAmount as tribute
        uint256 forkFee = sourceNovel.config.stakeAmount;
        if (msg.value < forkFee) revert InsufficientForkFee(msg.value, forkFee);

        _validateConfig(config);

        novelId = ++_novelCount;

        _novels[novelId] = DataTypes.Novel({
            id: novelId,
            creator: sourceNovel.creator, // Creator royalty flows to original creator
            config: config,
            currentRound: 1,
            currentEpoch: 1,
            roundPhase: DataTypes.RoundPhase.Submitting,
            epochPhase: DataTypes.EpochPhase.Rounds,
            phaseStartTime: block.timestamp,
            genesisChapterCount: 1,
            cumulativeCanonChapters: 0,
            active: true,
            forkSourceNovelId: originalNovelId,
            forkSourceChapterId: branchChapterId
        });

        // Inherit content base URL from original novel (immutable, fork cannot override)
        _novels[novelId].config.contentBaseUrl = sourceNovel.config.contentBaseUrl;

        // Create the fork root chapter
        uint256 forkRootId = ++_chapterCount;
        _chapters[forkRootId] = DataTypes.Chapter({
            id: forkRootId,
            novelId: novelId,
            parentId: 0,
            author: msg.sender,
            contentHash: branch.contentHash,
            declaredLength: branch.declaredLength,
            round: 0,
            epoch: 0,
            chapterIndex: 0,
            voteCount: 0,
            isWorldLine: true,
            isCanon: false
        });

        _activeWorldLines[novelId].push(forkRootId);

        // Fork fee goes to the original novel's prize pool
        prizePool.deposit{value: forkFee}(originalNovelId, "fork_fee");

        // Remaining ETH goes to the new novel's prize pool
        uint256 remaining = msg.value - forkFee;
        if (remaining > 0) {
            prizePool.deposit{value: remaining}(novelId, "fork_genesis");
        }

        emit NovelForked(novelId, originalNovelId, branchChapterId);
        emit NovelCreated(novelId, msg.sender, 1);
    }

    // ============================================================
    //                   CHAPTER SUBMISSION
    // ============================================================

    /// @inheritdoc INovelCore
    function submitChapter(uint256 novelId, uint256 parentChapterId, bytes32 contentHash, uint64 declaredLength)
        external
        payable
        whenNotPaused
        returns (uint256 chapterId)
    {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (!novel.active) revert NovelNotActive(novelId);

        if (novel.roundPhase != DataTypes.RoundPhase.Submitting) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Submitting, novel.roundPhase);
        }
        if (novel.epochPhase != DataTypes.EpochPhase.Rounds) {
            revert WrongEpochPhase(DataTypes.EpochPhase.Rounds, novel.epochPhase);
        }

        DataTypes.Chapter storage parent = _chapters[parentChapterId];
        if (parent.id == 0) revert ChapterNotFound(parentChapterId);
        if (parent.novelId != novelId) revert ChapterNotInNovel(parentChapterId, novelId);
        if (!_isActiveWorldLine(novelId, parentChapterId)) revert NotWorldLine(parentChapterId);

        DataTypes.NovelConfig storage config = novel.config;
        if (declaredLength < config.minChapterLength || declaredLength > config.maxChapterLength) {
            revert ContentLengthOutOfRange(declaredLength, config.minChapterLength, config.maxChapterLength);
        }

        if (msg.value != config.stakeAmount) {
            revert InvalidStakeAmount(msg.value, config.stakeAmount);
        }

        uint32 newChapterIndex = parent.chapterIndex + 1;

        chapterId = ++_chapterCount;
        _chapters[chapterId] = DataTypes.Chapter({
            id: chapterId,
            novelId: novelId,
            parentId: parentChapterId,
            author: msg.sender,
            contentHash: contentHash,
            declaredLength: declaredLength,
            round: novel.currentRound,
            epoch: novel.currentEpoch,
            chapterIndex: newChapterIndex,
            voteCount: 0,
            isWorldLine: false,
            isCanon: false
        });

        _roundSubmissions[novelId][novel.currentRound].push(chapterId);
        _stakeBalances[novelId][msg.sender] += msg.value;
        _lockedStakes[novelId][msg.sender] += msg.value;

        emit ChapterSubmitted(novelId, chapterId, msg.sender, parentChapterId, newChapterIndex);
    }

    // ============================================================
    //                  ROUND STATE TRANSITIONS
    // ============================================================

    /// @inheritdoc INovelCore
    function closeSubmissions(uint256 novelId) external whenNotPaused {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);

        if (novel.roundPhase != DataTypes.RoundPhase.Submitting) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Submitting, novel.roundPhase);
        }

        DataTypes.NovelConfig storage config = novel.config;

        if (block.timestamp < novel.phaseStartTime + config.roundMinDuration) {
            revert RoundConditionsNotMet();
        }

        uint256[] storage submissions = _roundSubmissions[novelId][novel.currentRound];
        if (submissions.length < config.roundMinSubmissions) {
            revert RoundConditionsNotMet();
        }

        uint256 votingRoundId = _computeVotingRoundId(novelId, novel.currentEpoch, novel.currentRound, false);
        votingEngine.initializeVoting(novelId, votingRoundId, submissions);

        novel.roundPhase = DataTypes.RoundPhase.Committing;
        novel.phaseStartTime = block.timestamp;

        _payKeeper(novelId);

        emit RoundPhaseChanged(novelId, novel.currentRound, DataTypes.RoundPhase.Committing);
    }

    /// @inheritdoc INovelCore
    function closeCommit(uint256 novelId) external whenNotPaused {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);

        if (novel.roundPhase != DataTypes.RoundPhase.Committing) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Committing, novel.roundPhase);
        }

        if (block.timestamp < novel.phaseStartTime + novel.config.commitDuration) {
            revert PhaseNotExpired();
        }

        uint256 votingRoundId = _computeVotingRoundId(novelId, novel.currentEpoch, novel.currentRound, false);
        votingEngine.closeCommitPhase(novelId, votingRoundId);

        novel.roundPhase = DataTypes.RoundPhase.Revealing;
        novel.phaseStartTime = block.timestamp;

        _payKeeper(novelId);

        emit RoundPhaseChanged(novelId, novel.currentRound, DataTypes.RoundPhase.Revealing);
    }

    /// @inheritdoc INovelCore
    function settleRound(uint256 novelId) external whenNotPaused {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);

        if (novel.roundPhase != DataTypes.RoundPhase.Revealing) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Revealing, novel.roundPhase);
        }

        if (block.timestamp < novel.phaseStartTime + novel.config.revealDuration) {
            revert PhaseNotExpired();
        }

        // Tally votes
        uint256 votingRoundId = _computeVotingRoundId(novelId, novel.currentEpoch, novel.currentRound, false);
        uint256[] memory rankedIds = votingEngine.tallyVotes(novelId, votingRoundId);

        // Select top N as world lines
        uint32 N = novel.config.worldLineCount;
        uint256 selectCount = rankedIds.length < N ? rankedIds.length : N;

        delete _activeWorldLines[novelId];

        uint256[] memory selectedIds = new uint256[](selectCount);
        for (uint256 i = 0; i < selectCount; i++) {
            uint256 selectedId = rankedIds[i];
            _chapters[selectedId].isWorldLine = true;
            _activeWorldLines[novelId].push(selectedId);
            selectedIds[i] = selectedId;
        }

        _updatePollutionRecords(novelId, novel.currentRound, rankedIds);
        _returnRoundStakes(novelId, novel.currentRound);

        emit WorldLinesSelected(novelId, novel.currentRound, selectedIds);

        if (novel.currentRound >= novel.config.roundsPerEpoch) {
            // Transition to Epoch voting
            novel.epochPhase = DataTypes.EpochPhase.Committing;
            novel.roundPhase = DataTypes.RoundPhase.Settling;
            novel.phaseStartTime = block.timestamp;

            uint256 epochVotingId = _computeVotingRoundId(novelId, novel.currentEpoch, novel.currentRound, true);
            votingEngine.initializeVoting(novelId, epochVotingId, _activeWorldLines[novelId]);

            emit EpochPhaseChanged(novelId, novel.currentEpoch, DataTypes.EpochPhase.Committing);
        } else {
            novel.currentRound++;
            novel.roundPhase = DataTypes.RoundPhase.Submitting;
            novel.phaseStartTime = block.timestamp;

            emit RoundPhaseChanged(novelId, novel.currentRound, DataTypes.RoundPhase.Submitting);
        }

        _payKeeper(novelId);
    }

    // ============================================================
    //                  EPOCH STATE TRANSITIONS
    // ============================================================

    /// @inheritdoc INovelCore
    function closeEpochCommit(uint256 novelId) external whenNotPaused {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);

        if (novel.epochPhase != DataTypes.EpochPhase.Committing) {
            revert WrongEpochPhase(DataTypes.EpochPhase.Committing, novel.epochPhase);
        }

        if (block.timestamp < novel.phaseStartTime + novel.config.commitDuration) {
            revert PhaseNotExpired();
        }

        uint256 epochVotingId = _computeVotingRoundId(novelId, novel.currentEpoch, novel.currentRound, true);
        votingEngine.closeCommitPhase(novelId, epochVotingId);

        novel.epochPhase = DataTypes.EpochPhase.Revealing;
        novel.phaseStartTime = block.timestamp;

        _payKeeper(novelId);

        emit EpochPhaseChanged(novelId, novel.currentEpoch, DataTypes.EpochPhase.Revealing);
    }

    /// @inheritdoc INovelCore
    function settleEpoch(uint256 novelId) external whenNotPaused nonReentrant {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);

        if (novel.epochPhase != DataTypes.EpochPhase.Revealing) {
            revert WrongEpochPhase(DataTypes.EpochPhase.Revealing, novel.epochPhase);
        }

        if (block.timestamp < novel.phaseStartTime + novel.config.revealDuration) {
            revert PhaseNotExpired();
        }

        // Tally epoch votes
        uint256 epochVotingId = _computeVotingRoundId(novelId, novel.currentEpoch, novel.currentRound, true);
        uint256[] memory rankedWorldLines = votingEngine.tallyVotes(novelId, epochVotingId);

        uint256 canonWorldLineId = rankedWorldLines[0];

        emit CanonEstablished(novelId, novel.currentEpoch, canonWorldLineId);

        // Collect canon chapter authors for this epoch
        address[] memory canonAuthors = _collectCanonAuthors(novelId, canonWorldLineId);

        // Mint NFTs for canon chapters
        _mintCanonNFTs(novelId, novel.currentEpoch, canonWorldLineId);

        // Include current epoch's canon chapters in cumulative count BEFORE distribution
        // so creator royalty formula G/(G+C) gives ~50% at epoch 1 (matching design)
        novel.cumulativeCanonChapters += uint32(canonAuthors.length);

        // Distribute prize pool rewards (three-layer: creator royalty → authors → voters)
        uint256 voterRewardPool = prizePool.distributeEpochRewards(
            novelId,
            novel.currentEpoch,
            novel.creator,
            canonAuthors,
            novel.config.prizeReleaseRate,
            novel.genesisChapterCount,
            novel.cumulativeCanonChapters,
            novel.config.voterRewardRate,
            payable(address(votingEngine))
        );

        // Record voter reward allocation in VotingEngine (ETH already sent by PrizePool)
        if (voterRewardPool > 0) {
            uint256 roundCount = uint256(novel.currentRound) + 1; // K round votes + 1 epoch vote
            uint256[] memory votingRoundIds = new uint256[](roundCount);
            for (uint32 r = 1; r <= novel.currentRound; r++) {
                votingRoundIds[r - 1] = _computeVotingRoundId(novelId, novel.currentEpoch, r, false);
            }
            votingRoundIds[roundCount - 1] = epochVotingId;
            votingEngine.depositVoterRewards(novelId, votingRoundIds, voterRewardPool);
        }

        // Reset for next epoch
        delete _activeWorldLines[novelId];
        _activeWorldLines[novelId].push(canonWorldLineId);

        novel.currentEpoch++;
        novel.currentRound = 1;
        novel.roundPhase = DataTypes.RoundPhase.Submitting;
        novel.epochPhase = DataTypes.EpochPhase.Rounds;
        novel.phaseStartTime = block.timestamp;

        _payKeeper(novelId);

        emit EpochPhaseChanged(novelId, novel.currentEpoch, DataTypes.EpochPhase.Rounds);
        emit RoundPhaseChanged(novelId, novel.currentRound, DataTypes.RoundPhase.Submitting);
    }

    /// @inheritdoc INovelCore
    function triggerEarlyEpoch(uint256 novelId) external onlyOwner whenNotPaused {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);

        // Must be in Rounds phase and Submitting sub-phase
        if (novel.epochPhase != DataTypes.EpochPhase.Rounds) {
            revert WrongEpochPhase(DataTypes.EpochPhase.Rounds, novel.epochPhase);
        }
        if (novel.roundPhase != DataTypes.RoundPhase.Submitting) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Submitting, novel.roundPhase);
        }

        // Must have completed at least 1 round (need world lines for epoch vote)
        if (novel.currentRound <= 1) revert RoundConditionsNotMet();

        // Revert currentRound to the last completed round so settleEpoch computes
        // the matching epochVotingId (settleEpoch uses novel.currentRound directly)
        novel.currentRound--;

        // Skip remaining rounds → enter Epoch Committing
        novel.epochPhase = DataTypes.EpochPhase.Committing;
        novel.roundPhase = DataTypes.RoundPhase.Settling;
        novel.phaseStartTime = block.timestamp;

        uint256 epochVotingId = _computeVotingRoundId(novelId, novel.currentEpoch, novel.currentRound, true);
        votingEngine.initializeVoting(novelId, epochVotingId, _activeWorldLines[novelId]);

        emit EarlyEpochTriggered(novelId, novel.currentEpoch);
        emit EpochPhaseChanged(novelId, novel.currentEpoch, DataTypes.EpochPhase.Committing);
    }

    // ============================================================
    //                      STAKE CLAIMS
    // ============================================================

    /// @inheritdoc INovelCore
    function claimStakeRefund(uint256 novelId) external nonReentrant whenNotPaused {
        uint256 total = _stakeBalances[novelId][msg.sender];
        uint256 locked = _lockedStakes[novelId][msg.sender];
        uint256 claimable = total > locked ? total - locked : 0;
        if (claimable == 0) revert NoStakeToRefund();

        _stakeBalances[novelId][msg.sender] -= claimable;

        (bool success,) = msg.sender.call{value: claimable}("");
        if (!success) revert TransferFailed();

        emit StakeRefunded(novelId, msg.sender, claimable);
    }

    // ============================================================
    //                        QUERIES
    // ============================================================

    /// @inheritdoc INovelCore
    function getNovel(uint256 novelId) external view returns (DataTypes.Novel memory) {
        return _novels[novelId];
    }

    /// @inheritdoc INovelCore
    function getChapter(uint256 chapterId) external view returns (DataTypes.Chapter memory) {
        return _chapters[chapterId];
    }

    /// @inheritdoc INovelCore
    function getActiveWorldLines(uint256 novelId) external view returns (uint256[] memory) {
        return _activeWorldLines[novelId];
    }

    /// @inheritdoc INovelCore
    function getRoundSubmissions(uint256 novelId, uint32 round) external view returns (uint256[] memory) {
        return _roundSubmissions[novelId][round];
    }

    /// @inheritdoc INovelCore
    function getNovelCount() external view returns (uint256) {
        return _novelCount;
    }

    /// @inheritdoc INovelCore
    function getChapterCount() external view returns (uint256) {
        return _chapterCount;
    }

    /// @notice Get an author's claimable stake (total minus locked in-flight stakes)
    function getClaimableStake(uint256 novelId, address author) external view returns (uint256) {
        uint256 total = _stakeBalances[novelId][author];
        uint256 locked = _lockedStakes[novelId][author];
        return total > locked ? total - locked : 0;
    }

    // ============================================================
    //                    INTERNAL HELPERS
    // ============================================================

    function _validateConfig(DataTypes.NovelConfig calldata config) internal pure {
        if (config.minChapterLength == 0) revert InvalidConfig("minChapterLength must be > 0");
        if (config.maxChapterLength <= config.minChapterLength) {
            revert InvalidConfig("maxChapterLength must be > minChapterLength");
        }
        if (config.roundMinDuration == 0) revert InvalidConfig("roundMinDuration must be > 0");
        if (config.worldLineCount == 0) revert InvalidConfig("worldLineCount must be > 0");
        if (config.roundMinSubmissions < config.worldLineCount) {
            revert InvalidConfig("roundMinSubmissions must be >= worldLineCount");
        }
        if (config.roundsPerEpoch == 0) revert InvalidConfig("roundsPerEpoch must be > 0");
        if (config.prizeReleaseRate > 5000) revert InvalidConfig("prizeReleaseRate must be <= 5000");
        if (config.voterRewardRate > 2000) revert InvalidConfig("voterRewardRate must be <= 2000");
        if (config.stakeAmount == 0) revert InvalidConfig("stakeAmount must be > 0");
        if (config.commitDuration == 0) revert InvalidConfig("commitDuration must be > 0");
        if (config.revealDuration == 0) revert InvalidConfig("revealDuration must be > 0");
    }

    function _isActiveWorldLine(uint256 novelId, uint256 chapterId) internal view returns (bool) {
        uint256[] storage worldLines = _activeWorldLines[novelId];
        for (uint256 i = 0; i < worldLines.length; i++) {
            if (worldLines[i] == chapterId) return true;
        }
        return false;
    }

    function _computeVotingRoundId(uint256 novelId, uint32 epoch, uint32 round, bool isEpoch)
        internal
        pure
        returns (uint256)
    {
        return uint256(keccak256(abi.encodePacked(novelId, epoch, round, isEpoch)));
    }

    function _returnRoundStakes(uint256 novelId, uint32 round) internal {
        uint256[] storage submissions = _roundSubmissions[novelId][round];
        DataTypes.NovelConfig storage config = _novels[novelId].config;

        for (uint256 i = 0; i < submissions.length; i++) {
            DataTypes.Chapter storage chapter = _chapters[submissions[i]];
            address author = chapter.author;

            // Unlock this submission's stake
            if (_lockedStakes[novelId][author] >= config.stakeAmount) {
                _lockedStakes[novelId][author] -= config.stakeAmount;
            }

            // Check for pollution-based slashing
            DataTypes.PollutionRecord storage record = _pollutionRecords[novelId][author];
            if (record.consecutiveStrikes >= config.pollutionRounds && config.pollutionRounds > 0) {
                uint256 slashAmount = config.stakeAmount / 2;

                if (slashAmount > 0 && _stakeBalances[novelId][author] >= slashAmount) {
                    _stakeBalances[novelId][author] -= slashAmount;
                    prizePool.deposit{value: slashAmount}(novelId, "pollution_slash");
                    emit StakeSlashed(novelId, author, slashAmount);
                }

                record.consecutiveStrikes = 0;
            }
        }
    }

    /// @dev Skips pollution tracking when fewer than 10 submissions.
    ///      Processes each author only once using their best-ranked chapter
    ///      to prevent gaming via submitting both high and low ranked chapters.
    function _updatePollutionRecords(uint256 novelId, uint32 round, uint256[] memory rankedIds) internal {
        DataTypes.NovelConfig storage config = _novels[novelId].config;
        if (config.pollutionThreshold == 0 || rankedIds.length < 10) return;

        uint256 bottomCount = (rankedIds.length * config.pollutionThreshold) / 100;
        if (bottomCount == 0) bottomCount = 1;

        uint256 bottomStartIdx = rankedIds.length - bottomCount;

        // Single pass from best to worst rank. First occurrence of each author
        // is their best chapter — skip duplicates to prevent pollution gaming.
        for (uint256 i = 0; i < rankedIds.length; i++) {
            address author = _chapters[rankedIds[i]].author;
            DataTypes.PollutionRecord storage record = _pollutionRecords[novelId][author];

            // Skip if already processed this round (first seen = best rank)
            if (record.lastRecordedRound == round) continue;

            if (i >= bottomStartIdx) {
                // Bottom portion: add strike
                if (record.lastRecordedRound == round - 1 || record.lastRecordedRound == 0) {
                    record.consecutiveStrikes++;
                } else {
                    record.consecutiveStrikes = 1;
                }
            } else {
                // Top portion: reset strikes
                if (record.consecutiveStrikes > 0) {
                    record.consecutiveStrikes = 0;
                }
            }
            record.lastRecordedRound = round;
        }
    }

    function _collectCanonAuthors(uint256 novelId, uint256 canonWorldLineId) internal view returns (address[] memory) {
        DataTypes.Novel storage novel = _novels[novelId];
        uint32 currentEpoch = novel.currentEpoch;
        uint32 maxChapters = novel.config.roundsPerEpoch;

        uint256[] memory authorChapterIds = new uint256[](maxChapters);
        uint256 count = 0;
        uint256 currentId = canonWorldLineId;

        while (currentId != 0 && count < maxChapters) {
            DataTypes.Chapter storage ch = _chapters[currentId];
            if (ch.novelId != novelId) break;

            if (ch.epoch == currentEpoch && ch.round > 0) {
                authorChapterIds[count] = currentId;
                count++;
            } else if (ch.epoch < currentEpoch) {
                break;
            }

            currentId = ch.parentId;
        }

        address[] memory authors = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            authors[i] = _chapters[authorChapterIds[i]].author;
        }

        return authors;
    }

    function _mintCanonNFTs(uint256 novelId, uint32 epoch, uint256 canonWorldLineId) internal {
        uint256 currentId = canonWorldLineId;

        while (currentId != 0) {
            DataTypes.Chapter storage ch = _chapters[currentId];
            if (ch.novelId != novelId) break;

            if (ch.epoch == epoch && ch.round > 0 && !chapterNFT.isChapterMinted(novelId, currentId)) {
                ch.isCanon = true;
                chapterNFT.mint(ch.author, novelId, currentId, epoch, ch.contentHash);
            } else if (ch.epoch < epoch) {
                break;
            }

            currentId = ch.parentId;
        }
    }

    /// @dev Pay keeper reward from novel's prize pool (if configured)
    function _payKeeper(uint256 novelId) internal {
        if (keeperRewardAmount > 0) {
            bool paid = prizePool.payKeeperReward(novelId, msg.sender, keeperRewardAmount);
            if (paid) {
                emit KeeperRewarded(novelId, msg.sender, keeperRewardAmount);
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
