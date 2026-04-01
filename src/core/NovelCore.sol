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

    // ============================================================
    //                         ERRORS
    // ============================================================

    error InvalidConfig(string reason);
    error NovelNotFound(uint256 novelId);
    error NovelNotActive(uint256 novelId);
    error ChapterNotFound(uint256 chapterId);
    error InvalidParentChapter(uint256 chapterId);
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

    // ============================================================
    //                      INITIALIZER
    // ============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the NovelCore contract
    /// @param owner_ Initial owner
    /// @param votingEngine_ VotingEngine contract address
    /// @param prizePool_ PrizePool contract address
    /// @param chapterNFT_ ChapterNFT contract address
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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============================================================
    //                   NOVEL LIFECYCLE
    // ============================================================

    /// @inheritdoc INovelCore
    function createNovel(DataTypes.NovelConfig calldata config, bytes32 genesisContentHash)
        external
        payable
        whenNotPaused
        returns (uint256 novelId)
    {
        _validateConfig(config);

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
            genesisContentHash: genesisContentHash,
            active: true,
            forkSourceNovelId: 0,
            forkSourceChapterId: 0
        });

        // Create genesis root chapter (virtual, id=0 is reserved)
        uint256 genesisChapterId = ++_chapterCount;
        _chapters[genesisChapterId] = DataTypes.Chapter({
            id: genesisChapterId,
            novelId: novelId,
            parentId: 0,
            author: msg.sender,
            contentHash: genesisContentHash,
            declaredLength: 0,
            round: 0,
            epoch: 0,
            voteCount: 0,
            isWorldLine: true,
            isCanon: false
        });

        // Genesis chapter is the initial active world line
        _activeWorldLines[novelId].push(genesisChapterId);

        // Deposit initial prize pool if any ETH sent
        if (msg.value > 0) {
            prizePool.deposit{value: msg.value}(novelId, "genesis");
        }

        emit NovelCreated(novelId, msg.sender, genesisContentHash);
    }

    /// @inheritdoc INovelCore
    function forkNovel(uint256 originalNovelId, uint256 branchChapterId, DataTypes.NovelConfig calldata config)
        external
        payable
        whenNotPaused
        returns (uint256 novelId)
    {
        // Validate source novel exists
        DataTypes.Novel storage sourceNovel = _novels[originalNovelId];
        if (sourceNovel.id == 0) revert NovelNotFound(originalNovelId);

        // Validate the branch chapter exists and belongs to the source novel
        DataTypes.Chapter storage branch = _chapters[branchChapterId];
        if (branch.id == 0) revert ChapterNotFound(branchChapterId);
        if (branch.novelId != originalNovelId) revert ChapterNotInNovel(branchChapterId, originalNovelId);

        // Branch should not be a current canon/worldline (forking is for rejected branches)
        if (branch.isCanon) revert BranchNotRejected(branchChapterId);

        _validateConfig(config);

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
            genesisContentHash: branch.contentHash,
            active: true,
            forkSourceNovelId: originalNovelId,
            forkSourceChapterId: branchChapterId
        });

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
            voteCount: 0,
            isWorldLine: true,
            isCanon: false
        });

        _activeWorldLines[novelId].push(forkRootId);

        if (msg.value > 0) {
            prizePool.deposit{value: msg.value}(novelId, "fork_genesis");
        }

        emit NovelForked(novelId, originalNovelId, branchChapterId);
        emit NovelCreated(novelId, msg.sender, branch.contentHash);
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

        // Must be in Submitting phase
        if (novel.roundPhase != DataTypes.RoundPhase.Submitting) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Submitting, novel.roundPhase);
        }
        if (novel.epochPhase != DataTypes.EpochPhase.Rounds) {
            revert WrongEpochPhase(DataTypes.EpochPhase.Rounds, novel.epochPhase);
        }

        // Validate parent chapter is an active world line
        DataTypes.Chapter storage parent = _chapters[parentChapterId];
        if (parent.id == 0) revert ChapterNotFound(parentChapterId);
        if (parent.novelId != novelId) revert ChapterNotInNovel(parentChapterId, novelId);
        if (!_isActiveWorldLine(novelId, parentChapterId)) revert NotWorldLine(parentChapterId);

        // Validate content length
        DataTypes.NovelConfig storage config = novel.config;
        if (declaredLength < config.minChapterLength || declaredLength > config.maxChapterLength) {
            revert ContentLengthOutOfRange(declaredLength, config.minChapterLength, config.maxChapterLength);
        }

        // Validate stake
        if (msg.value != config.stakeAmount) {
            revert InvalidStakeAmount(msg.value, config.stakeAmount);
        }

        // Create chapter
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
            voteCount: 0,
            isWorldLine: false,
            isCanon: false
        });

        // Track submission
        _roundSubmissions[novelId][novel.currentRound].push(chapterId);

        // Track stake
        _stakeBalances[novelId][msg.sender] += msg.value;

        emit ChapterSubmitted(novelId, chapterId, msg.sender, parentChapterId);
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

        // Check minimum duration elapsed
        if (block.timestamp < novel.phaseStartTime + config.roundMinDuration) {
            revert RoundConditionsNotMet();
        }

        // Check minimum submissions
        uint256[] storage submissions = _roundSubmissions[novelId][novel.currentRound];
        if (submissions.length < config.roundMinSubmissions) {
            revert RoundConditionsNotMet();
        }

        // Initialize voting in VotingEngine
        uint256 votingRoundId = _computeVotingRoundId(novelId, novel.currentEpoch, novel.currentRound, false);
        votingEngine.initializeVoting(novelId, votingRoundId, submissions);

        // Transition to Committing
        novel.roundPhase = DataTypes.RoundPhase.Committing;
        novel.phaseStartTime = block.timestamp;

        emit RoundPhaseChanged(novelId, novel.currentRound, DataTypes.RoundPhase.Committing);
    }

    /// @inheritdoc INovelCore
    function closeCommit(uint256 novelId) external whenNotPaused {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);

        if (novel.roundPhase != DataTypes.RoundPhase.Committing) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Committing, novel.roundPhase);
        }

        // Check commit duration elapsed
        if (block.timestamp < novel.phaseStartTime + novel.config.commitDuration) {
            revert PhaseNotExpired();
        }

        // Transition to Revealing
        novel.roundPhase = DataTypes.RoundPhase.Revealing;
        novel.phaseStartTime = block.timestamp;

        emit RoundPhaseChanged(novelId, novel.currentRound, DataTypes.RoundPhase.Revealing);
    }

    /// @inheritdoc INovelCore
    function settleRound(uint256 novelId) external whenNotPaused {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);

        if (novel.roundPhase != DataTypes.RoundPhase.Revealing) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Revealing, novel.roundPhase);
        }

        // Check reveal duration elapsed
        if (block.timestamp < novel.phaseStartTime + novel.config.revealDuration) {
            revert PhaseNotExpired();
        }

        // Tally votes
        uint256 votingRoundId = _computeVotingRoundId(novelId, novel.currentEpoch, novel.currentRound, false);
        uint256[] memory rankedIds = votingEngine.tallyVotes(novelId, votingRoundId);

        // Select top N as world lines
        uint32 N = novel.config.worldLineCount;
        uint256 selectCount = rankedIds.length < N ? rankedIds.length : N;

        // Clear old world lines and set new ones
        delete _activeWorldLines[novelId];

        uint256[] memory selectedIds = new uint256[](selectCount);
        for (uint256 i = 0; i < selectCount; i++) {
            uint256 selectedId = rankedIds[i];
            _chapters[selectedId].isWorldLine = true;
            _activeWorldLines[novelId].push(selectedId);
            selectedIds[i] = selectedId;
        }

        // Update pollution records for submitters
        _updatePollutionRecords(novelId, novel.currentRound, rankedIds);

        // Return stakes for all submitters in this round
        // (Pollution-based slashing is separate from round settlement)
        _returnRoundStakes(novelId, novel.currentRound);

        emit WorldLinesSelected(novelId, novel.currentRound, selectedIds);

        // Check if this was the last round in the epoch
        if (novel.currentRound >= novel.config.roundsPerEpoch) {
            // Transition to Epoch voting
            novel.epochPhase = DataTypes.EpochPhase.Committing;
            novel.roundPhase = DataTypes.RoundPhase.Settling;
            novel.phaseStartTime = block.timestamp;

            // Initialize epoch voting with world lines as candidates
            uint256 epochVotingId = _computeVotingRoundId(novelId, novel.currentEpoch, novel.currentRound, true);
            votingEngine.initializeVoting(novelId, epochVotingId, _activeWorldLines[novelId]);

            emit EpochPhaseChanged(novelId, novel.currentEpoch, DataTypes.EpochPhase.Committing);
        } else {
            // Next round
            novel.currentRound++;
            novel.roundPhase = DataTypes.RoundPhase.Submitting;
            novel.phaseStartTime = block.timestamp;

            emit RoundPhaseChanged(novelId, novel.currentRound, DataTypes.RoundPhase.Submitting);
        }
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

        novel.epochPhase = DataTypes.EpochPhase.Revealing;
        novel.phaseStartTime = block.timestamp;

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

        // The top-voted world line becomes Canon
        uint256 canonWorldLineId = rankedWorldLines[0];
        _chapters[canonWorldLineId].isCanon = true;

        emit CanonEstablished(novelId, novel.currentEpoch, canonWorldLineId);

        // Collect all canon chapter authors (trace the winning world line's path)
        // For simplicity in this phase, the canon is the single winning chapter
        // In full implementation, we'd trace the entire chain from genesis to this world line
        address[] memory canonAuthors = _collectCanonAuthors(novelId, canonWorldLineId);

        // Mint NFTs for canon chapters
        _mintCanonNFTs(novelId, novel.currentEpoch, canonWorldLineId);

        // Distribute prize pool rewards
        prizePool.distributeEpochRewards(novelId, novel.currentEpoch, canonAuthors, novel.config.prizeReleaseRate);

        // Reset for next epoch: Canon becomes the sole world line
        delete _activeWorldLines[novelId];
        _activeWorldLines[novelId].push(canonWorldLineId);

        novel.currentEpoch++;
        novel.currentRound = 1;
        novel.roundPhase = DataTypes.RoundPhase.Submitting;
        novel.epochPhase = DataTypes.EpochPhase.Rounds;
        novel.phaseStartTime = block.timestamp;

        emit EpochPhaseChanged(novelId, novel.currentEpoch, DataTypes.EpochPhase.Rounds);
        emit RoundPhaseChanged(novelId, novel.currentRound, DataTypes.RoundPhase.Submitting);
    }

    // ============================================================
    //                      STAKE CLAIMS
    // ============================================================

    /// @inheritdoc INovelCore
    function claimStakeRefund(uint256 novelId) external nonReentrant whenNotPaused {
        uint256 amount = _stakeBalances[novelId][msg.sender];
        if (amount == 0) revert NoStakeToRefund();

        _stakeBalances[novelId][msg.sender] = 0;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit StakeRefunded(novelId, msg.sender, amount);
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

    // ============================================================
    //                    INTERNAL HELPERS
    // ============================================================

    /// @dev Validate novel configuration parameters
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
        if (config.prizeReleaseRate > 10000) revert InvalidConfig("prizeReleaseRate must be <= 10000");
        if (config.commitDuration == 0) revert InvalidConfig("commitDuration must be > 0");
        if (config.revealDuration == 0) revert InvalidConfig("revealDuration must be > 0");
    }

    /// @dev Check if a chapter ID is in the active world lines of a novel
    function _isActiveWorldLine(uint256 novelId, uint256 chapterId) internal view returns (bool) {
        uint256[] storage worldLines = _activeWorldLines[novelId];
        for (uint256 i = 0; i < worldLines.length; i++) {
            if (worldLines[i] == chapterId) return true;
        }
        return false;
    }

    /// @dev Compute a unique voting round ID
    /// @param isEpoch Whether this is an epoch vote (vs round vote)
    function _computeVotingRoundId(uint256 novelId, uint32 epoch, uint32 round, bool isEpoch)
        internal
        pure
        returns (uint256)
    {
        // Pack into a unique uint256: novelId in high bits, epoch, round, and isEpoch flag
        return uint256(keccak256(abi.encodePacked(novelId, epoch, round, isEpoch)));
    }

    /// @dev Return stakes for all submitters in a given round
    function _returnRoundStakes(uint256 novelId, uint32 round) internal {
        uint256[] storage submissions = _roundSubmissions[novelId][round];
        DataTypes.NovelConfig storage config = _novels[novelId].config;

        for (uint256 i = 0; i < submissions.length; i++) {
            DataTypes.Chapter storage chapter = _chapters[submissions[i]];
            address author = chapter.author;

            // Check for pollution-based slashing
            DataTypes.PollutionRecord storage record = _pollutionRecords[novelId][author];
            if (record.consecutiveStrikes >= config.pollutionRounds && config.pollutionRounds > 0) {
                // Slash 50% of stake for this submission
                uint256 slashAmount = config.stakeAmount / 2;
                uint256 refundAmount = config.stakeAmount - slashAmount;

                if (_stakeBalances[novelId][author] >= config.stakeAmount) {
                    _stakeBalances[novelId][author] -= config.stakeAmount;

                    // Refund the non-slashed portion
                    if (refundAmount > 0) {
                        _stakeBalances[novelId][author] += refundAmount;
                    }

                    // Send slashed amount to prize pool
                    if (slashAmount > 0) {
                        prizePool.deposit{value: slashAmount}(novelId, "pollution_slash");
                        emit StakeSlashed(novelId, author, slashAmount);
                    }
                }

                // Reset strikes after slashing
                record.consecutiveStrikes = 0;
            }
            // Normal case: stake stays in _stakeBalances, claimable by author
        }
    }

    /// @dev Update pollution records based on voting results
    /// @notice Skips pollution tracking when fewer than 10 submissions to avoid small-sample false positives
    function _updatePollutionRecords(uint256 novelId, uint32 round, uint256[] memory rankedIds) internal {
        DataTypes.NovelConfig storage config = _novels[novelId].config;
        if (config.pollutionThreshold == 0 || rankedIds.length < 10) return;

        // Calculate the cutoff index for "bottom X%"
        uint256 bottomCount = (rankedIds.length * config.pollutionThreshold) / 100;
        if (bottomCount == 0) bottomCount = 1; // At least 1

        uint256 bottomStartIdx = rankedIds.length - bottomCount;

        // Authors in bottom portion get a strike
        for (uint256 i = bottomStartIdx; i < rankedIds.length; i++) {
            address author = _chapters[rankedIds[i]].author;
            DataTypes.PollutionRecord storage record = _pollutionRecords[novelId][author];

            if (record.lastRecordedRound == round - 1 || record.lastRecordedRound == 0) {
                // Consecutive
                record.consecutiveStrikes++;
            } else {
                // Reset: not consecutive
                record.consecutiveStrikes = 1;
            }
            record.lastRecordedRound = round;
        }

        // Authors NOT in bottom portion: reset their strikes if they submitted this round
        for (uint256 i = 0; i < bottomStartIdx; i++) {
            address author = _chapters[rankedIds[i]].author;
            DataTypes.PollutionRecord storage record = _pollutionRecords[novelId][author];
            if (record.consecutiveStrikes > 0) {
                record.consecutiveStrikes = 0;
            }
            record.lastRecordedRound = round;
        }
    }

    /// @dev Collect authors of canon chapters by tracing the path
    /// @notice Traces the winning world line's parentId chain back to genesis,
    ///         collecting authors of chapters that belong to the current epoch.
    function _collectCanonAuthors(uint256 novelId, uint256 canonWorldLineId) internal view returns (address[] memory) {
        uint32 currentEpoch = _novels[novelId].currentEpoch;

        // Trace back from canon world line to collect chapter authors in this epoch
        uint256[] memory authorChapterIds = new uint256[](32); // Max depth
        uint256 count = 0;
        uint256 currentId = canonWorldLineId;

        while (currentId != 0 && count < 32) {
            DataTypes.Chapter storage ch = _chapters[currentId];
            if (ch.novelId != novelId) break;

            // Only include chapters from the current epoch (filter by epoch)
            if (ch.epoch == currentEpoch && ch.round > 0) {
                authorChapterIds[count] = currentId;
                count++;
            } else if (ch.epoch < currentEpoch) {
                // Reached previous epoch's territory, stop tracing
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

    /// @dev Mint NFTs for canon chapters in the current epoch only
    function _mintCanonNFTs(uint256 novelId, uint32 epoch, uint256 canonWorldLineId) internal {
        uint256 currentId = canonWorldLineId;

        while (currentId != 0) {
            DataTypes.Chapter storage ch = _chapters[currentId];
            if (ch.novelId != novelId) break;

            // Only mint for chapters from the current epoch
            if (ch.epoch == epoch && ch.round > 0 && !chapterNFT.isChapterMinted(novelId, currentId)) {
                ch.isCanon = true;
                chapterNFT.mint(ch.author, novelId, currentId, epoch, ch.contentHash);
            } else if (ch.epoch < epoch) {
                break; // Reached previous epoch, stop
            }

            currentId = ch.parentId;
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
