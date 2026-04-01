// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {NovelCore} from "../src/core/NovelCore.sol";
import {VotingEngine} from "../src/core/VotingEngine.sol";
import {PrizePool} from "../src/core/PrizePool.sol";
import {ChapterNFT} from "../src/core/ChapterNFT.sol";
import {DataTypes} from "../src/libraries/DataTypes.sol";

/// @title NovelCoreV2 — mock upgrade with a new function
contract NovelCoreV2 is NovelCore {
    function version() external pure returns (string memory) {
        return "v2";
    }
}

/// @title VotingEngineV2 — mock upgrade
contract VotingEngineV2 is VotingEngine {
    function version() external pure returns (string memory) {
        return "v2";
    }
}

/// @title PrizePoolV2 — mock upgrade
contract PrizePoolV2 is PrizePool {
    function version() external pure returns (string memory) {
        return "v2";
    }
}

/// @title ChapterNFTV2 — mock upgrade
contract ChapterNFTV2 is ChapterNFT {
    function version() external pure returns (string memory) {
        return "v2";
    }
}

/// @title UUPS Upgrade Tests
/// @notice Tests upgrade flow for all 4 contracts: V1→V2, storage preservation, access control
contract UpgradeTest is Test {
    NovelCore public novelCore;
    VotingEngine public votingEngine;
    PrizePool public prizePool;
    ChapterNFT public chapterNFT;

    address public owner = makeAddr("owner");
    address public nonOwner = makeAddr("nonOwner");
    address public creatorAddr = makeAddr("creator");
    address public author1 = makeAddr("author1");
    address public author2 = makeAddr("author2");
    address public author3 = makeAddr("author3");
    address public voter1 = makeAddr("voter1");

    function setUp() public {
        NovelCore ncImpl = new NovelCore();
        VotingEngine veImpl = new VotingEngine();
        PrizePool ppImpl = new PrizePool();
        ChapterNFT nftImpl = new ChapterNFT();

        ERC1967Proxy ncProxy = new ERC1967Proxy(
            address(ncImpl), abi.encodeCall(NovelCore.initialize, (owner, address(0), address(0), address(0)))
        );
        novelCore = NovelCore(payable(address(ncProxy)));

        ERC1967Proxy veProxy =
            new ERC1967Proxy(address(veImpl), abi.encodeCall(VotingEngine.initialize, (owner, address(ncProxy))));
        votingEngine = VotingEngine(payable(address(veProxy)));

        ERC1967Proxy ppProxy =
            new ERC1967Proxy(address(ppImpl), abi.encodeCall(PrizePool.initialize, (owner, address(ncProxy))));
        prizePool = PrizePool(address(ppProxy));

        ERC1967Proxy nftProxy =
            new ERC1967Proxy(address(nftImpl), abi.encodeCall(ChapterNFT.initialize, (owner, address(ncProxy))));
        chapterNFT = ChapterNFT(address(nftProxy));

        vm.startPrank(owner);
        novelCore.setVotingEngine(address(votingEngine));
        novelCore.setPrizePool(address(prizePool));
        novelCore.setChapterNFT(address(chapterNFT));
        vm.stopPrank();

        vm.deal(creatorAddr, 100 ether);
        vm.deal(author1, 100 ether);
        vm.deal(author2, 100 ether);
        vm.deal(author3, 100 ether);
        vm.deal(voter1, 100 ether);
    }

    // ============================================================
    //  TEST: NovelCore upgrade preserves storage
    // ============================================================

    function test_UpgradeNovelCore_PreservesState() public {
        // Create a novel before upgrade
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = bytes32("gen");
        uint64[] memory lengths = new uint64[](1);
        lengths[0] = 200;

        DataTypes.NovelConfig memory config = _defaultConfig();
        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel{value: 1 ether}(config, hashes, lengths);

        // Record pre-upgrade state
        DataTypes.Novel memory novelBefore = novelCore.getNovel(novelId);
        uint256 novelCount = novelCore.getNovelCount();
        uint256 chapterCount = novelCore.getChapterCount();
        uint256 poolBalance = prizePool.getPoolBalance(novelId);

        // Upgrade
        NovelCoreV2 v2Impl = new NovelCoreV2();
        vm.prank(owner);
        novelCore.upgradeToAndCall(address(v2Impl), "");

        // Verify V2 function works
        assertEq(NovelCoreV2(payable(address(novelCore))).version(), "v2");

        // Verify storage preserved
        DataTypes.Novel memory novelAfter = novelCore.getNovel(novelId);
        assertEq(novelAfter.id, novelBefore.id);
        assertEq(novelAfter.creator, novelBefore.creator);
        assertEq(novelAfter.genesisChapterCount, novelBefore.genesisChapterCount);
        assertTrue(novelAfter.active);
        assertEq(novelCore.getNovelCount(), novelCount);
        assertEq(novelCore.getChapterCount(), chapterCount);
        assertEq(prizePool.getPoolBalance(novelId), poolBalance);

        // Verify novel still works after upgrade
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);
        vm.prank(author1);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("post_upgrade"), 500);
    }

    // ============================================================
    //  TEST: VotingEngine upgrade
    // ============================================================

    function test_UpgradeVotingEngine() public {
        VotingEngineV2 v2Impl = new VotingEngineV2();
        vm.prank(owner);
        votingEngine.upgradeToAndCall(address(v2Impl), "");
        assertEq(VotingEngineV2(payable(address(votingEngine))).version(), "v2");
    }

    // ============================================================
    //  TEST: PrizePool upgrade
    // ============================================================

    function test_UpgradePrizePool() public {
        PrizePoolV2 v2Impl = new PrizePoolV2();
        vm.prank(owner);
        prizePool.upgradeToAndCall(address(v2Impl), "");
        assertEq(PrizePoolV2(address(prizePool)).version(), "v2");
    }

    // ============================================================
    //  TEST: ChapterNFT upgrade
    // ============================================================

    function test_UpgradeChapterNFT() public {
        ChapterNFTV2 v2Impl = new ChapterNFTV2();
        vm.prank(owner);
        chapterNFT.upgradeToAndCall(address(v2Impl), "");
        assertEq(ChapterNFTV2(address(chapterNFT)).version(), "v2");
    }

    // ============================================================
    //  TEST: Non-owner cannot upgrade
    // ============================================================

    function test_UpgradeNovelCore_NonOwner_Reverts() public {
        NovelCoreV2 v2Impl = new NovelCoreV2();
        vm.prank(nonOwner);
        vm.expectRevert();
        novelCore.upgradeToAndCall(address(v2Impl), "");
    }

    function test_UpgradeVotingEngine_NonOwner_Reverts() public {
        VotingEngineV2 v2Impl = new VotingEngineV2();
        vm.prank(nonOwner);
        vm.expectRevert();
        votingEngine.upgradeToAndCall(address(v2Impl), "");
    }

    function test_UpgradePrizePool_NonOwner_Reverts() public {
        PrizePoolV2 v2Impl = new PrizePoolV2();
        vm.prank(nonOwner);
        vm.expectRevert();
        prizePool.upgradeToAndCall(address(v2Impl), "");
    }

    function test_UpgradeChapterNFT_NonOwner_Reverts() public {
        ChapterNFTV2 v2Impl = new ChapterNFTV2();
        vm.prank(nonOwner);
        vm.expectRevert();
        chapterNFT.upgradeToAndCall(address(v2Impl), "");
    }

    // ============================================================
    //  TEST: Full lifecycle works after upgrade
    // ============================================================

    function test_FullLifecycleAfterUpgrade() public {
        // Upgrade all contracts
        vm.startPrank(owner);
        novelCore.upgradeToAndCall(address(new NovelCoreV2()), "");
        votingEngine.upgradeToAndCall(address(new VotingEngineV2()), "");
        prizePool.upgradeToAndCall(address(new PrizePoolV2()), "");
        chapterNFT.upgradeToAndCall(address(new ChapterNFTV2()), "");
        vm.stopPrank();

        // Run full epoch on upgraded contracts
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = bytes32("gen");
        uint64[] memory lengths = new uint64[](1);
        lengths[0] = 200;

        DataTypes.NovelConfig memory config = _defaultConfig();
        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel{value: 5 ether}(config, hashes, lengths);

        uint256 t0 = block.timestamp;
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);

        vm.prank(author1);
        uint256 ch1 = novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch1"), 500);
        vm.prank(author2);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch2"), 600);
        vm.prank(author3);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch3"), 700);

        vm.warp(t0 + 2 days);
        novelCore.closeSubmissions(novelId);

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        uint256 rvId = uint256(keccak256(abi.encodePacked(novelId, novel.currentEpoch, novel.currentRound, false)));
        bytes32 s = bytes32("s1");
        vm.prank(voter1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, rvId, keccak256(abi.encodePacked(ch1, s)));

        vm.warp(t0 + 6 days);
        novelCore.closeCommit(novelId);
        vm.prank(voter1);
        votingEngine.revealVote(novelId, rvId, ch1, s);

        vm.warp(t0 + 9 days);
        novelCore.settleRound(novelId);

        // Epoch
        novel = novelCore.getNovel(novelId);
        uint256 evId = uint256(keccak256(abi.encodePacked(novelId, novel.currentEpoch, novel.currentRound, true)));
        wl = novelCore.getActiveWorldLines(novelId);

        bytes32 es = bytes32("es1");
        vm.prank(voter1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, evId, keccak256(abi.encodePacked(wl[0], es)));

        vm.warp(t0 + 13 days);
        novelCore.closeEpochCommit(novelId);
        vm.prank(voter1);
        votingEngine.revealVote(novelId, evId, wl[0], es);

        vm.warp(t0 + 16 days);
        novelCore.settleEpoch(novelId);

        // Verify success
        novel = novelCore.getNovel(novelId);
        assertEq(novel.currentEpoch, 2);
        assertTrue(chapterNFT.isChapterMinted(novelId, ch1));
    }

    function _defaultConfig() internal pure returns (DataTypes.NovelConfig memory) {
        return DataTypes.NovelConfig({
            minChapterLength: 100,
            maxChapterLength: 10000,
            roundMinDuration: 1 days,
            roundMinSubmissions: 3,
            worldLineCount: 2,
            roundsPerEpoch: 1,
            prizeReleaseRate: 3000,
            voterRewardRate: 1000,
            commitDuration: 3 days,
            revealDuration: 2 days,
            stakeAmount: 0.01 ether,
            pollutionRounds: 3,
            pollutionThreshold: 20
        });
    }
}
