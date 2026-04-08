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
///      NovelCore handles phase enforcement; this contract manages vote data and rewards.
contract VotingEngine is Initializable, OwnableUpgradeable, ReentrancyGuard, UUPSUpgradeable, IVotingEngine {
    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Authorized NovelCore contract address
    address public novelCore;

    /// @dev Per-round voting state, keyed by keccak256(novelId, round)
    struct VotingRoundData {
        uint64[] candidateIds;
        bool initialized;
        bool tallied;
        bool rewardsSettled;
        uint256 totalRevealedStake;
        uint256 totalAccurateStake; // Stake of voters who voted for ANY winning candidate
        uint256 voterRewardPool;
        uint256 unrevealedStakes;
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

    /// @notice Whether a voter has claimed: roundKey => voter => claimed
    mapping(bytes32 => mapping(address => bool)) private _claimed;

    /// @notice Whether a candidateId is valid in a round: roundKey => candidateId => isCandidate
    mapping(bytes32 => mapping(uint64 => bool)) private _isCandidate;

    // ============================================================
    //                         ERRORS
    // ============================================================

    error OnlyNovelCore();
    error VotingNotInitialized();
    error VotingAlreadyInitialized();
    error AlreadyCommitted();
    error NotCommitted();
    error AlreadyRevealed();
    error InvalidReveal();
    error InvalidCandidate(uint64 candidateId);
    error AlreadyTallied();
    error NotTallied();
    error AlreadyClaimed();
    error NoCandidates();
    error NotRevealed();
    error RewardsNotSettled();
    error RewardsAlreadySettled();
    error TransferFailed();
    error NoRewardToClaim();
    error InvalidCommitHash();

    // ============================================================
    //                        MODIFIERS
    // ============================================================

    modifier onlyNovelCore() {
        if (msg.sender != novelCore) revert OnlyNovelCore();
        _;
    }

    // ============================================================
    //                      INITIALIZER
    // ============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address novelCore_) external initializer {
        __Ownable_init(owner_);
        novelCore = novelCore_;
    }

    // ============================================================
    //                     ADMIN FUNCTIONS
    // ============================================================

    event NovelCoreUpdated(address indexed oldAddr, address indexed newAddr);

    function setNovelCore(address newNovelCore) external onlyOwner {
        address old = novelCore;
        novelCore = newNovelCore;
        emit NovelCoreUpdated(old, newNovelCore);
    }

    // ============================================================
    //                  CALLED BY NOVELCORE
    // ============================================================

    /// @inheritdoc IVotingEngine
    function initializeVoting(uint64 novelId, uint32 round, uint64[] calldata candidates) external onlyNovelCore {
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
    function addCandidate(uint64 novelId, uint32 round, uint64 candidateId) external onlyNovelCore {
        bytes32 roundKey = _roundKey(novelId, round);
        VotingRoundData storage rd = _votingRounds[roundKey];
        if (!rd.initialized) revert VotingNotInitialized();

        rd.candidateIds.push(candidateId);
        _isCandidate[roundKey][candidateId] = true;
    }

    /// @inheritdoc IVotingEngine
    function commitVote(uint64 novelId, uint32 round, address voter, bytes32 commitHash, uint256 stakeAmount)
        external
        onlyNovelCore
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
        onlyNovelCore
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
        onlyNovelCore
        returns (uint64[] memory rankedIds, uint256[] memory voteWeights)
    {
        bytes32 roundKey = _roundKey(novelId, round);
        VotingRoundData storage rd = _votingRounds[roundKey];

        if (!rd.initialized) revert VotingNotInitialized();
        if (rd.tallied) revert AlreadyTallied();

        rd.tallied = true;

        uint256 len = rd.candidateIds.length;

        // Build ranked list sorted by vote weight (descending)
        rankedIds = new uint64[](len);
        voteWeights = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            rankedIds[i] = rd.candidateIds[i];
            voteWeights[i] = _voteWeights[roundKey][rankedIds[i]];
        }

        // Insertion sort by vote weight descending
        for (uint256 i = 1; i < len; i++) {
            uint64 keyId = rankedIds[i];
            uint256 keyWeight = voteWeights[i];
            int256 j = int256(i) - 1;

            while (j >= 0 && voteWeights[uint256(j)] < keyWeight) {
                rankedIds[uint256(j + 1)] = rankedIds[uint256(j)];
                voteWeights[uint256(j + 1)] = voteWeights[uint256(j)];
                j--;
            }
            rankedIds[uint256(j + 1)] = keyId;
            voteWeights[uint256(j + 1)] = keyWeight;
        }

        // Mark only the top winnerCount candidates as winners
        uint256 actualWinnerCount = len < winnerCount ? len : winnerCount;
        for (uint256 i = 0; i < actualWinnerCount; i++) {
            _winningCandidates[roundKey][rankedIds[i]] = true;
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

        emit VotesTallied(novelId, round, rankedIds);

        return (rankedIds, voteWeights);
    }

    /// @inheritdoc IVotingEngine
    function settleVoterRewards(uint64 novelId, uint32 round, uint256 voterRewardPool, uint256 unrevealedStakes)
        external
        onlyNovelCore
    {
        bytes32 roundKey = _roundKey(novelId, round);
        VotingRoundData storage rd = _votingRounds[roundKey];

        if (!rd.tallied) revert NotTallied();
        if (rd.rewardsSettled) revert RewardsAlreadySettled();

        rd.rewardsSettled = true;
        rd.voterRewardPool = voterRewardPool;
        rd.unrevealedStakes = unrevealedStakes;

        emit VoterRewardsSettled(novelId, round, voterRewardPool + unrevealedStakes);
    }

    /// @inheritdoc IVotingEngine
    function claimVotingReward(uint64 novelId, uint32 round, address voter)
        external
        onlyNovelCore
        nonReentrant
        returns (uint256 amount)
    {
        bytes32 roundKey = _roundKey(novelId, round);
        VotingRoundData storage rd = _votingRounds[roundKey];

        if (!rd.rewardsSettled) revert RewardsNotSettled();

        DataTypes.VoteCommit storage commit = _voteCommits[roundKey][voter];
        if (!commit.revealed) revert NotRevealed();
        if (_claimed[roundKey][voter]) revert AlreadyClaimed();

        _claimed[roundKey][voter] = true;

        // 1. Stake refund
        uint256 totalPayout = commit.stakeAmount;

        // 2. Accuracy reward from voterRewardPool + unrevealedStakes
        uint256 rewardPool = rd.voterRewardPool + rd.unrevealedStakes;
        if (rewardPool > 0 && rd.totalRevealedStake > 0) {
            bool isAccurate = _winningCandidates[roundKey][commit.revealedCandidateId];
            uint256 myWeight = isAccurate ? commit.stakeAmount * 3 : commit.stakeAmount;

            // totalWeight = totalRevealedStake + totalAccurateStake * 2
            uint256 totalWeight = rd.totalRevealedStake + rd.totalAccurateStake * 2;

            if (totalWeight > 0) {
                totalPayout += (rewardPool * myWeight) / totalWeight;
            }
        }

        if (totalPayout == 0) revert NoRewardToClaim();

        (bool success,) = voter.call{value: totalPayout}("");
        if (!success) revert TransferFailed();

        emit VotingRewardClaimed(novelId, round, voter, totalPayout);

        return totalPayout;
    }

    /// @notice Accept ETH transfers (stake deposits forwarded from NovelCore)
    receive() external payable {}

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
