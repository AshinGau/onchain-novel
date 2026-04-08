// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DataTypes} from "../libraries/DataTypes.sol";

/// @title IVotingEngine
/// @notice Interface for the Commit-Reveal Stake-to-Vote engine
/// @dev Manages three-phase voting (commit → reveal → tally) and voter reward distribution.
///      Called by NovelCore for lifecycle operations; voters interact through NovelCore.
interface IVotingEngine {
    // ============================================================
    //                          EVENTS
    // ============================================================

    /// @notice Emitted when a voting round is initialized with candidates
    event VotingInitialized(uint64 indexed novelId, uint32 indexed round, uint256 candidateCount);

    /// @notice Emitted when a vote commitment is recorded
    event VoteCommitted(uint64 indexed novelId, uint32 indexed round, address indexed voter);

    /// @notice Emitted when a vote is revealed
    event VoteRevealed(uint64 indexed novelId, uint32 indexed round, address indexed voter, uint64 candidateId);

    /// @notice Emitted when votes are tallied and ranked results produced
    event VotesTallied(uint64 indexed novelId, uint32 indexed round, uint64[] rankedCandidateIds);

    /// @notice Emitted when voter rewards are settled for a round
    event VoterRewardsSettled(uint64 indexed novelId, uint32 indexed round, uint256 totalRewardPool);

    /// @notice Emitted when a voter claims their reward
    event VotingRewardClaimed(uint64 indexed novelId, uint32 indexed round, address indexed voter, uint256 amount);

    // ============================================================
    //                  CALLED BY NOVELCORE
    // ============================================================

    /// @notice Initialize a new voting round with candidate chapter IDs
    /// @param novelId The novel ID
    /// @param round The round number
    /// @param candidates Array of candidate chapter IDs
    function initializeVoting(uint64 novelId, uint32 round, uint64[] calldata candidates) external;

    /// @notice Add a new candidate to an existing voting round (for user nominations)
    /// @param novelId The novel ID
    /// @param round The round number
    /// @param candidateId The chapter ID to add as a candidate
    function addCandidate(uint64 novelId, uint32 round, uint64 candidateId) external;

    /// @notice Record a vote commitment (called by NovelCore on behalf of voter)
    /// @param novelId The novel ID
    /// @param round The round number
    /// @param voter The voter address
    /// @param commitHash keccak256(abi.encodePacked(candidateId, salt))
    /// @param stakeAmount The amount of ETH staked with this vote
    function commitVote(uint64 novelId, uint32 round, address voter, bytes32 commitHash, uint256 stakeAmount)
        external;

    /// @notice Reveal a previously committed vote (called by NovelCore on behalf of voter)
    /// @param novelId The novel ID
    /// @param round The round number
    /// @param voter The voter address
    /// @param candidateId The chapter ID voted for
    /// @param salt The salt used in the commit hash
    function revealVote(uint64 novelId, uint32 round, address voter, uint64 candidateId, bytes32 salt) external;

    /// @notice Tally votes and return ranked candidate IDs by vote weight
    /// @dev Called during settleRound. Top winnerCount candidates are marked as winners
    ///      for accurate voter reward computation.
    /// @param novelId The novel ID
    /// @param round The round number
    /// @param winnerCount Number of top candidates to mark as winners (worldLineCount)
    /// @return rankedIds Candidate IDs ordered by vote weight (descending)
    /// @return voteWeights Corresponding vote weights
    function tallyVotes(uint64 novelId, uint32 round, uint32 winnerCount)
        external
        returns (uint64[] memory rankedIds, uint256[] memory voteWeights);

    /// @notice Settle voter rewards for a round
    /// @dev Distributes voterRewardPool + unrevealed stakes to revealed voters.
    ///      Accurate voters (voted for winning world line) get 3x weight.
    /// @param novelId The novel ID
    /// @param round The round number
    /// @param voterRewardPool Amount from prize pool allocated to voter rewards
    /// @param unrevealedStakes Total unrevealed stake amount to redistribute
    function settleVoterRewards(uint64 novelId, uint32 round, uint256 voterRewardPool, uint256 unrevealedStakes)
        external;

    /// @notice Claim voting reward for a specific round (stake refund + accuracy reward)
    /// @param novelId The novel ID
    /// @param round The round number
    /// @param voter The voter address
    /// @return amount Total amount claimed (stake refund + reward)
    function claimVotingReward(uint64 novelId, uint32 round, address voter) external returns (uint256 amount);

    // ============================================================
    //                        QUERIES
    // ============================================================

    /// @notice Get a voter's commit data for a specific round
    function getVoteCommit(uint64 novelId, uint32 round, address voter)
        external
        view
        returns (DataTypes.VoteCommit memory);

    /// @notice Get the accumulated vote weight for a candidate in a round
    function getVoteCount(uint64 novelId, uint32 round, uint64 candidateId) external view returns (uint256);

    /// @notice Get all candidate IDs for a voting round
    function getCandidates(uint64 novelId, uint32 round) external view returns (uint64[] memory);
}
