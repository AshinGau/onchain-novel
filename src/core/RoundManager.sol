// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IRoundManager} from "../interfaces/IRoundManager.sol";
import {INovelCore} from "../interfaces/INovelCore.sol";
import {IVotingEngine} from "../interfaces/IVotingEngine.sol";
import {IPrizePool} from "../interfaces/IPrizePool.sol";
import {DataTypes} from "../libraries/DataTypes.sol";

/// @title RoundManager
/// @notice Round lifecycle: keeper picks the candidate leaves for startRound; everything else
///         (winner selection, reward derivation, novel completion) is fully on-chain deterministic.
/// @dev ## Keeper trust model (single attack surface)
///      The keeper's ONLY privileged input is the `leaves[]` array supplied to `startRound`.
///      A malicious keeper can at most:
///        - include one specific favored leaf per world line (still bound by "must be a real tree
///          leaf belonging to the novel"), thereby biasing which world line gets representation,
///        - OR omit/delay calling `startRound` (any caller can take over after
///          `KEEPER_INACTIVITY_TIMEOUT` — 1 day — for each phase-transition function).
///      A keeper CANNOT:
///        - pick winners (that comes from on-chain `VotingEngine.tallyVotes`),
///        - fabricate or suppress reward authors (derived from `NovelCore.collectPathAuthors`
///          walking `parentId` from each winner upward — pure on-chain state),
///        - alter committed votes (commit-reveal prevents that),
///        - drain / withhold prize pool (distribution rules are fixed protocol constants).
///      This keeps "keeper picks leaves" as the single residual trust assumption — the only
///      weakness users must accept, and the core value proposition of onchain-novel.
contract RoundManager is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardTransient,
    PausableUpgradeable,
    UUPSUpgradeable,
    IRoundManager
{
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ─────── Constants ───────
    uint64 internal constant INACTIVITY_TIMEOUT = 30 days; // completeNovel public-call window
    uint64 internal constant KEEPER_INACTIVITY_TIMEOUT = 1 days; // round-fn public-call grace after phase deadline
    uint256 internal constant MAX_CANDIDATES_PER_ROUND = 64;

    // ─────── Storage ───────
    INovelCore public novelCore;
    IVotingEngine public votingEngine;
    IPrizePool public prizePool;
    address public keeper;

    mapping(uint64 => mapping(uint32 => DataTypes.RoundData)) private _rounds;
    mapping(uint64 => mapping(uint32 => uint256)) private _roundCommittedStakes;

    // ─────── Errors ───────
    error NovelNotFound(uint64 novelId);
    error NovelNotActive(uint64 novelId);
    error WrongRoundPhase(DataTypes.RoundPhase expected, DataTypes.RoundPhase actual);
    error PhaseNotExpired();
    error MinRoundGapNotMet();
    error InsufficientLeaves(uint256 supplied, uint32 required);
    error TooManyLeaves();
    error LeafHasChildren(uint64 chapterId);
    error DuplicateLeaf(uint64 chapterId);
    error AlreadyACandidate(uint64 chapterId);
    error InvalidPathAnchor();
    error InvalidFee(uint256 sent, uint256 required);
    error TransferFailed();
    error NotKeeperYet();
    error NotAllowedToComplete();
    error NovelAlreadyCompleted(uint64 novelId);
    error NovelHasNoRound();
    error ZeroAddress();

    // ─────── Initializer ───────
    function initialize(address owner_, address novelCore_, address votingEngine_, address prizePool_)
        external
        initializer
    {
        if (owner_ == address(0) || novelCore_ == address(0) || votingEngine_ == address(0) || prizePool_ == address(0))
        {
            revert ZeroAddress();
        }
        __Ownable_init(owner_);
        __Pausable_init();
        novelCore = INovelCore(novelCore_);
        votingEngine = IVotingEngine(votingEngine_);
        prizePool = IPrizePool(prizePool_);
    }

    // ─────── Admin ───────
    function setNovelCore(address addr) external onlyOwner {
        if (addr == address(0)) revert ZeroAddress();
        novelCore = INovelCore(addr);
    }

    function setVotingEngine(address addr) external onlyOwner {
        if (addr == address(0)) revert ZeroAddress();
        votingEngine = IVotingEngine(addr);
    }

    function setPrizePool(address addr) external onlyOwner {
        if (addr == address(0)) revert ZeroAddress();
        prizePool = IPrizePool(addr);
    }

    function setKeeper(address newKeeper) external onlyOwner {
        if (newKeeper == address(0)) revert ZeroAddress();
        emit KeeperUpdated(keeper, newKeeper);
        keeper = newKeeper;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ────────────────────────────────────────────────────
    //          INTERNAL: PERMISSION + PHASE HELPERS
    // ────────────────────────────────────────────────────

    /// @dev Permission for round-phase functions: keeper / owner immediate; anyone after grace timeout.
    function _checkRoundCaller(DataTypes.Novel memory novel, uint64 expectedDeadline) internal view {
        if (msg.sender == keeper || msg.sender == owner()) return;
        if (block.timestamp < expectedDeadline + KEEPER_INACTIVITY_TIMEOUT) revert NotKeeperYet();
        novel; // silence unused
    }

    function _phaseDeadline(DataTypes.Novel memory novel, DataTypes.RoundData storage rd) internal view returns (uint64) {
        if (novel.roundPhase == DataTypes.RoundPhase.Idle) {
            // For startRound: deadline = lastSettleTime + minRoundGap (round 1 = 0)
            return novel.currentRound > 0 ? novel.lastSettleTime + novel.config.minRoundGap : 0;
        }
        if (novel.roundPhase == DataTypes.RoundPhase.Nominating) return rd.nominateEndTime;
        if (novel.roundPhase == DataTypes.RoundPhase.Committing) return rd.commitEndTime;
        return rd.revealEndTime; // Revealing
    }

    // ────────────────────────────────────────────────────
    //               ROUND PHASE TRANSITIONS
    // ────────────────────────────────────────────────────

    function startRound(uint64 novelId, uint64[] calldata leaves) external whenNotPaused {
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (!novel.active) revert NovelNotActive(novelId);
        if (novel.roundPhase != DataTypes.RoundPhase.Idle) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Idle, novel.roundPhase);
        }

        // minRoundGap (skip for round 1)
        if (novel.currentRound > 0) {
            if (block.timestamp < novel.lastSettleTime + novel.config.minRoundGap) revert MinRoundGapNotMet();
        }

        uint32 N = novel.config.worldLineCount;
        uint256 leafCount = leaves.length;
        if (leafCount < N) revert InsufficientLeaves(leafCount, N);
        if (leafCount > MAX_CANDIDATES_PER_ROUND) revert TooManyLeaves();

        // Permission gate: keeper/owner immediate, anyone after grace timeout
        // (deadline = lastSettleTime + minRoundGap for round>0; for round 1, deadline=0 so fallback always allowed)
        DataTypes.RoundData storage placeholder = _rounds[novelId][0];
        _checkRoundCaller(novel, _phaseDeadline(novel, placeholder));

        // Validate each leaf: belongs to novel, has no children, not duplicated
        for (uint256 i = 0; i < leafCount; i++) {
            uint64 leafId = leaves[i];
            DataTypes.Chapter memory ch = novelCore.getChapter(leafId);
            if (ch.id == 0 || ch.novelId != novelId) revert NovelNotFound(novelId);
            if (ch.children.length != 0) revert LeafHasChildren(leafId);
            for (uint256 j = i + 1; j < leafCount; j++) {
                if (leaves[j] == leafId) revert DuplicateLeaf(leafId);
            }
        }

        uint32 round = novelCore.advanceRound(novelId, DataTypes.RoundPhase.Nominating, uint64(block.timestamp));

        DataTypes.RoundData storage rd = _rounds[novelId][round];
        for (uint256 i = 0; i < leafCount; i++) {
            rd.candidates.push(leaves[i]);
        }
        rd.nominateEndTime = uint64(block.timestamp) + novel.config.nominateDuration;

        votingEngine.initializeVoting(novelId, round, leaves);
        _payKeeper(novelId);
        emit RoundStarted(novelId, round, leaves);
    }

    function closeNomination(uint64 novelId) external whenNotPaused {
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (novel.roundPhase != DataTypes.RoundPhase.Nominating) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Nominating, novel.roundPhase);
        }

        DataTypes.RoundData storage rd = _rounds[novelId][novel.currentRound];
        if (block.timestamp < rd.nominateEndTime) revert PhaseNotExpired();
        _checkRoundCaller(novel, rd.nominateEndTime);

        novelCore.setNovelPhase(novelId, DataTypes.RoundPhase.Committing, uint64(block.timestamp));
        rd.commitEndTime = uint64(block.timestamp) + novel.config.commitDuration;

        _payKeeper(novelId);
        emit NominationClosed(novelId, novel.currentRound);
    }

    function closeCommit(uint64 novelId) external whenNotPaused {
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (novel.roundPhase != DataTypes.RoundPhase.Committing) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Committing, novel.roundPhase);
        }

        DataTypes.RoundData storage rd = _rounds[novelId][novel.currentRound];
        if (block.timestamp < rd.commitEndTime) revert PhaseNotExpired();
        _checkRoundCaller(novel, rd.commitEndTime);

        novelCore.setNovelPhase(novelId, DataTypes.RoundPhase.Revealing, uint64(block.timestamp));
        rd.revealEndTime = uint64(block.timestamp) + novel.config.revealDuration;

        _payKeeper(novelId);
        emit CommitClosed(novelId, novel.currentRound);
    }

    function settleRound(uint64 novelId) external whenNotPaused nonReentrant {
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (novel.roundPhase != DataTypes.RoundPhase.Revealing) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Revealing, novel.roundPhase);
        }

        uint32 round = novel.currentRound;
        DataTypes.RoundData storage rd = _rounds[novelId][round];
        if (block.timestamp < rd.revealEndTime) revert PhaseNotExpired();
        _checkRoundCaller(novel, rd.revealEndTime);

        uint32 N = novel.config.worldLineCount;
        uint64[] memory winners = votingEngine.tallyVotes(novelId, round, N);

        // Reward authors are derived fully on-chain: walk from each winner up parentId until hitting
        // a previous world line ancestor (anchor is EXCLUDED — already rewarded in a prior round).
        // If a winner doesn't descend from any prev ancestor (e.g. it won via an orphan nomination
        // where the nominator skipped the path proof), that winner contributes no authors — the
        // nominator/author chose to forfeit reward by nominating without proof. World line still
        // advances to it.
        uint64[] memory prevAncestors = novelCore.getWorldLineAncestors(novelId);
        address[] memory rewardAuthors = novelCore.collectPathAuthors(novelId, winners, prevAncestors, true);

        // Distribute round rewards
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

        // Forward committed stakes to VotingEngine (voterRewards were already sent by PrizePool directly).
        // Then settleVoterRewards will distribute; any excess returns to us and is redeposited to the pool.
        uint256 totalCommitted = _roundCommittedStakes[novelId][round];
        if (totalCommitted > 0) {
            (bool sent,) = address(votingEngine).call{value: totalCommitted}("");
            if (!sent) revert TransferFailed();
            uint256 excess =
                votingEngine.settleVoterRewards(novelId, round, voterRewards, novel.config.voteStake);
            if (excess > 0) prizePool.deposit{value: excess}(novelId, "voterRewardExcess");
        } else if (voterRewards > 0) {
            // No voters — pull the voterRewards back from VotingEngine and redeposit to the pool
            uint256 excess =
                votingEngine.settleVoterRewards(novelId, round, voterRewards, novel.config.voteStake);
            if (excess > 0) prizePool.deposit{value: excess}(novelId, "noVoters");
        }

        // Replace world line ancestors with winners
        novelCore.applyWorldLineSettlement(novelId, winners, DataTypes.RoundPhase.Idle, uint64(block.timestamp));

        rd.settled = true;
        _payKeeper(novelId);
        emit RoundSettled(novelId, round, winners);
    }

    // ────────────────────────────────────────────────────
    //                  NOMINATION & VOTING
    // ────────────────────────────────────────────────────

    /// @notice Nominate any chapter as a voting candidate. Pays nominationFee.
    /// @param novelId Novel under which to nominate
    /// @param chapterId The chapter to add as a candidate
    /// @param path Optional proof that `chapterId` descends from a current worldLineAncestor.
    ///             If non-empty: path[0] = chapterId, path[last] = a current ancestor; standard
    ///             parent-chain validation — this candidate's author is eligible for rewards
    ///             if it wins and the chain can be walked back to a previous world line ancestor.
    ///             If empty: arbitrary chapter, no reward eligibility. The nominator explicitly
    ///             forfeits author rewards for this candidate. World line still advances if it wins.
    ///             This is the on-chain "opt-out" path — accepted as intentional behavior, not a bug.
    function nominateCandidate(uint64 novelId, uint64 chapterId, uint64[] calldata path)
        external
        payable
        whenNotPaused
    {
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (novel.roundPhase != DataTypes.RoundPhase.Nominating) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Nominating, novel.roundPhase);
        }
        if (msg.value != novel.config.nominationFee) revert InvalidFee(msg.value, novel.config.nominationFee);

        // chapterId must exist under this novel
        DataTypes.Chapter memory ch = novelCore.getChapter(chapterId);
        if (ch.id == 0 || ch.novelId != novelId) revert NovelNotFound(novelId);

        // If a path is supplied, validate it: path[0] must be the nominated chapter, path[last]
        // must be a current worldLineAncestor. Empty path = forfeit (arbitrary chapter allowed).
        if (path.length > 0) {
            if (path[0] != chapterId) revert InvalidPathAnchor();
            novelCore.verifyChapterPath(novelId, path);
            if (!novelCore.isCurrentWorldLineAncestor(novelId, path[path.length - 1])) revert InvalidPathAnchor();
        }

        DataTypes.RoundData storage rd = _rounds[novelId][novel.currentRound];
        if (rd.candidates.length >= MAX_CANDIDATES_PER_ROUND) revert TooManyLeaves();
        for (uint256 i = 0; i < rd.candidates.length; i++) {
            if (rd.candidates[i] == chapterId) revert AlreadyACandidate(chapterId);
        }

        rd.candidates.push(chapterId);
        votingEngine.addCandidate(novelId, novel.currentRound, chapterId);

        if (msg.value > 0) prizePool.deposit{value: msg.value}(novelId, "nominationFee");

        emit CandidateNominated(novelId, novel.currentRound, chapterId, msg.sender);
    }

    function commitVote(uint64 novelId, bytes32 commitHash) external payable whenNotPaused {
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (novel.roundPhase != DataTypes.RoundPhase.Committing) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Committing, novel.roundPhase);
        }
        if (msg.value != novel.config.voteStake) revert InvalidFee(msg.value, novel.config.voteStake);

        uint32 round = novel.currentRound;
        votingEngine.commitVote(novelId, round, msg.sender, commitHash, msg.value);
        _roundCommittedStakes[novelId][round] += msg.value;

        emit VoteCommitted(novelId, round, msg.sender);
    }

    /// @notice Reveal `voter`'s commit. **Permissionless** — anyone can submit the reveal for any
    ///         voter as long as `(voter, candidateId, salt)` matches the stored commitHash.
    /// @dev The commitHash is voter-bound (`keccak(voter, candidateId, salt)`), so leaking the
    ///      preimage cannot be exploited: a third party can only complete the reveal *as the
    ///      voter intended*. Stake and reward bookkeeping is keyed by `voter`, not msg.sender.
    ///      This makes keeper-assisted reveal trustless (any helper, not just the keeper) and
    ///      means voters who lose their wallet but kept the salt elsewhere can still be revealed.
    function revealVote(uint64 novelId, address voter, uint64 candidateId, bytes32 salt) external whenNotPaused {
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (novel.roundPhase != DataTypes.RoundPhase.Revealing) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Revealing, novel.roundPhase);
        }

        uint32 round = novel.currentRound;
        votingEngine.revealVote(novelId, round, voter, candidateId, salt);

        emit VoteRevealed(novelId, round, voter, candidateId);
    }

    function claimVotingReward(uint64 novelId, uint32 round) external nonReentrant whenNotPaused {
        uint256 amount = votingEngine.claimVotingReward(novelId, round, msg.sender);
        if (amount > 0) emit RewardClaimed(novelId, msg.sender, amount);
    }

    // ────────────────────────────────────────────────────
    //                NOVEL COMPLETION
    // ────────────────────────────────────────────────────

    function completeNovel(uint64 novelId) external whenNotPaused nonReentrant {
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (!novel.active) revert NovelAlreadyCompleted(novelId);
        if (novel.roundPhase != DataTypes.RoundPhase.Idle) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Idle, novel.roundPhase);
        }
        // Must have completed at least one settled round (creator cannot drain the pool on a fresh novel)
        if (novel.currentRound < 1) revert NovelHasNoRound();

        uint64[] memory worldLineAncestors = novelCore.getWorldLineAncestors(novelId);

        // Permission: creator || keeper || owner || (anyone after inactivity timeout)
        if (msg.sender != novel.creator && msg.sender != keeper && msg.sender != owner()) {
            uint64 lastActivity = novel.phaseStartTime;
            for (uint256 i = 0; i < worldLineAncestors.length; i++) {
                uint64 ts = novelCore.getChapter(worldLineAncestors[i]).timestamp;
                if (ts > lastActivity) lastActivity = ts;
            }
            if (block.timestamp < lastActivity + INACTIVITY_TIMEOUT) revert NotAllowedToComplete();
        }

        // Collect every author on every world line by walking each ancestor up to the root.
        // No anchors supplied → walks go to root (parentId == 0). requireAnchorHit=false because
        // every ancestor reaches root by construction; every chapter contributes its author.
        uint64[] memory noAnchors = new uint64[](0);
        address[] memory finalAuthors = novelCore.collectPathAuthors(novelId, worldLineAncestors, noAnchors, false);

        if (finalAuthors.length > 0) {
            uint256 dust = prizePool.distributeRoundRewards(
                novelId,
                novel.currentRound,
                novel.creator,
                finalAuthors,
                10000, // release entire pool
                0 // no voter rewards
            );
            if (dust > 0) prizePool.deposit{value: dust}(novelId, "completionDust");
        }

        novelCore.setNovelInactive(novelId);
        emit NovelCompleted(novelId);
    }

    // ────────────────────────────────────────────────────
    //                       VIEWS
    // ────────────────────────────────────────────────────

    function getRoundData(uint64 novelId, uint32 round) external view returns (DataTypes.RoundData memory) {
        return _rounds[novelId][round];
    }

    // ────────────────────────────────────────────────────
    //                INTERNAL: UTILITIES
    // ────────────────────────────────────────────────────

    function _payKeeper(uint64 novelId) internal {
        uint256 amount = prizePool.payKeeperReward(novelId, msg.sender);
        if (amount > 0) emit KeeperRewarded(novelId, msg.sender, amount);
    }

    /// @notice Accept ETH from PrizePool / VotingEngine for round settlement only
    receive() external payable {
        if (msg.sender != address(prizePool) && msg.sender != address(votingEngine)) revert TransferFailed();
    }

    // ─────── UUPS ───────
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ─────── Storage gap ───────
    uint256[44] private __gap;
}
