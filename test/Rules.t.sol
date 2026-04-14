// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {TestBase} from "./Integration.t.sol";
import {DataTypes} from "../src/libraries/DataTypes.sol";

/// @title RulesTest
/// @notice Tests for the RulesEngine governance module under the path-proof eligibility model.
contract RulesTest is TestBase {
    // ─────────── helpers ───────────

    /// Build a path proof: walk parentId from `from` up to `target`, returning the visited
    /// chapter IDs in order [from, ..., target]. For our verifier, `from` should be a current
    /// worldLineAncestor and `target` should be the credential chapter.
    function _buildPath(uint64 from, uint64 target) internal view returns (uint64[] memory path) {
        // First pass: count length
        uint64 cur = from;
        uint256 len = 1;
        while (cur != target) {
            DataTypes.Chapter memory ch = novelCore.getChapter(cur);
            require(ch.id != 0, "path: chapter missing");
            require(ch.depth > 1, "path: hit root before target");
            cur = ch.parentId;
            len++;
            require(len < 256, "path: runaway");
        }
        path = new uint64[](len);
        cur = from;
        path[0] = cur;
        for (uint256 i = 1; i < len; i++) {
            cur = novelCore.getChapter(cur).parentId;
            path[i] = cur;
        }
    }

    /// Simple single-element path when chapterId IS a worldLineAncestor.
    function _singleHopPath(uint64 chapterId) internal pure returns (uint64[] memory path) {
        path = new uint64[](1);
        path[0] = chapterId;
    }

    // ─────────── tests ───────────

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

        _submitChapter(author1, novelId, rootId, "chapter for first round!!");
        _submitChapter(author2, novelId, rootId, "chapter B for first round!");

        vm.prank(keeper);
        roundManager.startRound(novelId);

        vm.warp(block.timestamp + NOMINATE_DURATION + 1);
        vm.prank(keeper);
        roundManager.closeNomination(novelId);

        DataTypes.RoundData memory rd = roundManager.getRoundData(novelId, 1);
        uint64 target = rd.candidates[0];
        bytes32 salt = bytes32("rsalt");
        bytes32 commitHash = keccak256(abi.encodePacked(target, salt));

        vm.prank(voter1);
        roundManager.commitVote{value: VOTE_STAKE}(novelId, commitHash);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        vm.prank(keeper);
        roundManager.closeCommit(novelId);

        vm.prank(voter1);
        roundManager.revealVote(novelId, target, salt);

        vm.warp(block.timestamp + REVEAL_DURATION + 1);
        vm.prank(keeper);
        roundManager.settleRound(novelId);

        string[] memory names = new string[](1);
        names[0] = "newrule";
        string[] memory contents = new string[](1);
        contents[0] = "content";

        vm.prank(creator);
        vm.expectRevert();
        rulesEngine.setCreatorRules(novelId, names, contents);
    }

    /// Creator can propose a rule using the root chapter (root is worldLineAncestor at start)
    function test_ruleProposal() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1; // creator-authored, also a worldLineAncestor pre-round-1

        vm.prank(creator);
        uint256 proposalId = rulesEngine.proposeRule{value: 0.01 ether}(
            novelId,
            DataTypes.RuleProposalType.Add,
            "setting",
            "medieval fantasy",
            rootId,
            _singleHopPath(rootId)
        );

        assertTrue(proposalId > 0);
        DataTypes.RuleProposal memory proposal = rulesEngine.getRuleProposal(proposalId);
        assertEq(proposal.novelId, novelId);
        assertEq(proposal.proposer, creator);
        assertEq(uint8(proposal.proposalType), uint8(DataTypes.RuleProposalType.Add));
    }

    /// Non-author cannot propose (path verification fails on author mismatch)
    function test_nonAuthorCannotPropose() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        vm.prank(author1); // not the root chapter author
        vm.expectRevert();
        rulesEngine.proposeRule{value: 0.01 ether}(
            novelId,
            DataTypes.RuleProposalType.Add,
            "setting",
            "medieval fantasy",
            rootId,
            _singleHopPath(rootId)
        );
    }

    /// World-line authors vote on proposals using path proofs.
    /// After the first round, the world line ends at ch3 (deepest). author1's ch2 is on
    /// the path from rootId down to ch3, so author1 can prove eligibility via path [ch3, ch2].
    function test_worldLineAuthorsVoteOnProposal() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        uint64 ch2 = _submitChapter(author1, novelId, rootId, "chapter 2 for rules vote!");
        uint64 ch3 = _submitChapter(author2, novelId, ch2, "chapter 3 for rules vote!");
        uint64 ch4 = _submitChapter(author3, novelId, rootId, "branch B for rules vote!!!");

        address[] memory voters = new address[](1);
        voters[0] = voter1;
        _runFullRound(novelId, voters, ch3, bytes32("rulesvote"));

        // After settle, worldLineAncestors should include ch3 (the winner) and ch4 (sibling branch leaf).
        uint64[] memory ancestors = novelCore.getWorldLineAncestors(novelId);
        assertEq(ancestors.length, 2);

        // author2 wrote ch3 which IS a worldLineAncestor → single-hop proof
        // author1 wrote ch2 which is on path from ch3 → proof = [ch3, ch2]
        // author3 wrote ch4 which IS a worldLineAncestor → single-hop proof

        // Pre-compute paths BEFORE vm.prank (each prank only stamps the next call).
        uint64[] memory ch3Single = _singleHopPath(ch3);
        uint64[] memory pathCh2 = _buildPath(ch3, ch2);
        uint64[] memory ch4Single = _singleHopPath(ch4);

        // Create a proposal by author2 (ch3 worldLineAncestor)
        vm.prank(author2);
        uint256 proposalId = rulesEngine.proposeRule{value: 0.01 ether}(
            novelId, DataTypes.RuleProposalType.Add, "magic_system", "hard magic with runes", ch3, ch3Single
        );

        // author1 votes using ch2 proven via [ch3, ch2]
        vm.prank(author1);
        rulesEngine.voteOnRuleProposal(proposalId, ch2, pathCh2);

        DataTypes.RuleProposal memory proposal = rulesEngine.getRuleProposal(proposalId);
        assertEq(proposal.voteCount, 1);

        // author3 votes using ch4 (worldLineAncestor) → reaches quorum=2, auto-execute
        vm.prank(author3);
        rulesEngine.voteOnRuleProposal(proposalId, ch4, ch4Single);

        proposal = rulesEngine.getRuleProposal(proposalId);
        assertTrue(proposal.executed);
        assertEq(rulesEngine.getRule(novelId, "magic_system"), "hard magic with runes");
    }

    /// Off-world-line author cannot vote (their chapter has no path to any current ancestor)
    function test_offWorldLineAuthorCannotVote() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        // author1 will be on world line; author2 will be on a sibling branch that loses
        uint64 ch2 = _submitChapter(author1, novelId, rootId, "chapter by author1 wl test");
        uint64 ch3 = _submitChapter(author2, novelId, rootId, "chapter B for wl vote test!");

        address[] memory voters = new address[](1);
        voters[0] = voter1;
        // Voters elect ch2; ch3 loses. After this round, world line includes ch2 (and ch3 as the
        // sibling-branch leaf because worldLineCount=2 and there are exactly 2 leaves). To make
        // the test meaningful we build a deeper world line so the loser is no longer an ancestor.
        _runFullRound(novelId, voters, ch2, bytes32("wlvote"));

        // After round 1, ancestors = [ch2, ch3] (both leaves at depth 2). To disqualify author2,
        // submit a deeper continuation on ch2 only and run another round.
        vm.warp(block.timestamp + MIN_ROUND_GAP + 1);
        uint64 ch4 = _submitChapter(author1, novelId, ch2, "deeper chapter on ch2 line");
        uint64 ch5 = _submitChapter(author1, novelId, ch3, "deeper on ch3 line, author1");
        // Round 2: both lines extended; deepest leaves are ch4 and ch5
        _runFullRound(novelId, voters, ch4, bytes32("wlvote2"));

        // Pre-compute paths
        uint64[] memory ch4Single = _singleHopPath(ch4);
        uint64[] memory pathCh3 = _buildPath(ch5, ch3);
        assertEq(pathCh3.length, 2);
        assertEq(pathCh3[0], ch5);
        assertEq(pathCh3[1], ch3);

        // Create a proposal by author1 using ch4 (a worldLineAncestor)
        vm.prank(author1);
        uint256 proposalId = rulesEngine.proposeRule{value: 0.01 ether}(
            novelId, DataTypes.RuleProposalType.Add, "language", "English only", ch4, ch4Single
        );

        // author3 has never written anything → cannot construct any valid (chapterId, path) pair.
        // Trying with ch3 (which belongs to author2) triggers AuthorMismatch.
        vm.prank(author3);
        vm.expectRevert();
        rulesEngine.voteOnRuleProposal(proposalId, ch3, pathCh3);
    }
}
