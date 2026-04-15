// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DataTypes} from "../libraries/DataTypes.sol";

/// @title IRoundManager
/// @notice Round lifecycle, candidate management, voting orchestration, completion.
/// @dev Round-phase transitions (start / closeNomination / closeCommit / settleRound) are
///      `keeper`-controlled (project ops). After `KEEPER_INACTIVITY_TIMEOUT` past the expected
///      phase end, anyone may call them as a fallback. completeNovel is creator-controlled with
///      the same inactivity fallback. nominateCandidate, commitVote, revealVote,
///      claimVotingReward remain user-callable.
///
///      ## Keeper trust surface (single attack vector)
///      The keeper's ONLY privileged input is the `leaves[]` array supplied to `startRound`.
///      Everything downstream — winner selection (on-chain `VotingEngine.tallyVotes`), reward
///      author derivation (on-chain parent-chain walk via `NovelCore.collectPathAuthors`),
///      world line update, completion — is fully on-chain deterministic. A malicious keeper
///      can at most bias which leaf per world line becomes the candidate (still bound by "real
///      tree leaf belonging to the novel") or stall, after which anyone may take over.
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
    /// @dev Winners come from on-chain `VotingEngine.tallyVotes`. For each winner, reward
    ///      authors are derived by walking `parentId` upward until hitting a previous world line
    ///      ancestor (anchor excluded). Winners whose chain does not reach any previous ancestor
    ///      (orphan nominees) contribute zero authors — an intentional forfeit, not an error.
    function settleRound(uint64 novelId) external;

    // ─────── Nomination & Voting (user-facing) ───────

    /// @notice Nominate any chapter as a candidate. Pays `nominationFee`.
    /// @param chapterId The chapter to nominate as a voting candidate.
    /// @param path Optional proof that `chapterId` descends from a current worldLineAncestor.
    ///        Non-empty: path[0] = chapterId, path[last] = a current worldLineAncestor. If this
    ///        candidate wins, its path authors earn rewards in settlement.
    ///        Empty: nominator explicitly forfeits author rewards for this candidate. Any chapter
    ///        in the novel may be nominated. World line still advances to it if it wins.
    function nominateCandidate(uint64 novelId, uint64 chapterId, uint64[] calldata path) external payable;

    function commitVote(uint64 novelId, bytes32 commitHash) external payable;
    /// @notice Permissionless reveal — anyone can call on behalf of any voter. The voter binding
    ///         in the commitHash (`keccak(voter, candidateId, salt)`) means only the correct
    ///         `(voter, c, s)` triple satisfies the hash check; a third party with the salt can
    ///         only complete the reveal as the voter intended.
    function revealVote(uint64 novelId, address voter, uint64 candidateId, bytes32 salt) external;
    function claimVotingReward(uint64 novelId, uint32 round) external;

    // ─────── Novel completion ───────

    /// @notice Complete the novel and pay the final reward.
    /// @dev Releases the entire remaining prize pool to the authors of every chapter on every
    ///      current world line (walked from each ancestor up to root, dedup). Permissioned to
    ///      novel.creator || keeper || owner; anyone may call after inactivity timeout.
    function completeNovel(uint64 novelId) external;

    // ─────── Admin ───────

    function setKeeper(address newKeeper) external;

    // ─────── Views ───────

    function getRoundData(uint64 novelId, uint32 round) external view returns (DataTypes.RoundData memory);
    function keeper() external view returns (address);
}
