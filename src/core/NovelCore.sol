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
/// @notice Core coordinator for the Decentralized Collaborative Novel Protocol.
///         Writing is always-on; voting is a periodic cycle decoupled from chapter submission.
///         Chapter tree with bidirectional traversal. DFS-based candidate generation.
/// @dev UUPS-upgradeable. Coordinates VotingEngine, PrizePool, and RulesEngine.
contract NovelCore is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuard,
    PausableUpgradeable,
    UUPSUpgradeable,
    INovelCore
{
    // ============================================================
    //                         CONSTANTS
    // ============================================================

    /// @notice Inactivity timeout after which anyone can complete a novel
    uint64 public constant INACTIVITY_TIMEOUT = 30 days;

    /// @notice Fork fee rate in basis points (1% of source pool balance)
    uint16 public constant FORK_FEE_RATE = 100;

    /// @notice Basis points denominator
    uint16 private constant BPS_DENOMINATOR = 10000;

    /// @notice Maximum chapters to collect in path-walking functions
    uint256 private constant MAX_PATH_CHAPTERS = 256;

    /// @notice Maximum steps when walking up the chapter tree
    uint256 private constant MAX_TREE_WALK_STEPS = 1000;

    /// @notice Maximum steps for eligible new author collection
    uint256 private constant MAX_AUTHOR_WALK_STEPS = 500;

    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice External module references
    IVotingEngine public votingEngine;
    IPrizePool public prizePool;
    IRulesEngine public rulesEngine;

    /// @notice Maximum DFS nodes to traverse in startRound (owner-settable)
    uint32 public maxDfsNodes;

    /// @notice Novel counter (also used as next novel ID)
    uint64 private _novelCount;

    /// @notice Chapter counter (global across all novels)
    uint64 private _chapterCount;

    /// @notice Novel ID => Novel data
    mapping(uint64 => DataTypes.Novel) private _novels;

    /// @notice Chapter ID => Chapter data
    mapping(uint64 => DataTypes.Chapter) private _chapters;

    /// @notice Novel ID => mutable metadata
    mapping(uint64 => DataTypes.NovelMetadata) private _novelMetadata;

    /// @notice Novel ID => root chapter ID
    mapping(uint64 => uint64) private _novelRootId;

    /// @notice Novel ID => current world line ancestor chapter IDs
    mapping(uint64 => uint64[]) private _worldLineAncestors;

    /// @notice Novel ID => round number => round data
    mapping(uint64 => mapping(uint32 => DataTypes.RoundData)) private _rounds;

    /// @notice Novel ID => author => is world line author (for RulesEngine)
    mapping(uint64 => mapping(address => bool)) private _isWorldLineAuthor;

    /// @notice Novel ID => round => total committed vote stake
    mapping(uint64 => mapping(uint32 => uint256)) private _roundCommittedStakes;

    /// @notice Novel ID => round => total revealed vote stake
    mapping(uint64 => mapping(uint32 => uint256)) private _roundRevealedStakes;


    // ============================================================
    //                         ERRORS
    // ============================================================

    error InvalidConfig(uint8 code);
    error NovelNotFound(uint64 novelId);
    error NovelNotActive(uint64 novelId);
    error ChapterNotFound(uint64 chapterId);
    error InvalidFee(uint256 sent, uint256 required);
    error ContentLengthOutOfRange(uint64 length, uint64 min, uint64 max);
    error WrongRoundPhase(DataTypes.RoundPhase expected, DataTypes.RoundPhase actual);
    error PhaseNotExpired();
    error TransferFailed();
    error ChapterNotInNovel(uint64 chapterId, uint64 novelId);
    error NotNovelCreator(uint64 novelId, address caller);
    error InvalidMetadata();
    error ContentHashMismatch(bytes32 expected, bytes32 actual);
    error OnchainContentRequired();
    error OnchainContentForbidden();
    error NoCandidatesFound();
    error MinRoundGapNotMet();
    error DuplicateCandidate(uint64 chapterId);
    error NotACandidate(uint64 chapterId);
    error CompletionNotAllowed();
    error NovelAlreadyCompleted(uint64 novelId);
    error ZeroAddress();
    error InsufficientForkFee(uint256 sent, uint256 required);

    // ============================================================
    //                      INITIALIZER
    // ============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address votingEngine_, address prizePool_, address rulesEngine_)
        external
        initializer
    {
        if (votingEngine_ == address(0) || prizePool_ == address(0)) revert ZeroAddress();

        __Ownable_init(owner_);
        __Pausable_init();

        votingEngine = IVotingEngine(votingEngine_);
        prizePool = IPrizePool(prizePool_);
        rulesEngine = IRulesEngine(rulesEngine_);
        maxDfsNodes = 500;
    }

    // ============================================================
    //                     ADMIN FUNCTIONS
    // ============================================================

    event VotingEngineUpdated(address indexed oldAddr, address indexed newAddr);
    event PrizePoolUpdated(address indexed oldAddr, address indexed newAddr);
    event RulesEngineUpdated(address indexed oldAddr, address indexed newAddr);
    event MaxDfsNodesUpdated(uint32 oldVal, uint32 newVal);

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

    function setRulesEngine(address addr) external onlyOwner {
        address old = address(rulesEngine);
        rulesEngine = IRulesEngine(addr);
        emit RulesEngineUpdated(old, addr);
    }

    function setMaxDfsNodes(uint32 val) external onlyOwner {
        uint32 old = maxDfsNodes;
        maxDfsNodes = val;
        emit MaxDfsNodesUpdated(old, val);
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
    function createNovel(
        DataTypes.NovelConfig calldata config,
        DataTypes.NovelMetadata calldata metadata,
        DataTypes.ContentSubmission calldata rootChapter
    ) external payable whenNotPaused returns (uint64 novelId) {
        _validateConfig(config);
        _validateMetadata(metadata);
        _validateSubmission(config, rootChapter);

        if (msg.value < config.submissionFee) {
            revert InvalidFee(msg.value, config.submissionFee);
        }

        novelId = ++_novelCount;

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

        // Create root chapter: parentId=0, depth=1
        uint64 rootId = ++_chapterCount;
        _chapters[rootId] = DataTypes.Chapter({
            id: rootId,
            novelId: novelId,
            parentId: 0,
            author: msg.sender,
            contentHash: rootChapter.contentHash,
            declaredLength: rootChapter.declaredLength,
            depth: 1,
            timestamp: uint64(block.timestamp),
            descendants: new uint64[](0)
        });

        _novelRootId[novelId] = rootId;
        _worldLineAncestors[novelId].push(rootId);
        _isWorldLineAuthor[novelId][msg.sender] = true;

        // Submission fee + excess go to prize pool as genesis fund
        if (msg.value > 0) {
            prizePool.deposit{value: msg.value}(novelId, "genesis");
        }

        emit NovelCreated(novelId, msg.sender);
        emit ChapterSubmitted(novelId, rootId, msg.sender, 0, 1);
    }

    /// @inheritdoc INovelCore
    function forkNovel(
        uint64 sourceChapterId,
        DataTypes.NovelConfig calldata config,
        DataTypes.NovelMetadata calldata metadata,
        DataTypes.ContentSubmission calldata rootChapter
    ) external payable whenNotPaused returns (uint64 novelId) {
        // Validate source chapter exists
        DataTypes.Chapter storage sourceCh = _chapters[sourceChapterId];
        if (sourceCh.id == 0) revert ChapterNotFound(sourceChapterId);

        uint64 sourceNovelId = sourceCh.novelId;
        DataTypes.Novel storage sourceNovel = _novels[sourceNovelId];

        // Fork fee = max(submissionFee, sourcePoolBalance * forkFeeRate / 10000)
        uint256 sourcePoolBalance = prizePool.getPoolBalance(sourceNovelId);
        uint256 forkFee = sourcePoolBalance * FORK_FEE_RATE / BPS_DENOMINATOR;
        if (forkFee < config.submissionFee) {
            forkFee = config.submissionFee;
        }
        uint256 totalRequired = forkFee + config.submissionFee;
        if (msg.value < totalRequired) {
            revert InsufficientForkFee(msg.value, totalRequired);
        }

        _validateConfig(config);
        _validateMetadata(metadata);

        // Inherit contentLocation from source novel
        DataTypes.NovelConfig memory finalConfig = config;
        finalConfig.contentLocation = sourceNovel.config.contentLocation;
        finalConfig.contentBaseUrl = sourceNovel.config.contentBaseUrl;

        _validateSubmission(finalConfig, rootChapter);

        novelId = ++_novelCount;

        _novels[novelId] = DataTypes.Novel({
            id: novelId,
            creator: msg.sender,
            config: finalConfig,
            currentRound: 0,
            roundPhase: DataTypes.RoundPhase.Idle,
            phaseStartTime: uint64(block.timestamp),
            lastSettleTime: 0,
            active: true
        });

        _novelMetadata[novelId] = metadata;

        // Create fork root: parentId = sourceChapterId (cross-novel!), depth = 1
        uint64 rootId = ++_chapterCount;
        _chapters[rootId] = DataTypes.Chapter({
            id: rootId,
            novelId: novelId,
            parentId: sourceChapterId,
            author: msg.sender,
            contentHash: rootChapter.contentHash,
            declaredLength: rootChapter.declaredLength,
            depth: 1,
            timestamp: uint64(block.timestamp),
            descendants: new uint64[](0)
        });

        _novelRootId[novelId] = rootId;
        _worldLineAncestors[novelId].push(rootId);
        _isWorldLineAuthor[novelId][msg.sender] = true;

        // Fork fee to source novel's prize pool
        prizePool.deposit{value: forkFee}(sourceNovelId, "forkFee");

        // Remaining to new novel's prize pool (submission fee + any excess)
        uint256 remaining = msg.value - forkFee;
        if (remaining > 0) {
            prizePool.deposit{value: remaining}(novelId, "genesis");
        }

        emit NovelForked(novelId, sourceChapterId, msg.sender);
        emit ChapterSubmitted(novelId, rootId, msg.sender, sourceChapterId, 1);
    }

    // ============================================================
    //                   CHAPTER SUBMISSION
    // ============================================================

    /// @inheritdoc INovelCore
    function submitChapter(uint64 novelId, uint64 parentId, DataTypes.ContentSubmission calldata submission)
        external
        payable
        whenNotPaused
    {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (!novel.active) revert NovelNotActive(novelId);

        if (msg.value != novel.config.submissionFee) {
            revert InvalidFee(msg.value, novel.config.submissionFee);
        }

        // Validate parent belongs to this novel
        DataTypes.Chapter storage parent = _chapters[parentId];
        if (parent.id == 0) revert ChapterNotFound(parentId);
        if (parent.novelId != novelId) revert ChapterNotInNovel(parentId, novelId);

        _validateSubmission(novel.config, submission);

        // Create chapter
        uint64 chapterId = ++_chapterCount;
        uint32 newDepth = parent.depth + 1;

        _chapters[chapterId] = DataTypes.Chapter({
            id: chapterId,
            novelId: novelId,
            parentId: parentId,
            author: msg.sender,
            contentHash: submission.contentHash,
            declaredLength: submission.declaredLength,
            depth: newDepth,
            timestamp: uint64(block.timestamp),
            descendants: new uint64[](0)
        });

        // Bidirectional link: push to parent's descendants
        _chapters[parentId].descendants.push(chapterId);

        // Fee to prize pool
        if (msg.value > 0) {
            prizePool.deposit{value: msg.value}(novelId, "submissionFee");
        }

        emit ChapterSubmitted(novelId, chapterId, msg.sender, parentId, newDepth);
    }

    // ============================================================
    //                  ROUND STATE TRANSITIONS
    // ============================================================

    /// @inheritdoc INovelCore
    function startRound(uint64 novelId) external whenNotPaused {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (!novel.active) revert NovelNotActive(novelId);

        if (novel.roundPhase != DataTypes.RoundPhase.Idle) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Idle, novel.roundPhase);
        }

        // Enforce minRoundGap (skip for first round)
        if (novel.currentRound > 0) {
            if (block.timestamp < novel.lastSettleTime + novel.config.minRoundGap) {
                revert MinRoundGapNotMet();
            }
        }

        // DFS from worldLineAncestors (or root for first round) to find candidates
        uint64[] storage ancestors = _worldLineAncestors[novelId];
        uint32 maxCandidates = 3 * novel.config.worldLineCount;

        uint64[] memory candidates = _dfsDeepestChains(novelId, ancestors, maxCandidates);
        if (candidates.length == 0) revert NoCandidatesFound();

        // Increment round
        novel.currentRound++;
        uint32 round = novel.currentRound;

        // Store round data
        DataTypes.RoundData storage rd = _rounds[novelId][round];

        // Store candidates and mark all as eligible (they come from world line DFS)
        for (uint256 i = 0; i < candidates.length; i++) {
            rd.candidates.push(candidates[i]);
            rd.candidateIsEligible.push(true);
        }

        // Store previous world lines for settlement path computation
        for (uint256 i = 0; i < ancestors.length; i++) {
            rd.prevWorldLines.push(ancestors[i]);
        }

        // Set phase timing
        uint64 now_ = uint64(block.timestamp);
        novel.roundPhase = DataTypes.RoundPhase.Nominating;
        novel.phaseStartTime = now_;
        rd.nominateEndTime = now_ + novel.config.nominateDuration;

        // Initialize voting in VotingEngine
        votingEngine.initializeVoting(novelId, round, candidates);

        // Pay keeper
        _payKeeper(novelId);

        emit RoundStarted(novelId, round, candidates);
    }

    /// @inheritdoc INovelCore
    function closeNomination(uint64 novelId) external whenNotPaused {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);

        if (novel.roundPhase != DataTypes.RoundPhase.Nominating) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Nominating, novel.roundPhase);
        }

        DataTypes.RoundData storage rd = _rounds[novelId][novel.currentRound];
        if (block.timestamp < rd.nominateEndTime) revert PhaseNotExpired();

        uint64 now_ = uint64(block.timestamp);
        novel.roundPhase = DataTypes.RoundPhase.Committing;
        novel.phaseStartTime = now_;
        rd.commitEndTime = now_ + novel.config.commitDuration;

        _payKeeper(novelId);

        emit NominationClosed(novelId, novel.currentRound);
    }

    /// @inheritdoc INovelCore
    function closeCommit(uint64 novelId) external whenNotPaused {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);

        if (novel.roundPhase != DataTypes.RoundPhase.Committing) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Committing, novel.roundPhase);
        }

        DataTypes.RoundData storage rd = _rounds[novelId][novel.currentRound];
        if (block.timestamp < rd.commitEndTime) revert PhaseNotExpired();

        uint64 now_ = uint64(block.timestamp);
        novel.roundPhase = DataTypes.RoundPhase.Revealing;
        novel.phaseStartTime = now_;
        rd.revealEndTime = now_ + novel.config.revealDuration;

        _payKeeper(novelId);

        emit CommitClosed(novelId, novel.currentRound);
    }

    /// @inheritdoc INovelCore
    function settleRound(uint64 novelId) external whenNotPaused nonReentrant {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);

        if (novel.roundPhase != DataTypes.RoundPhase.Revealing) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Revealing, novel.roundPhase);
        }

        DataTypes.RoundData storage rd = _rounds[novelId][novel.currentRound];
        if (block.timestamp < rd.revealEndTime) revert PhaseNotExpired();

        uint32 round = novel.currentRound;
        uint32 N = novel.config.worldLineCount;

        // Tally votes — pass only actual top-N winners for accurate reward computation
        (uint64[] memory rankedIds,) = votingEngine.tallyVotes(novelId, round, N);

        // Select top N winners (or fewer)
        uint256 selectCount = rankedIds.length < N ? rankedIds.length : N;

        // Collect new world line chapters: for each winner, walk up to the corresponding
        // prevWorldLine ancestor. Deduplicate across all winners.
        uint64[] memory winners = new uint64[](selectCount);
        for (uint256 i = 0; i < selectCount; i++) {
            winners[i] = rankedIds[i];
        }

        // Collect per-chapter authors from eligible winners' new world line paths.
        // Ineligible winners (nominated but not world-line descendants) are excluded
        // from author rewards per design spec section 5.4.
        address[] memory rewardAuthors = _collectEligibleNewAuthors(novelId, winners, rd);

        // Distribute round rewards from prize pool (skip if no new authors)
        uint256 voterRewards = 0;
        if (rewardAuthors.length > 0) {
            voterRewards = prizePool.distributeRoundRewards(
                novelId,
                round,
                novel.creator,
                rewardAuthors,
                novel.config.prizeReleaseRate,
                novel.config.voterRewardRate
            );
        }

        // Compute unrevealed stakes (committed - revealed)
        uint256 totalCommitted = _roundCommittedStakes[novelId][round];
        uint256 totalRevealed = _roundRevealedStakes[novelId][round];
        uint256 unrevealedStakes = totalCommitted > totalRevealed ? totalCommitted - totalRevealed : 0;

        if (totalRevealed > 0) {
            // Send vote stakes + voter rewards to VotingEngine for distribution
            uint256 totalToVotingEngine = voterRewards + totalCommitted;
            if (totalToVotingEngine > 0) {
                (bool sent,) = address(votingEngine).call{value: totalToVotingEngine}("");
                if (!sent) revert TransferFailed();
            }

            // Settle voter rewards in VotingEngine
            votingEngine.settleVoterRewards(novelId, round, voterRewards, unrevealedStakes);
        } else {
            // No voters revealed — return voter rewards + unrevealed stakes to prize pool
            // to prevent funds from being permanently locked in VotingEngine
            uint256 returnToPool = voterRewards + unrevealedStakes;
            if (returnToPool > 0) {
                prizePool.deposit{value: returnToPool}(novelId, "noReveals");
            }
        }

        // Update worldLineAncestors
        delete _worldLineAncestors[novelId];

        // Clear old world line author flags
        // (We rebuild from scratch based on new world lines)
        // Note: we cannot iterate all authors, so we track a superset approach.
        // Instead, we only ADD new authors and never clear — RulesEngine checks
        // current world line paths. For a clean approach, we clear known authors
        // from prevWorldLines and set new ones.
        _clearWorldLineAuthors(novelId, rd.prevWorldLines);

        for (uint256 i = 0; i < selectCount; i++) {
            _worldLineAncestors[novelId].push(winners[i]);
        }

        // Set world line authors from root to each winner
        _setWorldLineAuthors(novelId, winners);

        // Mark round as settled
        rd.settled = true;
        novel.roundPhase = DataTypes.RoundPhase.Idle;
        novel.lastSettleTime = uint64(block.timestamp);
        novel.phaseStartTime = uint64(block.timestamp);

        _payKeeper(novelId);

        emit RoundSettled(novelId, round, _worldLineAncestors[novelId]);
    }

    // ============================================================
    //                   NOMINATION & VOTING
    // ============================================================

    /// @inheritdoc INovelCore
    function nominateCandidate(uint64 novelId, uint64 chapterId) external payable whenNotPaused {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);

        if (novel.roundPhase != DataTypes.RoundPhase.Nominating) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Nominating, novel.roundPhase);
        }

        if (msg.value != novel.config.nominationFee) {
            revert InvalidFee(msg.value, novel.config.nominationFee);
        }

        // Validate chapter belongs to novel
        DataTypes.Chapter storage ch = _chapters[chapterId];
        if (ch.id == 0) revert ChapterNotFound(chapterId);
        if (ch.novelId != novelId) revert ChapterNotInNovel(chapterId, novelId);

        DataTypes.RoundData storage rd = _rounds[novelId][novel.currentRound];

        // Check not already a candidate
        for (uint256 i = 0; i < rd.candidates.length; i++) {
            if (rd.candidates[i] == chapterId) revert DuplicateCandidate(chapterId);
        }

        // Determine eligibility: is it a descendant of any worldLineAncestor?
        // Walk up parentId from chapterId to see if we hit a world line ancestor.
        bool eligible = _isDescendantOfWorldLine(novelId, chapterId);

        rd.candidates.push(chapterId);
        rd.candidateIsEligible.push(eligible);

        // Sync new candidate to VotingEngine so voters can reveal votes for it
        votingEngine.addCandidate(novelId, novel.currentRound, chapterId);

        // Fee to prize pool
        if (msg.value > 0) {
            prizePool.deposit{value: msg.value}(novelId, "nominationFee");
        }

        emit CandidateNominated(novelId, novel.currentRound, chapterId, msg.sender);
    }

    /// @inheritdoc INovelCore
    function commitVote(uint64 novelId, bytes32 commitHash) external payable whenNotPaused {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);

        if (novel.roundPhase != DataTypes.RoundPhase.Committing) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Committing, novel.roundPhase);
        }

        if (msg.value != novel.config.voteStake) {
            revert InvalidFee(msg.value, novel.config.voteStake);
        }

        uint32 round = novel.currentRound;
        votingEngine.commitVote(novelId, round, msg.sender, commitHash, msg.value);
        _roundCommittedStakes[novelId][round] += msg.value;

        emit VoteCommitted(novelId, round, msg.sender);
    }

    /// @inheritdoc INovelCore
    function revealVote(uint64 novelId, uint64 candidateId, bytes32 salt) external whenNotPaused {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);

        if (novel.roundPhase != DataTypes.RoundPhase.Revealing) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Revealing, novel.roundPhase);
        }

        uint32 round = novel.currentRound;
        votingEngine.revealVote(novelId, round, msg.sender, candidateId, salt);
        _roundRevealedStakes[novelId][round] += novel.config.voteStake;

        emit VoteRevealed(novelId, round, msg.sender, candidateId);
    }

    // ============================================================
    //                     REWARDS & TIPS
    // ============================================================

    /// @inheritdoc INovelCore
    function claimReward(uint64 novelId) external nonReentrant whenNotPaused {
        uint256 amount = prizePool.claimReward(novelId, msg.sender);
        if (amount > 0) {
            emit RewardClaimed(novelId, msg.sender, amount);
        }
    }

    /// @notice Claim voting reward (stake refund + accuracy reward) for a specific round
    /// @param novelId The novel ID
    /// @param round The round number
    function claimVotingReward(uint64 novelId, uint32 round) external nonReentrant whenNotPaused {
        uint256 amount = votingEngine.claimVotingReward(novelId, round, msg.sender);
        if (amount > 0) {
            emit RewardClaimed(novelId, msg.sender, amount);
        }
    }

    /// @inheritdoc INovelCore
    function tipNovel(uint64 novelId) external payable whenNotPaused {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);

        prizePool.tipNovel{value: msg.value}(novelId);

        emit Tipped(novelId, 0, msg.sender, msg.value);
    }

    /// @inheritdoc INovelCore
    function tipChapter(uint64 chapterId) external payable whenNotPaused nonReentrant {
        DataTypes.Chapter storage ch = _chapters[chapterId];
        if (ch.id == 0) revert ChapterNotFound(chapterId);

        prizePool.tipChapter{value: msg.value}(chapterId, ch.author, ch.novelId);

        emit Tipped(ch.novelId, chapterId, msg.sender, msg.value);
    }

    // ============================================================
    //                      MANAGEMENT
    // ============================================================

    /// @inheritdoc INovelCore
    function completeNovel(uint64 novelId) external whenNotPaused nonReentrant {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (!novel.active) revert NovelAlreadyCompleted(novelId);

        // Cannot complete during an active voting round — voter stakes would lose rewards
        if (novel.roundPhase != DataTypes.RoundPhase.Idle) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Idle, novel.roundPhase);
        }

        // Creator can call anytime; anyone can call after inactivity timeout
        if (msg.sender != novel.creator) {
            // Find the latest chapter timestamp among world line ancestors
            uint64 lastActivity = novel.phaseStartTime;
            uint64[] storage ancestors = _worldLineAncestors[novelId];
            for (uint256 i = 0; i < ancestors.length; i++) {
                uint64 ts = _chapters[ancestors[i]].timestamp;
                if (ts > lastActivity) lastActivity = ts;
            }
            if (block.timestamp < lastActivity + INACTIVITY_TIMEOUT) {
                revert CompletionNotAllowed();
            }
        }

        // Final distribution: collect all chapters from root to each worldLineAncestor (dedup)
        uint64[] storage finalAncestors = _worldLineAncestors[novelId];
        address[] memory finalAuthors = _collectPathAuthors(novelId, finalAncestors);

        // Distribute final rewards (release entire remaining pool)
        if (finalAuthors.length > 0) {
            prizePool.distributeRoundRewards(
                novelId,
                novel.currentRound > 0 ? novel.currentRound : 1,
                novel.creator,
                finalAuthors,
                10000, // Release entire pool
                0 // No voter rewards in final distribution
            );
        }

        novel.active = false;

        emit NovelCompleted(novelId);
    }

    /// @inheritdoc INovelCore
    function updateNovelMetadata(uint64 novelId, DataTypes.NovelMetadata calldata metadata) external {
        DataTypes.Novel storage novel = _novels[novelId];
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (novel.creator != msg.sender) revert NotNovelCreator(novelId, msg.sender);
        _validateMetadata(metadata);

        _novelMetadata[novelId] = metadata;
        emit NovelMetadataUpdated(novelId, metadata.title, metadata.description, metadata.coverUri);
    }

    // ============================================================
    //                        QUERIES
    // ============================================================

    /// @inheritdoc INovelCore
    function getNovel(uint64 novelId) external view returns (DataTypes.Novel memory) {
        return _novels[novelId];
    }

    /// @inheritdoc INovelCore
    function getChapter(uint64 chapterId) external view returns (DataTypes.Chapter memory) {
        return _chapters[chapterId];
    }

    /// @inheritdoc INovelCore
    function getWorldLineAncestors(uint64 novelId) external view returns (uint64[] memory) {
        return _worldLineAncestors[novelId];
    }

    /// @inheritdoc INovelCore
    function getRoundData(uint64 novelId, uint32 round) external view returns (DataTypes.RoundData memory) {
        return _rounds[novelId][round];
    }

    /// @inheritdoc INovelCore
    function getChapterDescendants(uint64 chapterId) external view returns (uint64[] memory) {
        return _chapters[chapterId].descendants;
    }

    /// @inheritdoc INovelCore
    function isWorldLineAuthor(uint64 novelId, address author) external view returns (bool) {
        return _isWorldLineAuthor[novelId][author];
    }

    /// @inheritdoc INovelCore
    function getNovelCount() external view returns (uint64) {
        return _novelCount;
    }

    /// @inheritdoc INovelCore
    function getChapterCount() external view returns (uint64) {
        return _chapterCount;
    }

    /// @inheritdoc INovelCore
    function getNovelMetadata(uint64 novelId) external view returns (DataTypes.NovelMetadata memory) {
        return _novelMetadata[novelId];
    }

    // ============================================================
    //                    INTERNAL: DFS
    // ============================================================

    /// @dev Iterative DFS from each ancestor to find the deepest leaf on each distinct path.
    ///      Returns top `maxCandidates` chapter IDs sorted by depth descending.
    ///      Bounded by maxDfsNodes to prevent gas exhaustion.
    ///      Tracks visited nodes to avoid duplicates when ancestors share overlapping paths.
    function _dfsDeepestChains(uint64 novelId, uint64[] storage ancestors, uint32 maxCandidates)
        internal
        view
        returns (uint64[] memory candidateIds)
    {
        uint32 nodeLimit = maxDfsNodes;
        uint32 nodesVisited = 0;

        // Temporary arrays — we collect leaf chapters (no descendants or at node limit)
        // Use a generous upper bound; will trim at end.
        uint64[] memory leaves = new uint64[](maxCandidates * 4 > 256 ? maxCandidates * 4 : 256);
        uint32[] memory leafDepths = new uint32[](leaves.length);
        uint256 leafCount = 0;

        // DFS stack: (chapterId)
        uint64[] memory stack = new uint64[](nodeLimit > 0 ? nodeLimit : 500);
        uint256 stackTop = 0;

        // Track visited nodes to prevent duplicates when ancestors share overlapping paths
        uint64[] memory visited = new uint64[](nodeLimit > 0 ? nodeLimit : 500);
        uint256 visitedCount = 0;

        // Seed stack with all ancestors
        for (uint256 a = 0; a < ancestors.length && stackTop < stack.length; a++) {
            stack[stackTop++] = ancestors[a];
        }

        while (stackTop > 0 && nodesVisited < nodeLimit) {
            uint64 current = stack[--stackTop];

            // Skip if already visited
            if (_isInArray64(current, visited, visitedCount)) continue;
            if (visitedCount < visited.length) {
                visited[visitedCount++] = current;
            }

            nodesVisited++;

            DataTypes.Chapter storage ch = _chapters[current];
            // Only consider chapters belonging to this novel
            if (ch.novelId != novelId) continue;

            uint64[] storage desc = ch.descendants;

            // Filter descendants to same novel
            bool hasNovelDescendant = false;
            for (uint256 d = 0; d < desc.length && stackTop < stack.length && nodesVisited + d < nodeLimit; d++) {
                if (_chapters[desc[d]].novelId == novelId) {
                    stack[stackTop++] = desc[d];
                    hasNovelDescendant = true;
                }
            }

            // If no descendants in this novel (or stack/node limit reached), it's a leaf
            if (!hasNovelDescendant && leafCount < leaves.length) {
                leaves[leafCount] = current;
                leafDepths[leafCount] = ch.depth;
                leafCount++;
            }
        }

        if (leafCount == 0) {
            return new uint64[](0);
        }

        // Sort by depth descending (simple insertion sort — leafCount is small)
        for (uint256 i = 1; i < leafCount; i++) {
            uint64 keyId = leaves[i];
            uint32 keyDepth = leafDepths[i];
            uint256 j = i;
            while (j > 0 && leafDepths[j - 1] < keyDepth) {
                leaves[j] = leaves[j - 1];
                leafDepths[j] = leafDepths[j - 1];
                j--;
            }
            leaves[j] = keyId;
            leafDepths[j] = keyDepth;
        }

        // Take top maxCandidates
        uint256 resultCount = leafCount < maxCandidates ? leafCount : maxCandidates;
        candidateIds = new uint64[](resultCount);
        for (uint256 i = 0; i < resultCount; i++) {
            candidateIds[i] = leaves[i];
        }
    }

    // ============================================================
    //                INTERNAL: WORLD LINE HELPERS
    // ============================================================

    /// @dev Check if a chapter is a descendant of any current worldLineAncestor.
    ///      Walks up parentId from chapterId until hitting an ancestor or root.
    function _isDescendantOfWorldLine(uint64 novelId, uint64 chapterId) internal view returns (bool) {
        uint64[] storage ancestors = _worldLineAncestors[novelId];
        uint64 current = chapterId;
        for (uint256 step = 0; step < MAX_TREE_WALK_STEPS && current != 0; step++) {
            // Check if current is a world line ancestor
            for (uint256 i = 0; i < ancestors.length; i++) {
                if (current == ancestors[i]) return true;
            }

            DataTypes.Chapter storage ch = _chapters[current];
            // Stop at novel boundary (root has depth=1)
            if (ch.depth <= 1) break;
            current = ch.parentId;
        }

        return false;
    }

    /// @dev Collect per-chapter authors from new world line paths, only from eligible winners.
    ///      Walks up from each eligible winner to prevWorldLine ancestors, deduplicating chapters.
    ///      Returns one author entry per new chapter (same author with N chapters = N entries).
    function _collectEligibleNewAuthors(uint64 novelId, uint64[] memory winners, DataTypes.RoundData storage rd)
        internal
        view
        returns (address[] memory)
    {
        uint64[] memory newChapterIds = new uint64[](MAX_PATH_CHAPTERS);
        uint256 newCount = 0;

        for (uint256 w = 0; w < winners.length; w++) {
            // Skip ineligible winners (nominated but not world-line descendants)
            uint256 candIdx = _findCandidateIndex(rd, winners[w]);
            if (!rd.candidateIsEligible[candIdx]) continue;

            uint64 current = winners[w];

            // Walk up from winner to any prevWorldLine ancestor
            for (uint256 step = 0; step < MAX_AUTHOR_WALK_STEPS && current != 0; step++) {
                DataTypes.Chapter storage ch = _chapters[current];

                // Stop if we hit a prevWorldLine
                if (_isInArray(current, rd.prevWorldLines)) break;

                // Stop at novel boundary
                if (ch.novelId != novelId) break;

                // Add if not already collected (dedup across winners)
                if (!_isInArray64(current, newChapterIds, newCount)) {
                    if (newCount < newChapterIds.length) {
                        newChapterIds[newCount++] = current;
                    }
                }

                if (ch.depth <= 1) break;
                current = ch.parentId;
            }
        }

        // Return per-chapter author array (not deduplicated by author)
        address[] memory authors = new address[](newCount);
        for (uint256 i = 0; i < newCount; i++) {
            authors[i] = _chapters[newChapterIds[i]].author;
        }
        return authors;
    }

    /// @dev Collect all chapter authors from root to each ancestor (for final distribution).
    ///      Returns per-chapter author array (deduped chapters, not authors).
    function _collectPathAuthors(uint64 novelId, uint64[] storage ancestors) internal view returns (address[] memory) {
        uint64[] memory chapIds = new uint64[](MAX_PATH_CHAPTERS);
        uint256 count = 0;

        for (uint256 a = 0; a < ancestors.length; a++) {
            uint64 current = ancestors[a];
            for (uint256 step = 0; step < MAX_TREE_WALK_STEPS && current != 0; step++) {
                DataTypes.Chapter storage ch = _chapters[current];
                if (ch.novelId != novelId) break;

                if (!_isInArray64(current, chapIds, count)) {
                    if (count < chapIds.length) {
                        chapIds[count++] = current;
                    }
                }

                if (ch.depth <= 1) break;
                current = ch.parentId;
            }
        }

        address[] memory authors = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            authors[i] = _chapters[chapIds[i]].author;
        }
        return authors;
    }

    /// @dev Clear world line author flags by walking paths from root to prevWorldLines
    function _clearWorldLineAuthors(uint64 novelId, uint64[] storage prevWorldLines) internal {
        for (uint256 a = 0; a < prevWorldLines.length; a++) {
            uint64 current = prevWorldLines[a];
            for (uint256 step = 0; step < MAX_TREE_WALK_STEPS && current != 0; step++) {
                DataTypes.Chapter storage ch = _chapters[current];
                if (ch.novelId != novelId) break;

                _isWorldLineAuthor[novelId][ch.author] = false;

                if (ch.depth <= 1) break;
                current = ch.parentId;
            }
        }
    }

    /// @dev Set world line author flags by walking paths from root to each winner
    function _setWorldLineAuthors(uint64 novelId, uint64[] memory winners) internal {
        for (uint256 w = 0; w < winners.length; w++) {
            uint64 current = winners[w];
            for (uint256 step = 0; step < MAX_TREE_WALK_STEPS && current != 0; step++) {
                DataTypes.Chapter storage ch = _chapters[current];
                if (ch.novelId != novelId) break;

                _isWorldLineAuthor[novelId][ch.author] = true;

                if (ch.depth <= 1) break;
                current = ch.parentId;
            }
        }
    }

    // ============================================================
    //                  INTERNAL: VALIDATION
    // ============================================================

    /// @dev Config error codes:
    ///  1=minChapterLength  2=maxChapterLength  3=worldLineCount  4=voteStake
    ///  5=commitDuration  6=revealDuration  7=prizeReleaseRate  8=voterRewardRate
    ///  9=nominateDuration  10=contentBaseUrl  11=ruleVoteDuration  12=minRoundGap
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

    // ============================================================
    //                   INTERNAL: UTILITIES
    // ============================================================

    /// @dev Pay keeper reward from novel's prize pool
    function _payKeeper(uint64 novelId) internal {
        uint256 amount = prizePool.payKeeperReward(novelId, msg.sender);
        if (amount > 0) {
            emit KeeperRewarded(novelId, msg.sender, amount);
        }
    }

    /// @dev Find the index of a candidate in round data
    function _findCandidateIndex(DataTypes.RoundData storage rd, uint64 chapterId) internal view returns (uint256) {
        for (uint256 i = 0; i < rd.candidates.length; i++) {
            if (rd.candidates[i] == chapterId) return i;
        }
        revert NotACandidate(chapterId);
    }

    /// @dev Check if value is in a storage uint64 array
    function _isInArray(uint64 val, uint64[] storage arr) internal view returns (bool) {
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i] == val) return true;
        }
        return false;
    }

    /// @dev Check if value is in a memory uint64 array (up to `len` elements)
    function _isInArray64(uint64 val, uint64[] memory arr, uint256 len) internal pure returns (bool) {
        for (uint256 i = 0; i < len; i++) {
            if (arr[i] == val) return true;
        }
        return false;
    }

    /// @notice Accept ETH transfers (voter rewards from PrizePool during settlement)
    receive() external payable {}

    // ============================================================
    //                     UUPS UPGRADE
    // ============================================================

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ============================================================
    //                    STORAGE GAP
    // ============================================================

    /// @dev Reserved storage gap for future upgrades
    uint256[40] private __gap;
}
