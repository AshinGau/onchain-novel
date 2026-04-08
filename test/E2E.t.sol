// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {V2TestBase} from "./Integration.t.sol";
import {DataTypes} from "../src/libraries/DataTypes.sol";

/// @title E2ETest
/// @notice End-to-end scenarios for V2 protocol
contract E2ETest is V2TestBase {
    // ----------------------------------------------------------
    //  Full 3-round lifecycle with multiple authors and voters
    // ----------------------------------------------------------
    function test_threeRoundLifecycle() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        // --- Round 1 ---
        uint64 ch2 = _submitChapter(author1, novelId, rootId, "round1 branch A by author1");
        uint64 ch3 = _submitChapter(author2, novelId, rootId, "round1 branch B by author2");

        address[] memory voters = new address[](2);
        voters[0] = voter1;
        voters[1] = voter2;

        _runFullRound(novelId, voters, ch2, bytes32("r1salt"));

        assertEq(novelCore.getNovel(novelId).currentRound, 1);
        uint64[] memory wl1 = novelCore.getWorldLineAncestors(novelId);
        assertTrue(wl1.length > 0);

        // --- Round 2 ---
        vm.warp(block.timestamp + MIN_ROUND_GAP + 1);
        uint64 ch4 = _submitChapter(author1, novelId, wl1[0], "round2 cont from wl author1");
        uint64 ch5 = _submitChapter(author3, novelId, wl1[0], "round2 cont from wl author3");

        _runFullRound(novelId, voters, ch4, bytes32("r2salt"));

        assertEq(novelCore.getNovel(novelId).currentRound, 2);
        uint64[] memory wl2 = novelCore.getWorldLineAncestors(novelId);
        assertTrue(wl2.length > 0);

        // --- Round 3 ---
        vm.warp(block.timestamp + MIN_ROUND_GAP + 1);
        uint64 ch6 = _submitChapter(author2, novelId, wl2[0], "round3 continuation chapter!");

        _runFullRound(novelId, voters, ch6, bytes32("r3salt"));

        assertEq(novelCore.getNovel(novelId).currentRound, 3);

        // Verify rewards accumulated for creator
        uint256 creatorPending = prizePool.getPendingReward(novelId, creator);
        assertTrue(creatorPending > 0, "creator should have accumulated rewards");

        // Claim
        uint256 balBefore = creator.balance;
        vm.prank(creator);
        novelCore.claimReward(novelId);
        assertTrue(creator.balance > balBefore);
    }

    // ----------------------------------------------------------
    //  Fork + independent round lifecycle on forked novel
    // ----------------------------------------------------------
    function test_forkIndependentRound() public {
        // Create original novel
        uint64 originalId = _createNovel();
        uint64 origRoot = 1;
        uint64 ch2 = _submitChapter(author1, originalId, origRoot, "original chapter 2 content");

        // Fork
        address forker = address(0xF0);
        vm.deal(forker, 100 ether);
        DataTypes.NovelConfig memory config = _defaultConfig();

        uint256 forkFee = prizePool.getPoolBalance(originalId) * 100 / 10000;
        if (forkFee < SUBMISSION_FEE) forkFee = SUBMISSION_FEE;
        uint256 totalNeeded = forkFee + SUBMISSION_FEE;

        vm.prank(forker);
        uint64 forkId = novelCore.forkNovel{value: totalNeeded}(
            origRoot,
            config,
            DataTypes.NovelMetadata({title: "Forked Novel", description: "fork", coverUri: ""}),
            _makeContent("fork root content is here!!")
        );

        // Submit chapters to forked novel
        uint64 forkRoot = novelCore.getChapterCount();
        uint64 fch2 = _submitChapter(author1, forkId, forkRoot, "fork chapter 2 by author1!!");
        uint64 fch3 = _submitChapter(author2, forkId, forkRoot, "fork chapter 3 by author2!!");

        // Run a round on the fork
        address[] memory voters = new address[](1);
        voters[0] = voter1;
        _runFullRound(forkId, voters, fch2, bytes32("forksalt"));

        assertEq(novelCore.getNovel(forkId).currentRound, 1);
        assertTrue(novelCore.getRoundData(forkId, 1).settled);
    }

    // ----------------------------------------------------------
    //  BountyBoard: create bounty, authors submit, claim after deadline
    // ----------------------------------------------------------
    function test_bountyBoard_claimAfterDeadline() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        uint64 deadline = uint64(block.timestamp + 7 days);
        uint256 bountyAmount = 1 ether;

        vm.prank(voter1);
        uint256 bountyId = bountyBoard.createBounty{value: bountyAmount}(rootId, deadline);

        DataTypes.Bounty memory b = bountyBoard.getBounty(bountyId);
        assertEq(b.chapterId, rootId);
        assertEq(b.tipper, voter1);
        // 80% locked
        assertEq(b.lockedAmount, bountyAmount * 8000 / 10000);

        // Authors submit continuations before deadline
        uint64 ch2 = _submitChapter(author1, novelId, rootId, "bounty response chapter 1!");
        uint64 ch3 = _submitChapter(author2, novelId, rootId, "bounty response chapter 2!");

        // Warp past deadline
        vm.warp(deadline + 1);

        // Authors claim
        uint256 bal1Before = author1.balance;
        vm.prank(author1);
        bountyBoard.claimBounty(bountyId);

        uint256 bal2Before = author2.balance;
        vm.prank(author2);
        bountyBoard.claimBounty(bountyId);

        assertTrue(author1.balance > bal1Before, "author1 should receive bounty share");
        assertTrue(author2.balance > bal2Before, "author2 should receive bounty share");
    }

    // ----------------------------------------------------------
    //  BountyBoard: create bounty, no submissions, refund
    // ----------------------------------------------------------
    function test_bountyBoard_refund() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        uint64 deadline = uint64(block.timestamp + 7 days);
        uint256 bountyAmount = 1 ether;

        vm.prank(voter1);
        uint256 bountyId = bountyBoard.createBounty{value: bountyAmount}(rootId, deadline);

        // Warp past deadline without any submissions
        vm.warp(deadline + 1);

        uint256 balBefore = voter1.balance;
        vm.prank(voter1);
        bountyBoard.refundBounty(bountyId);

        DataTypes.Bounty memory b = bountyBoard.getBounty(bountyId);
        assertTrue(b.claimed);
        assertTrue(voter1.balance > balBefore, "tipper should be refunded");
    }
}
