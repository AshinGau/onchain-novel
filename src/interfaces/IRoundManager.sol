// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DataTypes} from "../libraries/DataTypes.sol";

/// @title IRoundManager
/// @notice Round lifecycle, candidate generation, voting orchestration, novel completion.
interface IRoundManager {
    // ─────── Events ───────
    event RoundStarted(uint64 indexed novelId, uint32 round, uint64[] candidates);
    event NominationClosed(uint64 indexed novelId, uint32 round);
    event CommitClosed(uint64 indexed novelId, uint32 round);
    event RoundSettled(uint64 indexed novelId, uint32 round, uint64[] worldLines);
    event CandidateNominated(uint64 indexed novelId, uint32 round, uint64 chapterId, address nominator);
    event VoteCommitted(uint64 indexed novelId, uint32 round, address indexed voter);
    event VoteRevealed(uint64 indexed novelId, uint32 round, address indexed voter, uint64 candidateId);
    event RewardClaimed(uint64 indexed novelId, address indexed recipient, uint256 amount);
    event NovelCompleted(uint64 indexed novelId);
    event KeeperRewarded(uint64 indexed novelId, address indexed keeper, uint256 amount);

    // ─────── Round phase transitions ───────
    function startRound(uint64 novelId) external;
    function closeNomination(uint64 novelId) external;
    function closeCommit(uint64 novelId) external;
    function settleRound(uint64 novelId) external;

    // ─────── Nomination & Voting ───────
    function nominateCandidate(uint64 novelId, uint64 chapterId) external payable;
    function commitVote(uint64 novelId, bytes32 commitHash) external payable;
    function revealVote(uint64 novelId, uint64 candidateId, bytes32 salt) external;
    function claimVotingReward(uint64 novelId, uint32 round) external;

    // ─────── Novel completion (uses path walks + final distribution) ───────
    function completeNovel(uint64 novelId) external;

    // ─────── Views ───────
    function getRoundData(uint64 novelId, uint32 round) external view returns (DataTypes.RoundData memory);
}
