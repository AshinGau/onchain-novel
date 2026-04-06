// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DataTypes} from "../libraries/DataTypes.sol";

/// @title IRulesEngine
/// @notice Interface for the world-building rules governance module
interface IRulesEngine {
    // ============================================================
    //                          EVENTS
    // ============================================================

    event RuleSet(uint256 indexed novelId, string name);
    event RuleDeleted(uint256 indexed novelId, string name);
    event RuleProposed(
        uint256 indexed proposalId,
        uint256 indexed novelId,
        address indexed proposer,
        uint8 proposalType,
        string ruleName
    );
    event RuleProposalVoted(uint256 indexed proposalId, address indexed voter, uint32 newVoteCount);
    event RuleProposalExecuted(uint256 indexed proposalId, uint256 indexed novelId);

    // ============================================================
    //                      RULES MANAGEMENT
    // ============================================================

    /// @notice Set rules as the novel creator (only during epoch 1, no voting needed)
    function setCreatorRules(uint256 novelId, string[] calldata names, string[] calldata contents) external;

    /// @notice Propose adding or deleting a rule (requires fee, goes to prize pool)
    function proposeRule(
        uint256 novelId,
        DataTypes.RuleProposalType proposalType,
        string calldata ruleName,
        string calldata ruleContent
    ) external payable returns (uint256 proposalId);

    /// @notice Vote on a rule proposal (canon authors only)
    function voteOnRuleProposal(uint256 proposalId) external;

    // ============================================================
    //                        QUERIES
    // ============================================================

    function getRule(uint256 novelId, string calldata name) external view returns (string memory);
    function getRuleNames(uint256 novelId) external view returns (string[] memory);
    function getRuleProposal(uint256 proposalId) external view returns (DataTypes.RuleProposal memory);
}
