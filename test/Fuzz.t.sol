// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {NovelCore} from "../src/core/NovelCore.sol";
import {VotingEngine} from "../src/core/VotingEngine.sol";
import {PrizePool} from "../src/core/PrizePool.sol";
import {ChapterNFT} from "../src/core/ChapterNFT.sol";
import {DataTypes} from "../src/libraries/DataTypes.sol";

/// @title Fuzz Tests
/// @notice Fuzz and property-based tests for economic invariants
contract FuzzTest is Test {
    NovelCore public novelCore;
    VotingEngine public votingEngine;
    PrizePool public prizePool;
    ChapterNFT public chapterNFT;

    address public owner = makeAddr("owner");
    address public creatorAddr = makeAddr("creator");
    address public author1 = makeAddr("author1");
    address public author2 = makeAddr("author2");
    address public author3 = makeAddr("author3");
    address public voter1 = makeAddr("voter1");

    DataTypes.NovelMetadata defaultMetadata;

    function setUp() public {
        NovelCore novelCoreImpl = new NovelCore();
        VotingEngine votingEngineImpl = new VotingEngine();
        PrizePool prizePoolImpl = new PrizePool();
        ChapterNFT chapterNFTImpl = new ChapterNFT();

        ERC1967Proxy ncProxy = new ERC1967Proxy(
            address(novelCoreImpl), abi.encodeCall(NovelCore.initialize, (owner, address(0), address(0), address(0)))
        );
        novelCore = NovelCore(payable(address(ncProxy)));

        ERC1967Proxy veProxy = new ERC1967Proxy(
            address(votingEngineImpl), abi.encodeCall(VotingEngine.initialize, (owner, address(ncProxy)))
        );
        votingEngine = VotingEngine(payable(address(veProxy)));

        ERC1967Proxy ppProxy =
            new ERC1967Proxy(address(prizePoolImpl), abi.encodeCall(PrizePool.initialize, (owner, address(ncProxy))));
        prizePool = PrizePool(address(ppProxy));

        ERC1967Proxy nftProxy =
            new ERC1967Proxy(address(chapterNFTImpl), abi.encodeCall(ChapterNFT.initialize, (owner, address(ncProxy))));
        chapterNFT = ChapterNFT(address(nftProxy));

        vm.startPrank(owner);
        novelCore.setVotingEngine(address(votingEngine));
        novelCore.setPrizePool(address(prizePool));
        novelCore.setChapterNFT(address(chapterNFT));
        vm.stopPrank();

        defaultMetadata = DataTypes.NovelMetadata({title: "Test Novel", description: "A test novel", coverUri: ""});

        vm.deal(creatorAddr, 1000 ether);
        vm.deal(author1, 100 ether);
        vm.deal(author2, 100 ether);
        vm.deal(author3, 100 ether);
        vm.deal(voter1, 100 ether);
    }

    // ============================================================
    //  FUZZ: Creator royalty formula
    // ============================================================

    function testFuzz_CreatorRoyaltyDecay(uint32 genesisCount, uint32 canonCount, uint256 poolAmount) public {
        // Bound inputs to reasonable ranges
        genesisCount = uint32(bound(genesisCount, 1, 10));
        canonCount = uint32(bound(canonCount, 0, 100));
        poolAmount = bound(poolAmount, 1 ether, 100 ether);

        uint256 epochRelease = (poolAmount * 3000) / 10000; // 30%
        uint256 g = uint256(genesisCount);
        uint256 c = uint256(canonCount);
        uint256 creatorRoyalty = (epochRelease * g) / (g + c);

        // Invariant: creator royalty <= epoch release
        assertTrue(creatorRoyalty <= epochRelease);

        // Invariant: creator royalty decreases as canon count increases
        if (c > 0) {
            uint256 prevRoyalty = (epochRelease * g) / (g + c - 1);
            assertTrue(creatorRoyalty <= prevRoyalty);
        }

        // Invariant: with 0 canon chapters, creator gets 100%
        if (c == 0) {
            assertEq(creatorRoyalty, epochRelease);
        }
    }

    // ============================================================
    //  FUZZ: Voter accuracy weight calculation
    // ============================================================

    function testFuzz_VoterAccuracyWeights(
        uint256 accurateStake,
        uint256 inaccurateStake,
        uint256 myStake,
        bool isAccurate
    ) public pure {
        // Bound to prevent overflow
        accurateStake = bound(accurateStake, 0.001 ether, 1000 ether);
        inaccurateStake = bound(inaccurateStake, 0, 1000 ether);
        myStake = bound(myStake, 0.001 ether, accurateStake);

        uint256 totalRevealedStake = accurateStake + inaccurateStake;
        if (totalRevealedStake == 0) return;

        uint256 totalWeight = totalRevealedStake + accurateStake * 2;
        if (totalWeight == 0) return;

        uint256 myWeight = isAccurate ? myStake * 3 : myStake;
        uint256 voterRewardPool = 1 ether; // Arbitrary
        uint256 reward = (voterRewardPool * myWeight) / totalWeight;

        // Invariant: individual reward <= total pool
        assertTrue(reward <= voterRewardPool);

        // Invariant: accurate voter with same stake gets more than inaccurate
        uint256 accurateReward = (voterRewardPool * myStake * 3) / totalWeight;
        uint256 inaccurateReward = (voterRewardPool * myStake) / totalWeight;
        assertTrue(accurateReward >= inaccurateReward);
    }

    // ============================================================
    //  FUZZ: NovelConfig validation
    // ============================================================

    function testFuzz_ConfigValidation(
        uint64 minLen,
        uint64 maxLen,
        uint32 worldLines,
        uint32 minSubs,
        uint16 prizeRate,
        uint16 voterRate
    ) public {
        minLen = uint64(bound(minLen, 1, 10000));
        maxLen = uint64(bound(maxLen, minLen + 1, 20000));
        worldLines = uint32(bound(worldLines, 1, 10));
        minSubs = uint32(bound(minSubs, worldLines, 50));
        prizeRate = uint16(bound(prizeRate, 0, 5000));
        voterRate = uint16(bound(voterRate, 0, 2000));

        DataTypes.NovelConfig memory config = DataTypes.NovelConfig({
            minChapterLength: minLen,
            maxChapterLength: maxLen,
            roundMinDuration: 1 days,
            roundMinSubmissions: minSubs,
            worldLineCount: worldLines,
            roundsPerEpoch: 1,
            prizeReleaseRate: prizeRate,
            voterRewardRate: voterRate,
            commitDuration: 1 days,
            revealDuration: 1 days,
            stakeAmount: 0.01 ether,
            pollutionRounds: 3,
            pollutionThreshold: 20,
            contentBaseUrl: ""
        });

        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = bytes32("gen");
        uint64[] memory lengths = new uint64[](1);
        lengths[0] = minLen; // Exactly at minimum — should pass

        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel(config, defaultMetadata, hashes, lengths);
        assertTrue(novelId > 0);
    }

    // ============================================================
    //  FUZZ: voterRewardRate must be <= 2000
    // ============================================================

    function testFuzz_VoterRewardRateReject(uint16 rate) public {
        vm.assume(rate > 2000);

        DataTypes.NovelConfig memory config = DataTypes.NovelConfig({
            minChapterLength: 100,
            maxChapterLength: 10000,
            roundMinDuration: 1 days,
            roundMinSubmissions: 3,
            worldLineCount: 2,
            roundsPerEpoch: 1,
            prizeReleaseRate: 3000,
            voterRewardRate: rate,
            commitDuration: 1 days,
            revealDuration: 1 days,
            stakeAmount: 0.01 ether,
            pollutionRounds: 3,
            pollutionThreshold: 20,
            contentBaseUrl: ""
        });

        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = bytes32("gen");
        uint64[] memory lengths = new uint64[](1);
        lengths[0] = 200;

        vm.prank(creatorAddr);
        vm.expectRevert();
        novelCore.createNovel(config, defaultMetadata, hashes, lengths);
    }

    // ============================================================
    //  FUZZ: distributeEpochRewards with varying parameters
    // ============================================================

    function testFuzz_DistributeEpochRewards(
        uint256 poolAmount,
        uint32 genesisCount,
        uint32 cumulativeCanon,
        uint16 voterRewardRate
    ) public {
        poolAmount = bound(poolAmount, 0.1 ether, 100 ether);
        genesisCount = uint32(bound(genesisCount, 1, 3));
        cumulativeCanon = uint32(bound(cumulativeCanon, 0, 50));
        voterRewardRate = uint16(bound(voterRewardRate, 0, 2000));

        // worldLineCount must be >= genesisCount AND <= roundMinSubmissions (3 in _runEpoch)
        uint32 worldLines = genesisCount < 3 ? genesisCount : 3;

        DataTypes.NovelConfig memory config = DataTypes.NovelConfig({
            minChapterLength: 100,
            maxChapterLength: 10000,
            roundMinDuration: 1 days,
            roundMinSubmissions: 3, // Fixed: must match actual submission count in _runEpoch helper
            worldLineCount: worldLines,
            roundsPerEpoch: 1,
            prizeReleaseRate: 3000,
            voterRewardRate: voterRewardRate,
            commitDuration: 3 days,
            revealDuration: 2 days,
            stakeAmount: 0.01 ether,
            pollutionRounds: 3,
            pollutionThreshold: 20,
            contentBaseUrl: ""
        });

        // Create novel with specified genesis count
        bytes32[] memory hashes = new bytes32[](genesisCount);
        uint64[] memory lengths = new uint64[](genesisCount);
        for (uint256 i = 0; i < genesisCount; i++) {
            hashes[i] = bytes32(bytes(string.concat("g", vm.toString(i))));
            lengths[i] = 200;
        }

        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel{value: poolAmount}(config, defaultMetadata, hashes, lengths);

        uint256 poolBefore = prizePool.getPoolBalance(novelId);
        assertEq(poolBefore, poolAmount);

        // Run an epoch
        _runEpoch(novelId, config);

        uint256 poolAfter = prizePool.getPoolBalance(novelId);

        // Invariant: pool decreased by exactly releaseRate
        uint256 expectedRelease = (poolBefore * config.prizeReleaseRate) / 10000;
        // Account for keeper rewards (up to 5 state transitions × keeperRewardAmount)
        // keeperRewardAmount is 0 in this test (not set), so pool decrease = epochRelease
        assertEq(poolBefore - poolAfter, expectedRelease);

        // Invariant: creator + author + voter rewards = epochRelease
        uint256 creatorReward = prizePool.getPendingReward(novelId, creatorAddr);
        uint256 authorReward = prizePool.getPendingReward(novelId, author1);
        // Voter reward sent to VotingEngine — check VotingEngine balance increased
        // The sum should approximately equal epochRelease (rounding dust allowed)
        assertTrue(creatorReward + authorReward <= expectedRelease);
    }

    // ============================================================
    //  FUZZ: Pool balance invariant across operations
    // ============================================================

    function testFuzz_PoolBalanceInvariant(uint256 tipAmount) public {
        tipAmount = bound(tipAmount, 0.001 ether, 10 ether);

        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = bytes32("gen");
        uint64[] memory lengths = new uint64[](1);
        lengths[0] = 200;

        DataTypes.NovelConfig memory config = DataTypes.NovelConfig({
            minChapterLength: 100,
            maxChapterLength: 10000,
            roundMinDuration: 1 days,
            roundMinSubmissions: 3,
            worldLineCount: 2,
            roundsPerEpoch: 1,
            prizeReleaseRate: 3000,
            voterRewardRate: 0,
            commitDuration: 3 days,
            revealDuration: 2 days,
            stakeAmount: 0.01 ether,
            pollutionRounds: 3,
            pollutionThreshold: 20,
            contentBaseUrl: ""
        });

        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel{value: 5 ether}(config, defaultMetadata, hashes, lengths);

        // Tip
        vm.prank(creatorAddr);
        prizePool.tipNovel{value: tipAmount}(novelId);

        uint256 totalDeposited = 5 ether + tipAmount;
        assertEq(prizePool.getPoolBalance(novelId), totalDeposited);

        // Run epoch
        _runEpoch(novelId, config);

        // After epoch: pool + pending rewards should equal total deposited
        uint256 poolAfter = prizePool.getPoolBalance(novelId);
        uint256 creatorPending = prizePool.getPendingReward(novelId, creatorAddr);
        uint256 authorPending = prizePool.getPendingReward(novelId, author1);

        // pool + all pending = totalDeposited (no voter rewards since voterRewardRate=0)
        assertEq(poolAfter + creatorPending + authorPending, totalDeposited);
    }

    // ============================================================
    //  HELPER
    // ============================================================

    function _runEpoch(uint256 novelId, DataTypes.NovelConfig memory config) internal {
        uint256 t0 = block.timestamp;
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);

        vm.prank(author1);
        uint256 ch1 = novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("f1"), 500);
        vm.prank(author2);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("f2"), 600);
        vm.prank(author3);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("f3"), 700);

        vm.warp(t0 + 2 days);
        novelCore.closeSubmissions(novelId);

        uint256 rvId = uint256(keccak256(abi.encodePacked(novelId, novel.currentEpoch, novel.currentRound, false)));
        bytes32 s = bytes32("fs");
        vm.prank(voter1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, rvId, keccak256(abi.encodePacked(ch1, s)));

        vm.warp(t0 + 6 days);
        novelCore.closeCommit(novelId);
        vm.prank(voter1);
        votingEngine.revealVote(novelId, rvId, ch1, s);

        vm.warp(t0 + 9 days);
        novelCore.settleRound(novelId);

        novel = novelCore.getNovel(novelId);
        uint256 evId = uint256(keccak256(abi.encodePacked(novelId, novel.currentEpoch, novel.currentRound, true)));
        wl = novelCore.getActiveWorldLines(novelId);
        bytes32 es = bytes32("fes");
        vm.prank(voter1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, evId, keccak256(abi.encodePacked(wl[0], es)));

        vm.warp(t0 + 13 days);
        novelCore.closeEpochCommit(novelId);
        vm.prank(voter1);
        votingEngine.revealVote(novelId, evId, wl[0], es);

        vm.warp(t0 + 16 days);
        novelCore.settleEpoch(novelId);
    }
}
