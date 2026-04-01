// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IVotingEngine} from "../interfaces/IVotingEngine.sol";
import {DataTypes} from "../libraries/DataTypes.sol";

/// @title VotingEngine
/// @notice Commit-Reveal voting engine using Stake-to-Vote (staked ETH = voting weight)
/// @dev Manages voting rounds identified by (novelId, votingRoundId) pairs.
///      votingRoundId is computed by NovelCore to be unique per round/epoch.
///      Both AI Agents and humans can participate as voters.
contract VotingEngine is Initializable, OwnableUpgradeable, ReentrancyGuard, UUPSUpgradeable, IVotingEngine {
    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Authorized NovelCore contract address
    address public novelCore;

    /// @dev Composite key for voting round data: keccak256(novelId, votingRoundId)
    struct VotingRoundData {
        uint256[] candidateIds;
        bool initialized;
        bool tallied;
        uint256 totalVoters; // Number of voters who revealed
        uint256 winnerCandidateId; // Top voted candidate (set after tally)
    }

    /// @notice Voting round data: roundKey => VotingRoundData
    mapping(bytes32 => VotingRoundData) private _votingRounds;

    /// @notice Vote commits: roundKey => voter => VoteCommit
    mapping(bytes32 => mapping(address => DataTypes.VoteCommit)) private _voteCommits;

    /// @notice Vote counts: roundKey => candidateId => vote count
    mapping(bytes32 => mapping(uint256 => uint256)) private _voteCounts;

    /// @notice Voter list per round: roundKey => voters array
    mapping(bytes32 => address[]) private _voters;

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
    error InvalidCandidate(uint256 candidateId);
    error AlreadyTallied();
    error NotTallied();
    error AlreadyClaimed();
    error NotMajorityVoter();
    error NoCandidates();

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

    function setNovelCore(address newNovelCore) external onlyOwner {
        novelCore = newNovelCore;
    }

    // ============================================================
    //                     VOTER ACTIONS
    // ============================================================

    /// @inheritdoc IVotingEngine
    function commitVote(uint256 novelId, uint256 votingRoundId, bytes32 commitHash) external payable {
        bytes32 roundKey = _roundKey(novelId, votingRoundId);
        VotingRoundData storage round = _votingRounds[roundKey];

        if (!round.initialized) revert VotingNotInitialized();
        if (round.tallied) revert AlreadyTallied();
        if (_voteCommits[roundKey][msg.sender].commitHash != bytes32(0)) revert AlreadyCommitted();

        _voteCommits[roundKey][msg.sender] = DataTypes.VoteCommit({
            commitHash: commitHash,
            stakeAmount: msg.value,
            revealed: false,
            claimed: false,
            revealedCandidateId: 0
        });

        _voters[roundKey].push(msg.sender);
    }

    /// @inheritdoc IVotingEngine
    function revealVote(uint256 novelId, uint256 votingRoundId, uint256 candidateId, bytes32 salt) external {
        bytes32 roundKey = _roundKey(novelId, votingRoundId);
        VotingRoundData storage round = _votingRounds[roundKey];

        if (round.tallied) revert AlreadyTallied();

        DataTypes.VoteCommit storage commit = _voteCommits[roundKey][msg.sender];

        if (commit.commitHash == bytes32(0)) revert NotCommitted();
        if (commit.revealed) revert AlreadyRevealed();

        // Verify the reveal matches the commit
        bytes32 expectedHash = keccak256(abi.encodePacked(candidateId, salt));
        if (expectedHash != commit.commitHash) revert InvalidReveal();

        // Verify candidate is valid
        if (!_isValidCandidate(roundKey, candidateId)) revert InvalidCandidate(candidateId);

        commit.revealed = true;
        commit.revealedCandidateId = candidateId;

        // Stake-to-Vote: weight = staked amount normalized (0.001 ETH = 1 vote)
        uint256 voteWeight = commit.stakeAmount / 1e15;
        if (voteWeight == 0) voteWeight = 1; // Minimum 1 vote

        _voteCounts[roundKey][candidateId] += voteWeight;
        round.totalVoters++;

        emit VoteRevealed(novelId, votingRoundId, msg.sender, candidateId);
    }

    /// @inheritdoc IVotingEngine
    function claimVotingReward(uint256 novelId, uint256 votingRoundId) external nonReentrant {
        bytes32 roundKey = _roundKey(novelId, votingRoundId);
        VotingRoundData storage round = _votingRounds[roundKey];

        if (!round.tallied) revert NotTallied();

        DataTypes.VoteCommit storage commit = _voteCommits[roundKey][msg.sender];
        if (!commit.revealed) revert NotCommitted();
        if (commit.claimed) revert AlreadyClaimed();

        commit.claimed = true;

        // Return staked amount to ALL revealed voters (majority or not)
        uint256 refund = commit.stakeAmount;
        if (refund > 0) {
            commit.stakeAmount = 0;
            (bool success,) = msg.sender.call{value: refund}("");
            if (!success) revert();
        }

        emit VotingRewardClaimed(novelId, votingRoundId, msg.sender, refund);
    }

    // ============================================================
    //                  CALLED BY NOVELCORE
    // ============================================================

    /// @inheritdoc IVotingEngine
    function initializeVoting(uint256 novelId, uint256 votingRoundId, uint256[] calldata candidateIds)
        external
        onlyNovelCore
    {
        if (candidateIds.length == 0) revert NoCandidates();

        bytes32 roundKey = _roundKey(novelId, votingRoundId);

        if (_votingRounds[roundKey].initialized) revert VotingAlreadyInitialized();

        _votingRounds[roundKey] = VotingRoundData({
            candidateIds: candidateIds,
            initialized: true,
            tallied: false,
            totalVoters: 0,
            winnerCandidateId: 0
        });

        emit VotingInitialized(novelId, votingRoundId, candidateIds.length);
    }

    /// @inheritdoc IVotingEngine
    function tallyVotes(uint256 novelId, uint256 votingRoundId)
        external
        onlyNovelCore
        returns (uint256[] memory rankedIds)
    {
        bytes32 roundKey = _roundKey(novelId, votingRoundId);
        VotingRoundData storage round = _votingRounds[roundKey];

        if (!round.initialized) revert VotingNotInitialized();
        if (round.tallied) revert AlreadyTallied();

        uint256 len = round.candidateIds.length;

        // Copy candidates and their vote counts
        rankedIds = new uint256[](len);
        uint256[] memory counts = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            rankedIds[i] = round.candidateIds[i];
            counts[i] = _voteCounts[roundKey][rankedIds[i]];
        }

        // Simple insertion sort by vote count (descending)
        // Fine for small N (typically ≤ 20 candidates)
        for (uint256 i = 1; i < len; i++) {
            uint256 keyId = rankedIds[i];
            uint256 keyCount = counts[i];
            int256 j = int256(i) - 1;

            while (j >= 0 && counts[uint256(j)] < keyCount) {
                rankedIds[uint256(j + 1)] = rankedIds[uint256(j)];
                counts[uint256(j + 1)] = counts[uint256(j)];
                j--;
            }
            rankedIds[uint256(j + 1)] = keyId;
            counts[uint256(j + 1)] = keyCount;
        }

        round.tallied = true;
        round.winnerCandidateId = rankedIds[0];

        emit VotesTallied(novelId, votingRoundId, rankedIds);

        return rankedIds;
    }

    // ============================================================
    //                        QUERIES
    // ============================================================

    /// @inheritdoc IVotingEngine
    function getVoteCommit(uint256 novelId, uint256 votingRoundId, address voter)
        external
        view
        returns (DataTypes.VoteCommit memory)
    {
        return _voteCommits[_roundKey(novelId, votingRoundId)][voter];
    }

    /// @inheritdoc IVotingEngine
    function getVoteCount(uint256 novelId, uint256 votingRoundId, uint256 candidateId)
        external
        view
        returns (uint256)
    {
        return _voteCounts[_roundKey(novelId, votingRoundId)][candidateId];
    }

    /// @inheritdoc IVotingEngine
    function getCandidates(uint256 novelId, uint256 votingRoundId) external view returns (uint256[] memory) {
        return _votingRounds[_roundKey(novelId, votingRoundId)].candidateIds;
    }

    // ============================================================
    //                     INTERNAL HELPERS
    // ============================================================

    /// @dev Compute a unique key for a voting round
    function _roundKey(uint256 novelId, uint256 votingRoundId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(novelId, votingRoundId));
    }

    /// @dev Check if a candidateId is valid in this voting round
    function _isValidCandidate(bytes32 roundKey, uint256 candidateId) internal view returns (bool) {
        uint256[] storage candidates = _votingRounds[roundKey].candidateIds;
        for (uint256 i = 0; i < candidates.length; i++) {
            if (candidates[i] == candidateId) return true;
        }
        return false;
    }

    // ============================================================
    //                     UUPS UPGRADE
    // ============================================================

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ============================================================
    //                    STORAGE GAP
    // ============================================================

    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;
}
