// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {TestBase} from "./Integration.t.sol";
import {DataTypes} from "../src/libraries/DataTypes.sol";

/// @title RulesTest
/// @notice Tests for the RulesEngine governance module under the path-proof eligibility model.
contract RulesTest is TestBase {
    /// Creator sets initial rules before round 1
    function test_creatorSetsRulesBeforeFirstRound() public {
        uint64 novelId = _createNovel();

        string[] memory names = new string[](2);
        names[0] = "genre";
        names[1] = "tone";
        string[] memory contents = new string[](2);
        contents[0] = "sci-fi";
        contents[1] = "dark and moody";

        vm.prank(creator);
        rulesEngine.setCreatorRules(novelId, names, contents);

        assertEq(rulesEngine.getRule(novelId, "genre"), "sci-fi");
        assertEq(rulesEngine.getRule(novelId, "tone"), "dark and moody");
        assertEq(rulesEngine.getRuleNames(novelId).length, 2);
    }

    /// Creator cannot set rules after first round starts
    function test_creatorCannotSetRulesAfterFirstRound() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        uint64 ch2 = _submitChapter(author1, novelId, rootId, "chapter for first round!!");
        uint64 ch3 = _submitChapter(author2, novelId, rootId, "chapter B for first round!");

        address[] memory voters = new address[](1);
        voters[0] = voter1;
        uint64[] memory leaves = new uint64[](2);
        leaves[0] = ch2;
        leaves[1] = ch3;
        _runFullRound(novelId, leaves, voters, ch2, bytes32("rsalt"));

        // Now try to set rules — should revert (locked after round 1)
        string[] memory names = new string[](1);
        names[0] = "newrule";
        string[] memory contents = new string[](1);
        contents[0] = "content";

        vm.prank(creator);
        vm.expectRevert();
        rulesEngine.setCreatorRules(novelId, names, contents);
    }

    /// Creator can propose using root chapter (root is itself a worldLineAncestor at start)
    function test_ruleProposal() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        vm.prank(creator);
        uint64 proposalId = rulesEngine.proposeRule{value: 0.01 ether}(
            novelId, DataTypes.RuleProposalType.Add, "setting", "medieval fantasy", _singleHop(rootId)
        );

        assertTrue(proposalId > 0);
        DataTypes.RuleProposal memory proposal = rulesEngine.getRuleProposal(proposalId);
        assertEq(proposal.novelId, novelId);
        assertEq(proposal.proposer, creator);
    }

    /// Non-author cannot propose (path's tail chapter doesn't match caller)
    function test_nonAuthorCannotPropose() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        vm.prank(author1); // not the root chapter author
        vm.expectRevert();
        rulesEngine.proposeRule{value: 0.01 ether}(
            novelId, DataTypes.RuleProposalType.Add, "setting", "medieval fantasy", _singleHop(rootId)
        );
    }

    /// World-line authors vote on proposals using path proofs.
    function test_worldLineAuthorsVoteOnProposal() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        uint64 ch2 = _submitChapter(author1, novelId, rootId, "chapter 2 for rules vote!");
        uint64 ch3 = _submitChapter(author2, novelId, ch2, "chapter 3 for rules vote!");
        uint64 ch4 = _submitChapter(author3, novelId, rootId, "branch B for rules vote!!!");

        address[] memory voters = new address[](1);
        voters[0] = voter1;
        uint64[] memory leaves = new uint64[](2);
        leaves[0] = ch3;
        leaves[1] = ch4;
        _runFullRound(novelId, leaves, voters, ch3, bytes32("rulesvote"));

        // After settle, worldLineAncestors = [ch3, ch4]
        uint64[] memory ancestors = novelCore.getWorldLineAncestors(novelId);
        assertEq(ancestors.length, 2);

        // Pre-compute paths BEFORE vm.prank (each prank only stamps the next call).
        uint64[] memory ch3Single = _singleHop(ch3);
        uint64[] memory pathCh2 = _pathFromTo(ch3, ch2); // [ch3, ch2]
        uint64[] memory ch4Single = _singleHop(ch4);

        // Proposal by author2 using ch3 (worldLineAncestor)
        vm.prank(author2);
        uint64 proposalId = rulesEngine.proposeRule{value: 0.01 ether}(
            novelId, DataTypes.RuleProposalType.Add, "magic_system", "hard magic with runes", ch3Single
        );

        // author1 votes using path [ch3, ch2] (proves ch2 is on world line; ch2 author == author1)
        vm.prank(author1);
        rulesEngine.voteOnRuleProposal(proposalId, pathCh2);

        DataTypes.RuleProposal memory proposal = rulesEngine.getRuleProposal(proposalId);
        assertEq(proposal.voteCount, 1);

        // author3 votes using ch4 (worldLineAncestor) → reaches quorum, auto-execute
        vm.prank(author3);
        rulesEngine.voteOnRuleProposal(proposalId, ch4Single);

        proposal = rulesEngine.getRuleProposal(proposalId);
        assertTrue(proposal.executed);
        assertEq(rulesEngine.getRule(novelId, "magic_system"), "hard magic with runes");
    }

    /// Voter using a chapter that doesn't belong to them is rejected.
    function test_offWorldLineAuthorCannotVote() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        uint64 ch2 = _submitChapter(author1, novelId, rootId, "chapter by author1 wl test");
        uint64 ch3 = _submitChapter(author2, novelId, rootId, "chapter B for wl vote test!");

        address[] memory voters = new address[](1);
        voters[0] = voter1;
        uint64[] memory leaves = new uint64[](2);
        leaves[0] = ch2;
        leaves[1] = ch3;
        _runFullRound(novelId, leaves, voters, ch2, bytes32("wlvote"));

        // Pre-compute paths
        uint64[] memory ch2Single = _singleHop(ch2);
        uint64[] memory pathCh3 = _singleHop(ch3); // ch3 is also a worldLineAncestor

        vm.prank(author1);
        uint64 proposalId = rulesEngine.proposeRule{value: 0.01 ether}(
            novelId, DataTypes.RuleProposalType.Add, "language", "English only", ch2Single
        );

        // author3 tries to vote with ch3 (which belongs to author2) → AuthorMismatch revert
        vm.prank(author3);
        vm.expectRevert();
        rulesEngine.voteOnRuleProposal(proposalId, pathCh3);
    }
}
