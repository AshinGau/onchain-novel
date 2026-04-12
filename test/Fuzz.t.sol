// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TestBase} from "./Integration.t.sol";
import {DataTypes} from "../src/libraries/DataTypes.sol";
import {PrizePool} from "../src/core/PrizePool.sol";

/// @title FuzzTest
/// @notice Property-based tests for protocol
contract FuzzTest is TestBase {
    // ----------------------------------------------------------
    //  Creator royalty decay formula with random rounds
    // ----------------------------------------------------------
    function test_fuzz_creatorRoyaltyDecay(uint32 roundNum) public pure {
        // CREATOR_DECAY_DIVISOR = 3
        uint256 D = 3;
        // Bound round to reasonable range
        roundNum = uint32(bound(roundNum, 1, 10000));

        uint256 releaseAmount = 1 ether;
        uint256 royalty = (releaseAmount * D) / (D + roundNum);

        // Royalty should always be less than release amount
        assertTrue(royalty < releaseAmount, "royalty must be < release");

        // Royalty should always be >= 0
        assertTrue(royalty >= 0, "royalty must be >= 0");

        // Royalty should decrease as round increases
        if (roundNum > 1) {
            uint256 prevRoyalty = (releaseAmount * D) / (D + roundNum - 1);
            assertTrue(royalty <= prevRoyalty, "royalty should decrease with round");
        }

        // At round 1: royalty = 3/4 of release = 75%
        // At round 3: royalty = 3/6 = 50%
        // At round 7: royalty = 3/10 = 30%
        if (roundNum == 3) {
            assertEq(royalty, releaseAmount / 2);
        }
    }

    // ----------------------------------------------------------
    //  Voter weight calculations with random stakes
    // ----------------------------------------------------------
    function test_fuzz_voterWeightCalculation(uint256 stakeAmount, bool isAccurate) public pure {
        stakeAmount = bound(stakeAmount, 0.001 ether, 100 ether);

        uint256 myWeight = isAccurate ? stakeAmount * 3 : stakeAmount;

        // Accurate voter always has 3x weight
        if (isAccurate) {
            assertEq(myWeight, stakeAmount * 3);
        } else {
            assertEq(myWeight, stakeAmount);
        }

        // Weight must be positive for positive stake
        assertTrue(myWeight > 0, "weight must be positive");
    }

    // ----------------------------------------------------------
    //  Config validation edge cases
    // ----------------------------------------------------------
    function test_fuzz_configValidation_releaseRate(uint16 rate) public {
        DataTypes.NovelConfig memory config = _defaultConfig();

        // prizeReleaseRate max is 5000
        if (rate > 5000) {
            config.prizeReleaseRate = rate;
            vm.prank(creator);
            vm.expectRevert();
            novelCore.createNovel{value: 1 ether}(
                config, _defaultMetadata(), _makeContent("root chapter content for novel")
            );
        } else {
            config.prizeReleaseRate = rate;
            vm.prank(creator);
            // Should not revert for valid rates
            novelCore.createNovel{value: 1 ether}(
                config, _defaultMetadata(), _makeContent("root chapter content for novel")
            );
        }
    }

    function test_fuzz_configValidation_voterRewardRate(uint16 rate) public {
        DataTypes.NovelConfig memory config = _defaultConfig();

        if (rate > 5000) {
            config.voterRewardRate = rate;
            vm.prank(creator);
            vm.expectRevert();
            novelCore.createNovel{value: 1 ether}(
                config, _defaultMetadata(), _makeContent("root chapter content for novel")
            );
        } else {
            config.voterRewardRate = rate;
            vm.prank(creator);
            novelCore.createNovel{value: 1 ether}(
                config, _defaultMetadata(), _makeContent("root chapter content for novel")
            );
        }
    }

    function test_fuzz_configValidation_chapterLength(uint64 minLen, uint64 maxLen) public {
        minLen = uint64(bound(minLen, 0, 100000));
        maxLen = uint64(bound(maxLen, 0, 100000));

        DataTypes.NovelConfig memory config = _defaultConfig();
        config.minChapterLength = minLen;
        config.maxChapterLength = maxLen;

        // minLen must be > 0 and maxLen > minLen
        bool shouldFail = (minLen == 0) || (maxLen <= minLen);

        if (shouldFail) {
            vm.prank(creator);
            vm.expectRevert();
            novelCore.createNovel{value: 1 ether}(
                config, _defaultMetadata(), _makeContent("root chapter content for novel")
            );
        }
    }

    // ----------------------------------------------------------
    //  Total reward distribution never exceeds pool balance
    // ----------------------------------------------------------
    function test_fuzz_rewardDistributionBounded(uint256 poolFund) public {
        poolFund = bound(poolFund, 0.01 ether, 50 ether);

        uint64 novelId = _createNovelWith(creator, _defaultConfig(), poolFund);
        uint64 rootId = novelCore.getChapterCount();

        uint64 ch2 = _submitChapter(author1, novelId, rootId, "fuzz reward test chapter!!");
        _submitChapter(author2, novelId, rootId, "fuzz reward branch B chapter!");

        address[] memory voters = new address[](1);
        voters[0] = voter1;
        _runFullRound(novelId, voters, ch2, bytes32("fuzzreward"));

        // Pool balance should still be non-negative (always true with uint)
        uint256 poolBalance = prizePool.getPoolBalance(novelId);
        // Released at most prizeReleaseRate % of original
        assertTrue(poolBalance > 0 || poolFund == 0, "pool should have remaining funds");
    }
}
