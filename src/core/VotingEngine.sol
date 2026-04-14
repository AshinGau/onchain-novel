// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IVotingEngine} from "../interfaces/IVotingEngine.sol";
import {DataTypes} from "../libraries/DataTypes.sol";

/// @title VotingEngine
/// @notice Commit-Reveal voting engine using Stake-to-Vote
/// @dev Manages voting rounds identified by (novelId, round) pairs.
///      RoundManager handles phase enforcement; this contract manages vote data and rewards.
contract VotingEngine is Initializable, OwnableUpgradeable, ReentrancyGuard, UUPSUpgradeable, IVotingEngine {
    // ============================================================
    //                        CONSTANTS
    // ============================================================

    /// @notice Per-address voter reward cap = voteStake * this multiplier
    /// @dev Protocol-level safety rail for cases where reward pool is massive vs voter count
    uint256 public constant VOTER_REWARD_CAP_MULTIPLIER = 20;

    /// @notice Penalty rate for unrevealed votes in basis points (5000 = 50%)
    uint256 public constant UNREVEAL_PENALTY_RATE_BP = 5000;

    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Authorized RoundManager contract address
    address public roundManager;

    /// @notice PrizePool contract address (allowed to send voter rewards via receive())
    address public prizePool;

    /// @dev Per-round voting state, keyed by keccak256(novelId, round)
    struct VotingRoundData {
        uint64[] candidateIds;
        bool initialized;
        bool tallied;
        bool rewardsSettled;
        uint256 totalRevealedStake;
        uint256 totalAccurateStake; // Stake of voters who voted for ANY winning candidate
        uint256 totalRewardPool; // voterRewardPool + total unreveal penalty (after settle)
    }

    /// @notice Voting round data: roundKey => VotingRoundData
    mapping(bytes32 => VotingRoundData) private _votingRounds;

    /// @notice Vote commits: roundKey => voter => VoteCommit
    mapping(bytes32 => mapping(address => DataTypes.VoteCommit)) private _voteCommits;

    /// @notice Vote weights: roundKey => candidateId => total stake weight
    mapping(bytes32 => mapping(uint64 => uint256)) private _voteWeights;

    /// @notice Voter list per round: roundKey => voters array
    mapping(bytes32 => address[]) private _voters;

    /// @notice Winning candidate set: roundKey => candidateId => isWinner
    mapping(bytes32 => mapping(uint64 => bool)) private _winningCandidates;

    /// @notice Per-voter claimable amount, populated by settleVoterRewards: roundKey => voter => wei
    /// @dev Includes stake refund + capped accuracy reward (revealed) or partial refund (unrevealed)
    mapping(bytes32 => mapping(address => uint256)) private _claimable;

    /// @notice Whether a candidateId is valid in a round: roundKey => candidateId => isCandidate
    mapping(bytes32 => mapping(uint64 => bool)) private _isCandidate;

    // ============================================================
    //                         ERRORS
    // ============================================================

    error OnlyRoundManager();
    error Unauthorized();
    error ZeroAddress();
    error VotingNotInitialized();
    error VotingAlreadyInitialized();
    error AlreadyCommitted();
    error NotCommitted();
    error AlreadyRevealed();
    error InvalidReveal();
    error InvalidCandidate(uint64 candidateId);
    error AlreadyTallied();
    error NotTallied();
    error NoCandidates();
    error RewardsNotSettled();
    error RewardsAlreadySettled();
    error TransferFailed();
    error NoRewardToClaim();
    error InvalidCommitHash();

    // ============================================================
    //                        MODIFIERS
    // ============================================================

    modifier onlyRoundManager() {
        if (msg.sender != roundManager) revert OnlyRoundManager();
        _;
    }

    // ============================================================
    //                      INITIALIZER
    // ============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address roundManager_) external initializer {
        __Ownable_init(owner_);
        roundManager = roundManager_;
    }

    // ============================================================
    //                     ADMIN FUNCTIONS
    // ============================================================

    event RoundManagerUpdated(address indexed oldAddr, address indexed newAddr);
    event PrizePoolUpdated(address indexed oldAddr, address indexed newAddr);

    function setRoundManager(address newRoundManager) external onlyOwner {
        address old = roundManager;
        roundManager = newRoundManager;
        emit RoundManagerUpdated(old, newRoundManager);
    }

    function setPrizePool(address newPrizePool) external onlyOwner {
        if (newPrizePool == address(0)) revert ZeroAddress();
        address old = prizePool;
        prizePool = newPrizePool;
        emit PrizePoolUpdated(old, newPrizePool);
    }

    // ============================================================
    //                  CALLED BY NOVELCORE
    // ============================================================

    /// @inheritdoc IVotingEngine
    function initializeVoting(uint64 novelId, uint32 round, uint64[] calldata candidates) external onlyRoundManager {
        if (candidates.length == 0) revert NoCandidates();

        bytes32 roundKey = _roundKey(novelId, round);
        if (_votingRounds[roundKey].initialized) revert VotingAlreadyInitialized();

        VotingRoundData storage rd = _votingRounds[roundKey];
        rd.initialized = true;
        for (uint256 i = 0; i < candidates.length; i++) {
            rd.candidateIds.push(candidates[i]);
            _isCandidate[roundKey][candidates[i]] = true;
        }

        emit VotingInitialized(novelId, round, candidates.length);
    }

    /// @inheritdoc IVotingEngine
    function addCandidate(uint64 novelId, uint32 round, uint64 candidateId) external onlyRoundManager {
        bytes32 roundKey = _roundKey(novelId, round);
        VotingRoundData storage rd = _votingRounds[roundKey];
        if (!rd.initialized) revert VotingNotInitialized();

        rd.candidateIds.push(candidateId);
        _isCandidate[roundKey][candidateId] = true;
    }

    /// @inheritdoc IVotingEngine
    function commitVote(uint64 novelId, uint32 round, address voter, bytes32 commitHash, uint256 stakeAmount)
        external
        onlyRoundManager
    {
        bytes32 roundKey = _roundKey(novelId, round);
        VotingRoundData storage rd = _votingRounds[roundKey];

        if (!rd.initialized) revert VotingNotInitialized();
        if (commitHash == bytes32(0)) revert InvalidCommitHash();
        if (_voteCommits[roundKey][voter].commitHash != bytes32(0)) revert AlreadyCommitted();

        _voteCommits[roundKey][voter] = DataTypes.VoteCommit({
            commitHash: commitHash,
            stakeAmount: stakeAmount,
            revealed: false,
            revealedCandidateId: 0
        });

        _voters[roundKey].push(voter);

        emit VoteCommitted(novelId, round, voter);
    }

    /// @inheritdoc IVotingEngine
    function revealVote(uint64 novelId, uint32 round, address voter, uint64 candidateId, bytes32 salt)
        external
        onlyRoundManager
    {
        bytes32 roundKey = _roundKey(novelId, round);
        VotingRoundData storage rd = _votingRounds[roundKey];

        if (!rd.initialized) revert VotingNotInitialized();

        DataTypes.VoteCommit storage commit = _voteCommits[roundKey][voter];
        if (commit.commitHash == bytes32(0)) revert NotCommitted();
        if (commit.revealed) revert AlreadyRevealed();

        // Verify the reveal matches the commit
        bytes32 expectedHash = keccak256(abi.encodePacked(candidateId, salt));
        if (expectedHash != commit.commitHash) revert InvalidReveal();

        // Verify candidate is valid
        if (!_isValidCandidate(roundKey, candidateId)) revert InvalidCandidate(candidateId);

        commit.revealed = true;
        commit.revealedCandidateId = candidateId;

        // Vote weight = stake amount
        _voteWeights[roundKey][candidateId] += commit.stakeAmount;
        rd.totalRevealedStake += commit.stakeAmount;

        emit VoteRevealed(novelId, round, voter, candidateId);
    }

    /// @inheritdoc IVotingEngine
    function tallyVotes(uint64 novelId, uint32 round, uint32 winnerCount)
        external
        onlyRoundManager
        returns (uint64[] memory winners)
    {
        bytes32 roundKey = _roundKey(novelId, round);
        VotingRoundData storage rd = _votingRounds[roundKey];

        if (!rd.initialized) revert VotingNotInitialized();
        if (rd.tallied) revert AlreadyTallied();

        rd.tallied = true;

        uint256 len = rd.candidateIds.length;

        // Build ranked list sorted by vote weight (descending)
        uint64[] memory rankedIds = new uint64[](len);
        uint256[] memory weights = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            rankedIds[i] = rd.candidateIds[i];
            weights[i] = _voteWeights[roundKey][rankedIds[i]];
        }

        // Insertion sort by vote weight descending
        for (uint256 i = 1; i < len; i++) {
            uint64 keyId = rankedIds[i];
            uint256 keyWeight = weights[i];
            int256 j = int256(i) - 1;

            while (j >= 0 && weights[uint256(j)] < keyWeight) {
                rankedIds[uint256(j + 1)] = rankedIds[uint256(j)];
                weights[uint256(j + 1)] = weights[uint256(j)];
                j--;
            }
            rankedIds[uint256(j + 1)] = keyId;
            weights[uint256(j + 1)] = keyWeight;
        }

        // Take top winnerCount and mark them
        uint256 winnerLen = len < winnerCount ? len : winnerCount;
        winners = new uint64[](winnerLen);
        for (uint256 i = 0; i < winnerLen; i++) {
            winners[i] = rankedIds[i];
            _winningCandidates[roundKey][winners[i]] = true;
        }

        // Compute totalAccurateStake: sum of stakes from voters who voted for ANY winner
        address[] storage voters = _voters[roundKey];
        uint256 accurateStake = 0;
        for (uint256 i = 0; i < voters.length; i++) {
            DataTypes.VoteCommit storage commit = _voteCommits[roundKey][voters[i]];
            if (commit.revealed && _winningCandidates[roundKey][commit.revealedCandidateId]) {
                accurateStake += commit.stakeAmount;
            }
        }
        rd.totalAccurateStake = accurateStake;

        emit VotesTallied(novelId, round, winners);
    }

    /// @inheritdoc IVotingEngine
    function settleVoterRewards(uint64 novelId, uint32 round, uint256 voterRewardPool, uint256 voteStake)
        external
        onlyRoundManager
        returns (uint256 excessReturn)
    {
        bytes32 roundKey = _roundKey(novelId, round);
        VotingRoundData storage rd = _votingRounds[roundKey];

        if (!rd.tallied) revert NotTallied();
        if (rd.rewardsSettled) revert RewardsAlreadySettled();

        rd.rewardsSettled = true;

        address[] storage voters = _voters[roundKey];
        uint256 voterCount = voters.length;
        uint256 penaltyPerUnreveal = _unrevealPenalty(voteStake);
        uint256 maxVoterReward = voteStake * VOTER_REWARD_CAP_MULTIPLIER;

        // ---- Pass 1: compute total unreveal penalty ----
        uint256 totalPenalty = 0;
        for (uint256 i = 0; i < voterCount; i++) {
            DataTypes.VoteCommit storage c = _voteCommits[roundKey][voters[i]];
            if (c.revealed) continue;
            totalPenalty += penaltyPerUnreveal;
        }

        // ---- Reward pool = base from prize pool + collected penalties ----
        uint256 totalRewardPool = voterRewardPool + totalPenalty;
        rd.totalRewardPool = totalRewardPool;

        // ---- Pass 2: distribute capped rewards to revealed voters; refund unrevealed ----
        uint256 totalWeight = rd.totalRevealedStake + rd.totalAccurateStake * 2;
        uint256 totalDistributed = 0;

        for (uint256 i = 0; i < voterCount; i++) {
            address voter = voters[i];
            DataTypes.VoteCommit storage c = _voteCommits[roundKey][voter];

            if (c.revealed) {
                uint256 reward = 0;
                if (totalWeight > 0 && totalRewardPool > 0) {
                    bool isAccurate = _winningCandidates[roundKey][c.revealedCandidateId];
                    uint256 myWeight = isAccurate ? c.stakeAmount * 3 : c.stakeAmount;
                    reward = (totalRewardPool * myWeight) / totalWeight;
                    if (reward > maxVoterReward) {
                        reward = maxVoterReward;
                    }
                }
                _claimable[roundKey][voter] = c.stakeAmount + reward;
                totalDistributed += reward;
            } else {
                _claimable[roundKey][voter] = c.stakeAmount - penaltyPerUnreveal;
            }
        }

        // ---- Excess (cap savings + undistributed pool) returns to caller (RoundManager) ----
        excessReturn = totalRewardPool > totalDistributed ? totalRewardPool - totalDistributed : 0;
        if (excessReturn > 0) {
            (bool sent,) = msg.sender.call{value: excessReturn}("");
            if (!sent) revert TransferFailed();
        }

        emit VoterRewardsSettled(novelId, round, totalRewardPool);
    }

    /// @inheritdoc IVotingEngine
    function claimVotingReward(uint64 novelId, uint32 round, address voter)
        external
        onlyRoundManager
        nonReentrant
        returns (uint256 amount)
    {
        bytes32 roundKey = _roundKey(novelId, round);
        VotingRoundData storage rd = _votingRounds[roundKey];

        if (!rd.rewardsSettled) revert RewardsNotSettled();

        amount = _claimable[roundKey][voter];
        if (amount == 0) revert NoRewardToClaim();

        // CEI: clear before transfer
        _claimable[roundKey][voter] = 0;

        (bool success,) = voter.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit VotingRewardClaimed(novelId, round, voter, amount);
    }

    /// @dev Compute the penalty applied to an unrevealed voter (fixed 50% of stake)
    function _unrevealPenalty(uint256 voteStake) internal pure returns (uint256) {
        return (voteStake * UNREVEAL_PENALTY_RATE_BP) / 10000;
    }

    /// @notice Accept ETH from RoundManager (committed stakes) and PrizePool (voter rewards).
    /// @dev Whitelisted to prevent stray ETH from accumulating.
    receive() external payable {
        if (msg.sender != roundManager && msg.sender != prizePool) revert Unauthorized();
    }

    // ============================================================
    //                        QUERIES
    // ============================================================

    /// @inheritdoc IVotingEngine
    function getVoteCommit(uint64 novelId, uint32 round, address voter)
        external
        view
        returns (DataTypes.VoteCommit memory)
    {
        return _voteCommits[_roundKey(novelId, round)][voter];
    }

    /// @inheritdoc IVotingEngine
    function getVoteCount(uint64 novelId, uint32 round, uint64 candidateId) external view returns (uint256) {
        return _voteWeights[_roundKey(novelId, round)][candidateId];
    }

    /// @inheritdoc IVotingEngine
    function getCandidates(uint64 novelId, uint32 round) external view returns (uint64[] memory) {
        return _votingRounds[_roundKey(novelId, round)].candidateIds;
    }

    /// @inheritdoc IVotingEngine
    function getClaimableReward(uint64 novelId, uint32 round, address voter) external view returns (uint256) {
        return _claimable[_roundKey(novelId, round)][voter];
    }

    // ============================================================
    //                     INTERNAL HELPERS
    // ============================================================

    /// @dev Compute a unique key for a voting round
    function _roundKey(uint64 novelId, uint32 round) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(novelId, round));
    }

    /// @dev Check if a candidateId is valid in this voting round (O(1) via mapping)
    function _isValidCandidate(bytes32 roundKey, uint64 candidateId) internal view returns (bool) {
        return _isCandidate[roundKey][candidateId];
    }

    // ============================================================
    //                     UUPS UPGRADE
    // ============================================================

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ============================================================
    //                    STORAGE GAP
    // ============================================================

    /// @dev Reserved storage gap for future upgrades
    uint256[49] private __gap;
}
