// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IRoundManager} from "../interfaces/IRoundManager.sol";
import {INovelCore} from "../interfaces/INovelCore.sol";
import {IVotingEngine} from "../interfaces/IVotingEngine.sol";
import {IPrizePool} from "../interfaces/IPrizePool.sol";
import {DataTypes} from "../libraries/DataTypes.sol";

/// @title RoundManager
/// @notice Owns the voting-round lifecycle: DFS candidate generation, phase transitions,
///         vote forwarding, settlement (reward distribution + world-line update),
///         and novel completion.
/// @dev UUPS-upgradeable. Reads chapter data from NovelCore via external calls.
///      Writes back to NovelCore through privileged setters (onlyRoundManager).
contract RoundManager is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuard,
    PausableUpgradeable,
    UUPSUpgradeable,
    IRoundManager
{
    // ─────── Constants ───────
    uint64 internal constant INACTIVITY_TIMEOUT = 30 days;
    uint256 internal constant MAX_CANDIDATES_PER_ROUND = 64;
    uint256 internal constant MAX_PATH_CHAPTERS = 256;
    uint256 internal constant MAX_TREE_WALK_STEPS = 1000;
    uint256 internal constant MAX_AUTHOR_WALK_STEPS = 500;

    // ─────── Storage ───────
    INovelCore public novelCore;
    IVotingEngine public votingEngine;
    IPrizePool public prizePool;
    uint32 public maxDfsNodes;

    mapping(uint64 => mapping(uint32 => DataTypes.RoundData)) private _rounds;
    mapping(uint64 => mapping(uint32 => uint256)) private _roundCommittedStakes;

    // ─────── Errors ───────
    error NovelNotFound(uint64 novelId);
    error NovelNotActive(uint64 novelId);
    error ChapterNotFound(uint64 chapterId);
    error ChapterNotInNovel(uint64 chapterId, uint64 novelId);
    error WrongRoundPhase(DataTypes.RoundPhase expected, DataTypes.RoundPhase actual);
    error PhaseNotExpired();
    error MinRoundGapNotMet();
    error InsufficientCandidates(uint256 available, uint32 required);
    error DuplicateCandidate(uint64 chapterId);
    error TooManyCandidates();
    error NotACandidate(uint64 chapterId);
    error InvalidFee(uint256 sent, uint256 required);
    error TransferFailed();
    error CompletionNotAllowed();
    error NovelAlreadyCompleted(uint64 novelId);
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
        maxDfsNodes = 500;
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

    function setMaxDfsNodes(uint32 val) external onlyOwner {
        maxDfsNodes = val;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ────────────────────────────────────────────────────
    //               ROUND PHASE TRANSITIONS
    // ────────────────────────────────────────────────────

    function startRound(uint64 novelId) external whenNotPaused {
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (!novel.active) revert NovelNotActive(novelId);
        if (novel.roundPhase != DataTypes.RoundPhase.Idle) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Idle, novel.roundPhase);
        }

        if (novel.currentRound > 0) {
            if (block.timestamp < novel.lastSettleTime + novel.config.minRoundGap) revert MinRoundGapNotMet();
        }

        uint64[] memory ancestors = novelCore.getWorldLineAncestors(novelId);
        uint32 maxCandidates = 3 * novel.config.worldLineCount;
        uint64[] memory candidates = _dfsDeepestChains(novelId, ancestors, maxCandidates);

        if (candidates.length < novel.config.worldLineCount) {
            revert InsufficientCandidates(candidates.length, novel.config.worldLineCount);
        }

        uint32 round = novelCore.advanceRound(novelId, DataTypes.RoundPhase.Nominating, uint64(block.timestamp));

        DataTypes.RoundData storage rd = _rounds[novelId][round];
        for (uint256 i = 0; i < candidates.length; i++) {
            rd.candidates.push(candidates[i]);
            rd.candidateIsEligible.push(true);
        }
        for (uint256 i = 0; i < ancestors.length; i++) {
            rd.prevWorldLines.push(ancestors[i]);
        }
        rd.nominateEndTime = uint64(block.timestamp) + novel.config.nominateDuration;

        votingEngine.initializeVoting(novelId, round, candidates);
        _payKeeper(novelId);
        emit RoundStarted(novelId, round, candidates);
    }

    function closeNomination(uint64 novelId) external whenNotPaused {
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (novel.roundPhase != DataTypes.RoundPhase.Nominating) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Nominating, novel.roundPhase);
        }

        DataTypes.RoundData storage rd = _rounds[novelId][novel.currentRound];
        if (block.timestamp < rd.nominateEndTime) revert PhaseNotExpired();

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

        uint32 N = novel.config.worldLineCount;
        uint64[] memory winners = votingEngine.tallyVotes(novelId, round, N);

        // Collect per-chapter authors from eligible-winner new world line paths
        address[] memory rewardAuthors = _collectEligibleNewAuthors(novelId, winners, rd);

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

        uint256 totalCommitted = _roundCommittedStakes[novelId][round];
        if (totalCommitted > 0) {
            uint256 totalToVotingEngine = voterRewards + totalCommitted;
            if (totalToVotingEngine > 0) {
                (bool sent,) = address(votingEngine).call{value: totalToVotingEngine}("");
                if (!sent) revert TransferFailed();
            }
            uint256 excessReturn =
                votingEngine.settleVoterRewards(novelId, round, voterRewards, novel.config.voteStake);
            if (excessReturn > 0) prizePool.deposit{value: excessReturn}(novelId, "voterRewardExcess");
        } else if (voterRewards > 0) {
            prizePool.deposit{value: voterRewards}(novelId, "noVoters");
        }

        // Update world line ancestors via NovelCore (no more author flag walking needed)
        uint64[] memory newAncestors = winners; // winners.length == selectCount
        novelCore.applyWorldLineSettlement(
            novelId, newAncestors, DataTypes.RoundPhase.Idle, uint64(block.timestamp)
        );

        rd.settled = true;

        _payKeeper(novelId);
        emit RoundSettled(novelId, round, newAncestors);
    }

    // ────────────────────────────────────────────────────
    //                  NOMINATION & VOTING
    // ────────────────────────────────────────────────────

    function nominateCandidate(uint64 novelId, uint64 chapterId) external payable whenNotPaused {
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (novel.roundPhase != DataTypes.RoundPhase.Nominating) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Nominating, novel.roundPhase);
        }
        if (msg.value != novel.config.nominationFee) revert InvalidFee(msg.value, novel.config.nominationFee);

        DataTypes.Chapter memory ch = novelCore.getChapter(chapterId);
        if (ch.id == 0) revert ChapterNotFound(chapterId);
        if (ch.novelId != novelId) revert ChapterNotInNovel(chapterId, novelId);

        DataTypes.RoundData storage rd = _rounds[novelId][novel.currentRound];
        if (rd.candidates.length >= MAX_CANDIDATES_PER_ROUND) revert TooManyCandidates();
        for (uint256 i = 0; i < rd.candidates.length; i++) {
            if (rd.candidates[i] == chapterId) revert DuplicateCandidate(chapterId);
        }

        bool eligible = _isDescendantOfWorldLine(novelId, chapterId);
        rd.candidates.push(chapterId);
        rd.candidateIsEligible.push(eligible);

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

    function revealVote(uint64 novelId, uint64 candidateId, bytes32 salt) external whenNotPaused {
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (novel.roundPhase != DataTypes.RoundPhase.Revealing) {
            revert WrongRoundPhase(DataTypes.RoundPhase.Revealing, novel.roundPhase);
        }

        uint32 round = novel.currentRound;
        votingEngine.revealVote(novelId, round, msg.sender, candidateId, salt);

        emit VoteRevealed(novelId, round, msg.sender, candidateId);
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

        uint64[] memory ancestors = novelCore.getWorldLineAncestors(novelId);

        if (msg.sender != novel.creator) {
            uint64 lastActivity = novel.phaseStartTime;
            for (uint256 i = 0; i < ancestors.length; i++) {
                uint64 ts = novelCore.getChapter(ancestors[i]).timestamp;
                if (ts > lastActivity) lastActivity = ts;
            }
            if (block.timestamp < lastActivity + INACTIVITY_TIMEOUT) revert CompletionNotAllowed();
        }

        address[] memory finalAuthors = _collectPathAuthors(novelId, ancestors);
        if (finalAuthors.length > 0) {
            uint256 dust = prizePool.distributeRoundRewards(
                novelId,
                novel.currentRound > 0 ? novel.currentRound : 1,
                novel.creator,
                finalAuthors,
                10000, // release entire pool
                0 // no voter rewards in final distribution
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
    //                   INTERNAL: DFS
    // ────────────────────────────────────────────────────

    /// @dev Iterative DFS reading chapter data via NovelCore external calls.
    function _dfsDeepestChains(uint64 novelId, uint64[] memory ancestors, uint32 maxCandidates)
        internal
        view
        returns (uint64[] memory candidateIds)
    {
        uint32 nodeLimit = maxDfsNodes > 0 ? maxDfsNodes : 500;
        uint32 nodesVisited = 0;

        uint64[] memory leaves = new uint64[](nodeLimit);
        uint32[] memory leafDepths = new uint32[](nodeLimit);
        uint256 leafCount = 0;

        uint64[] memory stack = new uint64[](nodeLimit);
        bool[] memory stackIsAncestor = new bool[](nodeLimit);
        uint256 stackTop = 0;

        uint64[] memory visited = new uint64[](nodeLimit);
        uint256 visitedCount = 0;

        for (uint256 a = 0; a < ancestors.length && stackTop < stack.length; a++) {
            stack[stackTop] = ancestors[a];
            stackIsAncestor[stackTop] = true;
            stackTop++;
        }

        while (stackTop > 0 && nodesVisited < nodeLimit) {
            stackTop--;
            uint64 current = stack[stackTop];
            bool isAncestor = stackIsAncestor[stackTop];

            if (_isInArray64(current, visited, visitedCount)) continue;
            if (visitedCount < visited.length) visited[visitedCount++] = current;

            nodesVisited++;

            DataTypes.Chapter memory ch = novelCore.getChapter(current);
            if (ch.novelId != novelId) continue;

            uint64[] memory kids = ch.children;
            bool hasNovelChild = false;
            for (uint256 d = 0; d < kids.length && stackTop < stack.length && nodesVisited + d < nodeLimit; d++) {
                if (novelCore.getChapter(kids[d]).novelId == novelId) {
                    stack[stackTop] = kids[d];
                    stackIsAncestor[stackTop] = false;
                    stackTop++;
                    hasNovelChild = true;
                }
            }

            if (!hasNovelChild && !isAncestor && leafCount < leaves.length) {
                leaves[leafCount] = current;
                leafDepths[leafCount] = ch.depth;
                leafCount++;
            }
        }

        if (leafCount == 0) return new uint64[](0);

        // Sort by depth descending (insertion sort)
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

        uint256 resultCount = leafCount < maxCandidates ? leafCount : maxCandidates;
        candidateIds = new uint64[](resultCount);
        for (uint256 i = 0; i < resultCount; i++) {
            candidateIds[i] = leaves[i];
        }
    }

    // ────────────────────────────────────────────────────
    //              INTERNAL: WORLD LINE HELPERS
    // ────────────────────────────────────────────────────

    function _isDescendantOfWorldLine(uint64 novelId, uint64 chapterId) internal view returns (bool) {
        uint64[] memory ancestors = novelCore.getWorldLineAncestors(novelId);
        uint64 current = chapterId;
        for (uint256 step = 0; step < MAX_TREE_WALK_STEPS && current != 0; step++) {
            for (uint256 i = 0; i < ancestors.length; i++) {
                if (current == ancestors[i]) return true;
            }
            DataTypes.Chapter memory ch = novelCore.getChapter(current);
            if (ch.depth <= 1) break;
            current = ch.parentId;
            if (ch.novelId != novelId) break;
        }
        return false;
    }

    function _collectEligibleNewAuthors(uint64 novelId, uint64[] memory winners, DataTypes.RoundData storage rd)
        internal
        view
        returns (address[] memory)
    {
        uint64[] memory newChapterIds = new uint64[](MAX_PATH_CHAPTERS);
        uint256 newCount = 0;

        for (uint256 w = 0; w < winners.length; w++) {
            uint256 candIdx = _findCandidateIndex(rd, winners[w]);
            if (!rd.candidateIsEligible[candIdx]) continue;

            uint64 current = winners[w];
            for (uint256 step = 0; step < MAX_AUTHOR_WALK_STEPS && current != 0; step++) {
                DataTypes.Chapter memory ch = novelCore.getChapter(current);

                if (_isInArrayMem(current, rd.prevWorldLines)) break;
                if (ch.novelId != novelId) break;

                if (!_isInArray64(current, newChapterIds, newCount)) {
                    if (newCount < newChapterIds.length) newChapterIds[newCount++] = current;
                }

                if (ch.depth <= 1) break;
                current = ch.parentId;
            }
        }

        address[] memory authors = new address[](newCount);
        for (uint256 i = 0; i < newCount; i++) {
            authors[i] = novelCore.getChapter(newChapterIds[i]).author;
        }
        return authors;
    }

    function _collectPathAuthors(uint64 novelId, uint64[] memory ancestors) internal view returns (address[] memory) {
        uint64[] memory chapIds = new uint64[](MAX_PATH_CHAPTERS);
        uint256 count = 0;

        for (uint256 a = 0; a < ancestors.length; a++) {
            uint64 current = ancestors[a];
            for (uint256 step = 0; step < MAX_TREE_WALK_STEPS && current != 0; step++) {
                DataTypes.Chapter memory ch = novelCore.getChapter(current);
                if (ch.novelId != novelId) break;

                if (!_isInArray64(current, chapIds, count)) {
                    if (count < chapIds.length) chapIds[count++] = current;
                }

                if (ch.depth <= 1) break;
                current = ch.parentId;
            }
        }

        address[] memory authors = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            authors[i] = novelCore.getChapter(chapIds[i]).author;
        }
        return authors;
    }

    // ────────────────────────────────────────────────────
    //                INTERNAL: UTILITIES
    // ────────────────────────────────────────────────────

    function _payKeeper(uint64 novelId) internal {
        uint256 amount = prizePool.payKeeperReward(novelId, msg.sender);
        if (amount > 0) emit KeeperRewarded(novelId, msg.sender, amount);
    }

    function _findCandidateIndex(DataTypes.RoundData storage rd, uint64 chapterId) internal view returns (uint256) {
        for (uint256 i = 0; i < rd.candidates.length; i++) {
            if (rd.candidates[i] == chapterId) return i;
        }
        revert NotACandidate(chapterId);
    }

    function _isInArrayMem(uint64 val, uint64[] storage arr) internal view returns (bool) {
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i] == val) return true;
        }
        return false;
    }

    function _isInArray64(uint64 val, uint64[] memory arr, uint256 len) internal pure returns (bool) {
        for (uint256 i = 0; i < len; i++) {
            if (arr[i] == val) return true;
        }
        return false;
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
