// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title DataTypes
/// @notice Shared data structures and enums for the Decentralized Collaborative Novel Protocol
/// @dev This protocol enables multiple AI Agents and humans to co-author novels on-chain
library DataTypes {
    // ============================================================
    //                          ENUMS
    // ============================================================

    /// @notice Phase within a Round lifecycle
    enum RoundPhase {
        Submitting, // Accepting chapter submissions
        Committing, // Accepting vote commits
        Revealing, // Accepting vote reveals
        Settling // Round settlement in progress

    }

    /// @notice Phase within an Epoch lifecycle
    enum EpochPhase {
        Rounds, // Conducting K rounds
        Committing, // Epoch vote commit phase
        Revealing, // Epoch vote reveal phase
        Settling // Epoch settlement (Canon + NFT + rewards)

    }

    // ============================================================
    //                         STRUCTS
    // ============================================================

    /// @notice Configuration set at novel creation time (immutable after genesis)
    struct NovelConfig {
        uint64 minChapterLength; // Minimum content bytes per submission
        uint64 maxChapterLength; // Maximum content bytes per submission
        uint64 roundMinDuration; // Minimum round duration in seconds
        uint32 roundMinSubmissions; // Minimum submissions before round can close (>= worldLineCount)
        uint32 worldLineCount; // N: world lines to keep per round
        uint32 roundsPerEpoch; // K: rounds per epoch
        uint16 prizeReleaseRate; // Epoch release rate in basis points (3000 = 30%)
        uint64 commitDuration; // Commit phase duration in seconds
        uint64 revealDuration; // Reveal phase duration in seconds
        uint256 stakeAmount; // Required stake per chapter submission (wei)
        uint8 pollutionRounds; // M: pollution tracking window (consecutive rounds)
        uint8 pollutionThreshold; // Bottom X percentile counts as pollution (e.g., 20 = bottom 20%)
    }

    /// @notice Core state of a novel
    struct Novel {
        uint256 id;
        address creator;
        NovelConfig config;
        uint32 currentRound; // Current round number within the epoch (1-based)
        uint32 currentEpoch; // Current epoch number (1-based)
        RoundPhase roundPhase;
        EpochPhase epochPhase;
        uint256 phaseStartTime; // Timestamp when current phase started
        bytes32 genesisContentHash; // Genesis content CID
        bool active; // Whether the novel is active
        uint256 forkSourceNovelId; // 0 if original, otherwise the source novel ID
        uint256 forkSourceChapterId; // 0 if original, otherwise the source branch chapter ID
    }

    /// @notice A chapter (submission) in the story tree
    struct Chapter {
        uint256 id;
        uint256 novelId;
        uint256 parentId; // Parent chapter ID (0 = genesis root)
        address author;
        bytes32 contentHash; // IPFS/Arweave CID
        uint64 declaredLength; // Declared content byte length
        uint32 round; // Round when submitted
        uint32 epoch; // Epoch when submitted
        uint256 voteCount; // Accumulated votes after reveal
        bool isWorldLine; // Selected as world line in a round
        bool isCanon; // Selected as canon in an epoch
    }

    /// @notice A vote commitment
    struct VoteCommit {
        bytes32 commitHash; // hash(candidateId, salt)
        uint256 stakeAmount; // ETH staked for StakeToVote
        bool revealed; // Whether the vote has been revealed
        bool claimed; // Whether voting stake refund has been claimed
        uint256 revealedCandidateId; // The candidate voted for (set after reveal)
    }

    /// @notice NFT metadata for a chapter
    struct ChapterNFTMetadata {
        uint256 novelId;
        uint256 chapterId;
        uint32 epoch;
        address author;
        bytes32 contentHash;
    }

    /// @notice Pollution tracking for an author in a specific novel
    struct PollutionRecord {
        uint8 consecutiveStrikes; // Consecutive rounds in bottom percentile
        uint32 lastRecordedRound; // Last round where pollution was checked
    }
}
