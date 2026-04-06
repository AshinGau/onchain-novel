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

    /// @notice Content storage location strategy (set per novel at creation)
    enum ContentLocation {
        Onchain, // Content passed as calldata, stored in event
        External, // IPFS/Arweave, contentBaseUrl + contentHash
        HTTP // HTTP URL, contentBaseUrl + path

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
        uint16 voterRewardRate; // Voter reward rate in basis points (max 2000 = 20%)
        uint64 commitDuration; // Commit phase duration in seconds
        uint64 revealDuration; // Reveal phase duration in seconds
        uint256 stakeAmount; // Required stake per chapter submission (wei)
        uint8 spamRounds; // M: spam tracking window (consecutive rounds)
        uint8 spamThreshold; // Bottom X percentile counts as spam (e.g., 20 = bottom 20%)
        ContentLocation contentLocation; // Content storage strategy
        string contentBaseUrl; // Base URL (External/HTTP only, ignored for Onchain)
        uint256 ruleFee; // Fee to propose a rule (wei), goes to prize pool
        uint64 ruleVoteDuration; // Seconds before a rule proposal expires
        uint32 ruleQuorum; // Canon-author votes needed to pass a rule proposal
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
        uint32 bootstrapChapterCount; // Number of bootstrap chapters (creator-authored, uploaded at creation)
        uint32 cumulativeCanonChapters; // Total canon chapters across all settled epochs
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
        uint32 chapterIndex; // Sequential position in story chain (genesis=0, each continuation=parent+1)
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

    /// @notice Spam tracking for an author in a specific novel
    struct SpamRecord {
        uint8 consecutiveStrikes; // Consecutive rounds in bottom percentile
        uint32 lastRecordedRound; // Last round where spam was checked
    }

    /// @notice Unified content submission (replaces separate contentHash + declaredLength params)
    struct ContentSubmission {
        bytes32 contentHash; // keccak256(content) for verification
        uint64 declaredLength; // Content byte length
        bytes content; // Onchain: actual content; External/HTTP: empty
    }

    /// @notice Type of rule proposal
    enum RuleProposalType {
        Add,
        Delete
    }

    /// @notice A proposal to add or delete a rule
    struct RuleProposal {
        uint256 id;
        uint256 novelId;
        address proposer;
        RuleProposalType proposalType;
        string ruleName;
        string ruleContent; // empty for Delete proposals
        uint256 createdAt; // block.timestamp when proposed
        uint32 voteCount;
        bool executed;
    }

    /// @notice Mutable metadata for display purposes (separate from immutable NovelConfig)
    struct NovelMetadata {
        string title; // Novel title (max 256 bytes)
        string description; // Novel description / synopsis
        string coverUri; // Cover image URI (IPFS/Arweave/HTTP)
    }
}
