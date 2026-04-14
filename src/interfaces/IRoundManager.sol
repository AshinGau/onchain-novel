// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DataTypes} from "../libraries/DataTypes.sol";

/// @title IRoundManager
/// @notice Round lifecycle, candidate management, voting orchestration, completion.
/// @dev Round-phase transitions (start / closeNomination / closeCommit / settleRound) are
///      `keeper`-controlled (project ops). After `KEEPER_INACTIVITY_TIMEOUT` past the expected
///      phase end, anyone may call them as a fallback. completeNovel is creator-controlled
///      with the same fallback. nominateCandidate, commitVote, revealVote, claimVotingReward
///      remain user-callable.
///
///      All "heavy" path data (settle reward authors, completion authors) is supplied by the
///      caller as `path` arrays. Each path = [deeperChapter, ..., shallowerChapter] following
///      parentId links. Contract verifies the parent chain on-chain and derives author lists
///      from `Chapter.author` storage — no trust in the caller's authors.
interface IRoundManager {
    // ─────── Events ───────
    event KeeperUpdated(address indexed oldAddr, address indexed newAddr);
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

    // ─────── Round phase transitions (keeper / owner / fallback) ───────

    /// @notice Start a new round with the given leaf chapters as candidates.
    /// @param leaves Each must belong to `novelId` and have no children (true tree leaf).
    ///         The keeper should pick the N deepest leaves of the current world lines.
    function startRound(uint64 novelId, uint64[] calldata leaves) external;

    function closeNomination(uint64 novelId) external;
    function closeCommit(uint64 novelId) external;

    /// @notice Settle the round: tally votes, distribute rewards, replace world line ancestors.
    /// @param winnerPaths winnerPaths[i] is the parent chain proving winners[i]'s lineage:
    ///        path[0] = winners[i] (the new world line ancestor)
    ///        path[last] = a chapter in the previous world line ancestor set (anchor)
    ///        Empty path => winners[i] gets no author rewards (e.g., off-world-line nominated chapter).
    ///        Authors of all chapters on the path EXCEPT the anchor are credited as new-chapter authors.
    function settleRound(uint64 novelId, uint64[][] calldata winnerPaths) external;

    // ─────── Nomination & Voting (user-facing) ───────

    /// @notice Nominate a chapter as candidate. Requires nomination fee.
    /// @param path Parent chain proving the nominated chapter is a descendant of a current
    ///        worldLineAncestor: path[0] = nominated chapter, path[last] = worldLineAncestor.
    ///        Length-1 path is rejected (a worldLineAncestor itself was already a candidate via
    ///        its leaf; nominating the ancestor itself makes no sense).
    function nominateCandidate(uint64 novelId, uint64[] calldata path) external payable;

    function commitVote(uint64 novelId, bytes32 commitHash) external payable;
    function revealVote(uint64 novelId, uint64 candidateId, bytes32 salt) external;
    function claimVotingReward(uint64 novelId, uint32 round) external;

    // ─────── Novel completion ───────

    /// @notice Complete the novel and pay the final reward.
    /// @param finalPaths finalPaths[i] covers the i-th current worldLineAncestor's path:
    ///        path[0] = worldLineAncestors[i], path[last] = root chapter (depth = 1).
    ///        All chapter authors on every path receive a share of the final pool.
    /// @dev Permission: novel.creator || keeper || owner || (anyone after inactivity timeout).
    function completeNovel(uint64 novelId, uint64[][] calldata finalPaths) external;

    // ─────── Admin ───────

    function setKeeper(address newKeeper) external;

    // ─────── Views ───────

    function getRoundData(uint64 novelId, uint32 round) external view returns (DataTypes.RoundData memory);
    function keeper() external view returns (address);
}
