// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {V2TestBase} from "./Integration.t.sol";
import {NovelCore} from "../src/core/NovelCore.sol";
import {DataTypes} from "../src/libraries/DataTypes.sol";

/// @title NovelCoreV2Mock
/// @notice Mock V2 implementation for upgrade testing (adds a new function)
contract NovelCoreV2Mock is NovelCore {
    function version() external pure returns (string memory) {
        return "v2-mock";
    }
}

/// @title UpgradeTest
/// @notice UUPS upgrade tests for V2 protocol
contract UpgradeTest is V2TestBase {
    // ----------------------------------------------------------
    //  Deploy, create novel, submit chapters, upgrade, verify state
    // ----------------------------------------------------------
    function test_upgradeNovelCore_preservesState() public {
        // Create novel and submit chapters
        uint64 novelId = _createNovel();
        uint64 rootId = 1;
        uint64 ch2 = _submitChapter(author1, novelId, rootId, "chapter before upgrade!!!");
        uint64 ch3 = _submitChapter(author2, novelId, rootId, "another chapter pre-upg!!");

        // Record pre-upgrade state
        DataTypes.Novel memory novelBefore = novelCore.getNovel(novelId);
        DataTypes.Chapter memory ch2Before = novelCore.getChapter(ch2);
        uint64[] memory wlBefore = novelCore.getWorldLineAncestors(novelId);

        // Deploy new implementation and upgrade
        vm.startPrank(deployer);
        NovelCoreV2Mock newImpl = new NovelCoreV2Mock();
        novelCore.upgradeToAndCall(address(newImpl), "");
        vm.stopPrank();

        // Verify state is preserved
        DataTypes.Novel memory novelAfter = novelCore.getNovel(novelId);
        assertEq(novelAfter.id, novelBefore.id);
        assertEq(novelAfter.creator, novelBefore.creator);
        assertEq(novelAfter.currentRound, novelBefore.currentRound);
        assertTrue(novelAfter.active);

        DataTypes.Chapter memory ch2After = novelCore.getChapter(ch2);
        assertEq(ch2After.id, ch2Before.id);
        assertEq(ch2After.author, ch2Before.author);
        assertEq(ch2After.depth, ch2Before.depth);

        uint64[] memory wlAfter = novelCore.getWorldLineAncestors(novelId);
        assertEq(wlAfter.length, wlBefore.length);

        // Verify new function works
        assertEq(NovelCoreV2Mock(payable(address(novelCore))).version(), "v2-mock");
    }

    // ----------------------------------------------------------
    //  Full round works after upgrade
    // ----------------------------------------------------------
    function test_fullRoundAfterUpgrade() public {
        // Create novel
        uint64 novelId = _createNovel();
        uint64 rootId = 1;
        uint64 ch2 = _submitChapter(author1, novelId, rootId, "chapter before upgrade v2!");

        // Upgrade
        vm.startPrank(deployer);
        NovelCoreV2Mock newImpl = new NovelCoreV2Mock();
        novelCore.upgradeToAndCall(address(newImpl), "");
        vm.stopPrank();

        // Submit more chapters after upgrade
        uint64 ch3 = _submitChapter(author2, novelId, rootId, "chapter after the upgrade!");

        // Run a full round
        address[] memory voters = new address[](1);
        voters[0] = voter1;
        _runFullRound(novelId, voters, ch2, bytes32("upgrade"));

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.currentRound, 1);
        assertTrue(novelCore.getRoundData(novelId, 1).settled);
    }

    // ----------------------------------------------------------
    //  Only owner can upgrade
    // ----------------------------------------------------------
    function test_onlyOwnerCanUpgrade() public {
        NovelCoreV2Mock newImpl = new NovelCoreV2Mock();

        vm.prank(author1);
        vm.expectRevert();
        novelCore.upgradeToAndCall(address(newImpl), "");
    }
}
