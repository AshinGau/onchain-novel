// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DataTypes} from "../libraries/DataTypes.sol";

/// @title IRulesEngine
/// @notice Interface for the world-building rules governance module.
/// @dev Eligibility for proposing and voting is proven on-demand by a single `path` argument:
///        path[0]    = a current worldLineAncestor of the novel
///        path[last] = a chapter authored by the caller
///        consecutive elements form a parent chain.
///      Validity is checked at submission time only — subsequent world-line shifts do not
///      invalidate already-cast votes or accepted proposals.
interface IRulesEngine {
    // ============================================================
    //                          EVENTS
    // ============================================================

    event RuleSet(uint64 indexed novelId, string name);
    event RuleDeleted(uint64 indexed novelId, string name);
    event RuleProposed(
        uint64 indexed proposalId, uint64 indexed novelId, address indexed proposer, uint8 proposalType, string ruleName
    );
    event RuleProposalVoted(uint64 indexed proposalId, address indexed voter, uint32 newVoteCount);
    event RuleProposalExecuted(uint64 indexed proposalId, uint64 indexed novelId);

    // ============================================================
    //                      RULES MANAGEMENT
    // ============================================================

    /// @notice Set initial rules as the novel creator (only before first round starts).
    function setCreatorRules(uint64 novelId, string[] calldata names, string[] calldata contents) external;

    /// @notice Propose adding or deleting a rule. Caller pays ruleFee.
    /// @param path [worldLineAncestor, ..., callerChapterId] — proves caller authored a chapter on a world line.
    function proposeRule(
        uint64 novelId,
        DataTypes.RuleProposalType proposalType,
        string calldata ruleName,
        string calldata ruleContent,
        uint64[] calldata path
    ) external payable returns (uint64 proposalId);

    /// @notice Vote on a rule proposal. Same `path` shape as proposeRule.
    function voteOnRuleProposal(uint64 proposalId, uint64[] calldata path) external;

    // ============================================================
    //                        QUERIES
    // ============================================================

    function getRule(uint64 novelId, string calldata name) external view returns (string memory);
    function getRuleNames(uint64 novelId) external view returns (string[] memory);
    function getRuleProposal(uint64 proposalId) external view returns (DataTypes.RuleProposal memory);
}
