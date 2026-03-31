// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DataTypes} from "../libraries/DataTypes.sol";

/// @title IVotingEngine
/// @notice Interface for the Commit-Reveal voting engine
interface IVotingEngine {
    // ============================================================
    //                          EVENTS
    // ============================================================

    event VoteCommitted(uint256 indexed novelId, uint256 indexed votingRoundId, address indexed voter);
    event VoteRevealed(
        uint256 indexed novelId, uint256 indexed votingRoundId, address indexed voter, uint256 candidateId
    );
    event VotingInitialized(uint256 indexed novelId, uint256 indexed votingRoundId, uint256 candidateCount);
    event VotesTallied(uint256 indexed novelId, uint256 indexed votingRoundId, uint256[] rankedCandidateIds);
    event VotingRewardClaimed(uint256 indexed novelId, uint256 indexed votingRoundId, address indexed voter, uint256 amount);

    // ============================================================
    //                      VOTER ACTIONS
    // ============================================================

    /// @notice Submit an encrypted vote commitment
    /// @param novelId Novel ID
    /// @param votingRoundId Unique voting round identifier (derived from round/epoch)
    /// @param commitHash hash(candidateId, salt)
    function commitVote(uint256 novelId, uint256 votingRoundId, bytes32 commitHash) external payable;

    /// @notice Reveal a previously committed vote
    /// @param novelId Novel ID
    /// @param votingRoundId Unique voting round identifier
    /// @param candidateId The candidate voted for
    /// @param salt Random salt used in commit
    function revealVote(uint256 novelId, uint256 votingRoundId, uint256 candidateId, bytes32 salt) external;

    /// @notice Claim Schelling Point reward for voting with majority
    /// @param novelId Novel ID
    /// @param votingRoundId Unique voting round identifier
    function claimVotingReward(uint256 novelId, uint256 votingRoundId) external;

    // ============================================================
    //                  CALLED BY NOVELCORE
    // ============================================================

    /// @notice Initialize a new voting round with candidates
    /// @param novelId Novel ID
    /// @param votingRoundId Unique voting round identifier
    /// @param candidateIds IDs of candidates (chapters or world lines)
    /// @param strategy Voting weight strategy to use
    function initializeVoting(
        uint256 novelId,
        uint256 votingRoundId,
        uint256[] calldata candidateIds,
        DataTypes.VotingStrategy strategy
    ) external;

    /// @notice Tally votes and return ranked results
    /// @param novelId Novel ID
    /// @param votingRoundId Unique voting round identifier
    /// @return rankedIds Candidate IDs sorted by vote count descending
    function tallyVotes(uint256 novelId, uint256 votingRoundId) external returns (uint256[] memory rankedIds);

    // ============================================================
    //                        QUERIES
    // ============================================================

    function getVoteCommit(uint256 novelId, uint256 votingRoundId, address voter)
        external
        view
        returns (DataTypes.VoteCommit memory);

    function getVoteCount(uint256 novelId, uint256 votingRoundId, uint256 candidateId)
        external
        view
        returns (uint256);

    function getCandidates(uint256 novelId, uint256 votingRoundId) external view returns (uint256[] memory);
}
