// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title DataTypes
/// @notice Shared data structures and enums for the Decentralized Collaborative Novel Protocol
/// @dev Round-only lifecycle with always-on writing
library DataTypes {
    // ============================================================
    //                          ENUMS
    // ============================================================

    /// @notice Content storage location strategy (set per novel at creation, immutable)
    enum ContentLocation {
        Onchain, // Content passed as calldata, stored in event
        External, // IPFS/Arweave, contentBaseUrl + contentHash
        HTTP // HTTP URL, contentBaseUrl + path

    }

    /// @notice Phase within a Round lifecycle
    /// @dev Writing is always-on and decoupled from voting phases
    enum RoundPhase {
        Idle, // Between rounds (after settle or before first round)
        Nominating, // Accepting candidate nominations (DFS auto-generated + user-nominated)
        Committing, // Accepting vote commits (commit-reveal scheme)
        Revealing // Accepting vote reveals

    }

    /// @notice Type of rule proposal
    enum RuleProposalType {
        Add,
        Delete
    }

    // ============================================================
    //                         STRUCTS
    // ============================================================

    /// @notice Configuration set at novel creation time (immutable after genesis)
    struct NovelConfig {
        // --- Chapter parameters ---
        uint64 minChapterLength; // Minimum content bytes per submission
        uint64 maxChapterLength; // Maximum content bytes per submission
        uint256 submissionFee; // Fee per chapter submission (non-refundable, goes to prize pool)
        // --- Voting parameters ---
        uint32 worldLineCount; // N: number of world lines selected per round
        uint256 voteStake; // Required stake per vote commitment (wei)
        uint256 nominationFee; // Fee to nominate an additional candidate chain (wei)
        uint64 nominateDuration; // Nomination phase duration in seconds
        uint64 commitDuration; // Commit phase duration in seconds
        uint64 revealDuration; // Reveal phase duration in seconds
        uint64 minRoundGap; // Minimum interval between rounds in seconds
        // --- Economic parameters ---
        uint16 prizeReleaseRate; // Per-round release rate in basis points (e.g. 2000 = 20%, max 5000)
        uint16 voterRewardRate; // Voter reward share in basis points (e.g. 1500 = 15%, max 5000)
        uint256 maxVoterReward; // Per-address voter reward cap per round (0 = uncapped). Cap applied AFTER 3x accuracy multiplier; excess returns to prize pool
        uint256 unrevealPenaltyFloor; // Minimum penalty for unrevealed votes (wei). Effective penalty = max(this, voteStake * 20%)
        // --- Content storage ---
        ContentLocation contentLocation; // Storage strategy (Onchain/External/HTTP)
        string contentBaseUrl; // Base URL for External/HTTP modes (ignored for Onchain)
        // --- Rules governance ---
        uint256 ruleFee; // Fee to propose a rule (wei), goes to prize pool
        uint64 ruleVoteDuration; // Seconds before a rule proposal expires
        uint32 ruleQuorum; // World-line-author votes needed to pass a rule proposal
    }

    /// @notice Core state of a novel
    /// @dev Fork info is derived from root chapter's parentId, not stored here
    struct Novel {
        uint64 id;
        address creator;
        NovelConfig config;
        uint32 currentRound; // Current round number (0 = no voting yet, 1-based)
        RoundPhase roundPhase; // Current phase within the round
        uint64 phaseStartTime; // Timestamp when current phase started
        uint64 lastSettleTime; // Last round settlement time (for minRoundGap enforcement)
        bool active; // Whether the novel accepts submissions and voting
    }

    /// @notice A chapter (node) in the story tree
    /// @dev Supports bidirectional traversal: parentId (up) and descendants (down)
    struct Chapter {
        uint64 id; // Global unique ID
        uint64 novelId; // Novel this chapter belongs to
        uint64 parentId; // 0 = original root; cross-novel ID = fork root; same-novel ID = continuation
        address author; // Chapter author address
        bytes32 contentHash; // keccak256(content) or IPFS/Arweave CID
        uint64 declaredLength; // Declared content byte length
        uint32 depth; // Tree depth within this novel (root = 1)
        uint64 timestamp; // Block timestamp when submitted
        uint64[] descendants; // Child chapter IDs (for downward DFS traversal)
    }

    /// @notice Per-round voting data
    struct RoundData {
        uint64[] candidates; // Candidate chain chapter IDs (DFS auto-generated + user-nominated)
        bool[] candidateIsEligible; // Whether each candidate is a world-line descendant (affects author rewards)
        uint64[] prevWorldLines; // Previous round's worldLineAncestors (for computing new chapters)
        uint64 nominateEndTime; // End of nomination phase
        uint64 commitEndTime; // End of commit phase
        uint64 revealEndTime; // End of reveal phase
        bool settled; // Whether this round has been settled
    }

    /// @notice A vote commitment in the commit-reveal scheme
    struct VoteCommit {
        bytes32 commitHash; // keccak256(abi.encodePacked(candidateId, salt))
        uint256 stakeAmount; // ETH staked with this vote
        bool revealed; // Whether the vote has been revealed
        uint64 revealedCandidateId; // The candidate voted for (set after reveal)
    }

    /// @notice Unified content submission payload
    struct ContentSubmission {
        bytes32 contentHash; // keccak256(content) for verification
        uint64 declaredLength; // Content byte length
        bytes content; // Onchain: actual content bytes; External/HTTP: empty
    }

    /// @notice A proposal to add or delete a world-building rule
    struct RuleProposal {
        uint256 id; // Global unique proposal ID
        uint64 novelId; // Novel this proposal targets
        address proposer; // Address that created the proposal
        RuleProposalType proposalType; // Add or Delete
        string ruleName; // Rule identifier
        string ruleContent; // Rule content (empty for Delete proposals)
        uint256 createdAt; // block.timestamp when proposed
        uint32 voteCount; // Number of qualifying votes received
        bool executed; // Whether the proposal has been executed
    }

    /// @notice Mutable metadata for display purposes (separate from immutable NovelConfig)
    struct NovelMetadata {
        string title; // Novel title (max 256 bytes)
        string description; // Novel description / synopsis
        string coverUri; // Cover image URI (IPFS/Arweave/HTTP)
    }

    /// @notice A continuation bounty placed on a chapter by a reader
    struct Bounty {
        uint64 chapterId; // Target chapter to continue from
        address tipper; // Reader who created the bounty
        uint256 lockedAmount; // Locked amount (80% of total; 20% already sent to prize pool)
        uint64 deadline; // Submission deadline for qualifying continuations
        bool claimed; // Whether the bounty has been distributed or refunded
    }
}
