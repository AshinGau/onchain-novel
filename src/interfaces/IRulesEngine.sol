// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DataTypes} from "../libraries/DataTypes.sol";

/// @title IRulesEngine
/// @notice Interface for the world-building rules governance module
/// @dev Eligibility for proposing and voting is proven on-demand: caller supplies one of their
///      authored chapter IDs plus a parent-chain path ending at a current world-line ancestor.
///      Validity is checked at submission time only — subsequent world-line shifts do not invalidate
///      already-cast votes or accepted proposals.
interface IRulesEngine {
    // ============================================================
    //                          EVENTS
    // ============================================================

    /// @notice Emitted when a rule is set by the novel creator
    event RuleSet(uint64 indexed novelId, string name);

    /// @notice Emitted when a rule is deleted
    event RuleDeleted(uint64 indexed novelId, string name);

    /// @notice Emitted when a rule proposal is created
    event RuleProposed(
        uint256 indexed proposalId,
        uint64 indexed novelId,
        address indexed proposer,
        uint8 proposalType,
        string ruleName
    );

    /// @notice Emitted when a world-line author votes on a rule proposal
    event RuleProposalVoted(uint256 indexed proposalId, address indexed voter, uint32 newVoteCount);

    /// @notice Emitted when a rule proposal reaches quorum and is executed
    event RuleProposalExecuted(uint256 indexed proposalId, uint64 indexed novelId);

    // ============================================================
    //                      RULES MANAGEMENT
    // ============================================================

    /// @notice Set initial rules as the novel creator (only before first round starts)
    /// @param novelId The novel ID
    /// @param names Array of rule names
    /// @param contents Array of rule contents (parallel to names)
    function setCreatorRules(uint64 novelId, string[] calldata names, string[] calldata contents) external;

    /// @notice Propose adding or deleting a rule (requires ruleFee + world-line author proof)
    /// @param novelId The novel ID
    /// @param proposalType Add or Delete
    /// @param ruleName The rule name to add or delete
    /// @param ruleContent The rule content (empty for Delete proposals)
    /// @param chapterId Caller-authored chapter used as eligibility credential
    /// @param path     [worldLineAncestor, ..., chapterId] — parent-chain proof that chapterId is on a world line
    /// @return proposalId The ID of the created proposal
    function proposeRule(
        uint64 novelId,
        DataTypes.RuleProposalType proposalType,
        string calldata ruleName,
        string calldata ruleContent,
        uint64 chapterId,
        uint64[] calldata path
    ) external payable returns (uint256 proposalId);

    /// @notice Vote on a rule proposal (world-line author proof required)
    /// @param proposalId The proposal ID to vote on
    /// @param chapterId  Voter-authored chapter used as eligibility credential
    /// @param path       [chapterId, ..., ancestorOnWorldLine] — proves chapterId is currently on a world line
    function voteOnRuleProposal(uint256 proposalId, uint64 chapterId, uint64[] calldata path) external;

    // ============================================================
    //                        QUERIES
    // ============================================================

    /// @notice Get the content of a specific rule
    function getRule(uint64 novelId, string calldata name) external view returns (string memory);

    /// @notice Get all rule names for a novel
    function getRuleNames(uint64 novelId) external view returns (string[] memory);

    /// @notice Get the full data of a rule proposal
    function getRuleProposal(uint256 proposalId) external view returns (DataTypes.RuleProposal memory);
}
