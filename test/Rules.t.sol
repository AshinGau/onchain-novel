// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {TestBase} from "./Integration.t.sol";
import {DataTypes} from "../src/libraries/DataTypes.sol";

/// @title RulesTest
/// @notice Tests for the RulesEngine governance module
contract RulesTest is TestBase {
    // ----------------------------------------------------------
    //  Creator sets rules before first round
    // ----------------------------------------------------------
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

        string[] memory ruleNames = rulesEngine.getRuleNames(novelId);
        assertEq(ruleNames.length, 2);
    }

    // ----------------------------------------------------------
    //  Creator cannot set rules after first round starts
    // ----------------------------------------------------------
    function test_creatorCannotSetRulesAfterFirstRound() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        // Submit a chapter so DFS has candidates
        _submitChapter(author1, novelId, rootId, "chapter for first round!!");

        // Start a round
        vm.prank(keeper);
        novelCore.startRound(novelId);

        // Complete the round
        vm.warp(block.timestamp + NOMINATE_DURATION + 1);
        vm.prank(keeper);
        novelCore.closeNomination(novelId);

        DataTypes.RoundData memory rd = novelCore.getRoundData(novelId, 1);
        uint64 target = rd.candidates[0];
        bytes32 salt = bytes32("rsalt");
        bytes32 commitHash = keccak256(abi.encodePacked(target, salt));

        vm.prank(voter1);
        novelCore.commitVote{value: VOTE_STAKE}(novelId, commitHash);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        vm.prank(keeper);
        novelCore.closeCommit(novelId);

        vm.prank(voter1);
        novelCore.revealVote(novelId, target, salt);

        vm.warp(block.timestamp + REVEAL_DURATION + 1);
        vm.prank(keeper);
        novelCore.settleRound(novelId);

        // Now try to set rules — should revert
        string[] memory names = new string[](1);
        names[0] = "newrule";
        string[] memory contents = new string[](1);
        contents[0] = "content";

        vm.prank(creator);
        vm.expectRevert();
        rulesEngine.setCreatorRules(novelId, names, contents);
    }

    // ----------------------------------------------------------
    //  Rule proposal by anyone (pays fee)
    // ----------------------------------------------------------
    function test_ruleProposal() public {
        uint64 novelId = _createNovel();

        vm.prank(author1);
        uint256 proposalId = rulesEngine.proposeRule{value: 0.01 ether}(
            novelId, DataTypes.RuleProposalType.Add, "setting", "medieval fantasy"
        );

        assertTrue(proposalId > 0);
        DataTypes.RuleProposal memory proposal = rulesEngine.getRuleProposal(proposalId);
        assertEq(proposal.novelId, novelId);
        assertEq(proposal.proposer, author1);
        assertEq(uint8(proposal.proposalType), uint8(DataTypes.RuleProposalType.Add));
    }

    // ----------------------------------------------------------
    //  World line authors vote on proposals
    // ----------------------------------------------------------
    function test_worldLineAuthorsVoteOnProposal() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        // Build tree and run a round to establish world line authors
        uint64 ch2 = _submitChapter(author1, novelId, rootId, "chapter 2 for rules vote!");
        uint64 ch3 = _submitChapter(author2, novelId, ch2, "chapter 3 for rules vote!");

        address[] memory voters = new address[](1);
        voters[0] = voter1;
        _runFullRound(novelId, voters, ch3, bytes32("rulesvote"));

        // Now author1 and author2 should be world line authors
        assertTrue(novelCore.isWorldLineAuthor(novelId, author1));
        assertTrue(novelCore.isWorldLineAuthor(novelId, author2));

        // Create a proposal
        vm.prank(author3);
        uint256 proposalId = rulesEngine.proposeRule{value: 0.01 ether}(
            novelId, DataTypes.RuleProposalType.Add, "magic_system", "hard magic with runes"
        );

        // World line authors vote
        vm.prank(author1);
        rulesEngine.voteOnRuleProposal(proposalId);

        DataTypes.RuleProposal memory proposal = rulesEngine.getRuleProposal(proposalId);
        assertEq(proposal.voteCount, 1);

        // Second vote reaches quorum (ruleQuorum=2), auto-executes
        vm.prank(author2);
        rulesEngine.voteOnRuleProposal(proposalId);

        proposal = rulesEngine.getRuleProposal(proposalId);
        assertTrue(proposal.executed);
        assertEq(rulesEngine.getRule(novelId, "magic_system"), "hard magic with runes");
    }

    // ----------------------------------------------------------
    //  Non-world-line-authors cannot vote
    // ----------------------------------------------------------
    function test_nonWorldLineAuthorCannotVote() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        // Build tree: only author1 on world line
        uint64 ch2 = _submitChapter(author1, novelId, rootId, "chapter by author1 wl test");

        address[] memory voters = new address[](1);
        voters[0] = voter1;
        _runFullRound(novelId, voters, ch2, bytes32("wlvote"));

        // author3 is NOT on the world line
        assertFalse(novelCore.isWorldLineAuthor(novelId, author3));

        // Propose a rule
        vm.prank(author1);
        uint256 proposalId = rulesEngine.proposeRule{value: 0.01 ether}(
            novelId, DataTypes.RuleProposalType.Add, "language", "English only"
        );

        // author3 tries to vote — should revert
        vm.prank(author3);
        vm.expectRevert();
        rulesEngine.voteOnRuleProposal(proposalId);
    }
}
