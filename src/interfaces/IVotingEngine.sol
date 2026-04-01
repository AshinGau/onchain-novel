// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DataTypes} from "../libraries/DataTypes.sol";

/// @title IVotingEngine
/// @notice Interface for the Commit-Reveal voting engine (Stake-to-Vote)
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
    event VotingRewardClaimed(
        uint256 indexed novelId, uint256 indexed votingRoundId, address indexed voter, uint256 totalAmount
    );
    event UnrevealedStakesSwept(uint256 indexed novelId, uint256 indexed votingRoundId, uint256 totalUnrevealed);
    event VoterRewardsDeposited(uint256 indexed novelId, uint256 totalAmount, uint256 roundCount);

    // ============================================================
    //                      VOTER ACTIONS
    // ============================================================

    /// @notice Submit an encrypted vote commitment
    function commitVote(uint256 novelId, uint256 votingRoundId, bytes32 commitHash) external payable;

    /// @notice Reveal a previously committed vote
    function revealVote(uint256 novelId, uint256 votingRoundId, uint256 candidateId, bytes32 salt) external;

    /// @notice Claim voting rewards: stake refund + unrevealed share + accuracy reward
    function claimVotingReward(uint256 novelId, uint256 votingRoundId) external;

    /// @notice Sweep unrevealed stakes and redistribute to revealed voters (callable by anyone post-tally)
    function sweepUnrevealedStakes(uint256 novelId, uint256 votingRoundId) external;

    // ============================================================
    //                  CALLED BY NOVELCORE
    // ============================================================

    /// @notice Initialize a new voting round with candidates
    function initializeVoting(uint256 novelId, uint256 votingRoundId, uint256[] calldata candidateIds) external;

    /// @notice Tally votes and return ranked results
    function tallyVotes(uint256 novelId, uint256 votingRoundId) external returns (uint256[] memory rankedIds);

    /// @notice Record voter accuracy reward allocation for multiple voting rounds in an epoch
    /// @dev ETH is sent separately by PrizePool; this only sets per-round allocation
    function depositVoterRewards(uint256 novelId, uint256[] calldata votingRoundIds, uint256 totalAmount) external;

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
