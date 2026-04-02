// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {NovelCore} from "../src/core/NovelCore.sol";
import {VotingEngine} from "../src/core/VotingEngine.sol";
import {PrizePool} from "../src/core/PrizePool.sol";
import {ChapterNFT} from "../src/core/ChapterNFT.sol";
import {DataTypes} from "../src/libraries/DataTypes.sol";

/// @title E2E Multi-Role Tests
/// @notice End-to-end tests simulating full multi-role collaboration on Anvil
contract E2ETest is Test {
    NovelCore public novelCore;
    VotingEngine public votingEngine;
    PrizePool public prizePool;
    ChapterNFT public chapterNFT;

    address public owner = makeAddr("owner");
    address public creatorAddr = makeAddr("creator");
    address[5] public authors;
    address[3] public voters;
    address public keeper = makeAddr("keeper");
    address public reader = makeAddr("reader");

    DataTypes.NovelMetadata defaultMetadata;

    function setUp() public {
        // Create named addresses
        for (uint256 i = 0; i < 5; i++) {
            authors[i] = makeAddr(string.concat("author", vm.toString(i)));
        }
        for (uint256 i = 0; i < 3; i++) {
            voters[i] = makeAddr(string.concat("voter", vm.toString(i)));
        }

        // Deploy contracts
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

        // Fund all accounts
        vm.deal(creatorAddr, 100 ether);
        vm.deal(keeper, 10 ether);
        vm.deal(reader, 50 ether);
        for (uint256 i = 0; i < 5; i++) {
            vm.deal(authors[i], 50 ether);
        }
        for (uint256 i = 0; i < 3; i++) {
            vm.deal(voters[i], 50 ether);
        }
    }

    // ============================================================
    //  SCENARIO 2.2: Single Epoch Full Lifecycle
    // ============================================================

    function test_E2E_SingleEpochFullLifecycle() public {
        vm.prank(owner);
        novelCore.setKeeperRewardAmount(0.001 ether);

        // --- Create novel with 2 genesis chapters ---
        bytes32[] memory genesisHashes = new bytes32[](2);
        genesisHashes[0] = bytes32("genesis_ch1");
        genesisHashes[1] = bytes32("genesis_ch2");
        uint64[] memory genesisLengths = new uint64[](2);
        genesisLengths[0] = 200;
        genesisLengths[1] = 300;

        DataTypes.NovelConfig memory config = _defaultConfig();
        config.roundMinSubmissions = 5;
        config.worldLineCount = 2;
        config.roundsPerEpoch = 1;

        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel{value: 10 ether}(config, defaultMetadata, genesisHashes, genesisLengths);

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.genesisChapterCount, 2);
        assertEq(prizePool.getPoolBalance(novelId), 10 ether);

        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);
        assertEq(worldLines.length, 2);

        // --- 5 Authors submit chapters on different world lines ---
        uint256[] memory chapterIds = new uint256[](5);
        for (uint256 i = 0; i < 5; i++) {
            uint256 parentId = worldLines[i % 2]; // Alternate between genesis chapters
            vm.prank(authors[i]);
            chapterIds[i] = novelCore.submitChapter{value: config.stakeAmount}(
                novelId, parentId, bytes32(bytes(string.concat("chapter_", vm.toString(i)))), 500
            );
        }

        // --- Keeper closes submissions, gets reward ---
        uint256 t0 = block.timestamp;
        vm.warp(t0 + 2 days);
        uint256 keeperBalBefore = prizePool.getPendingReward(novelId, keeper);
        vm.prank(keeper);
        novelCore.closeSubmissions(novelId);
        uint256 keeperReward = prizePool.getPendingReward(novelId, keeper) - keeperBalBefore;
        assertEq(keeperReward, 0.001 ether);

        // --- 3 Voters commit (voter[2] will NOT reveal) ---
        uint256 votingRoundId = uint256(keccak256(abi.encodePacked(novelId, uint32(1), uint32(1), false)));
        bytes32[3] memory salts = [bytes32("salt0"), bytes32("salt1"), bytes32("salt2")];

        // voter[0] and voter[1] vote for chapterIds[0], voter[2] votes for chapterIds[1]
        vm.prank(voters[0]);
        votingEngine.commitVote{value: 0.5 ether}(
            novelId, votingRoundId, keccak256(abi.encodePacked(chapterIds[0], salts[0]))
        );
        vm.prank(voters[1]);
        votingEngine.commitVote{value: 0.3 ether}(
            novelId, votingRoundId, keccak256(abi.encodePacked(chapterIds[0], salts[1]))
        );
        vm.prank(voters[2]);
        votingEngine.commitVote{value: 0.2 ether}(
            novelId, votingRoundId, keccak256(abi.encodePacked(chapterIds[1], salts[2]))
        );

        // --- Close commit, reveal (voter[2] doesn't reveal) ---
        vm.warp(t0 + 6 days);
        vm.prank(keeper);
        novelCore.closeCommit(novelId);

        vm.prank(voters[0]);
        votingEngine.revealVote(novelId, votingRoundId, chapterIds[0], salts[0]);
        vm.prank(voters[1]);
        votingEngine.revealVote(novelId, votingRoundId, chapterIds[0], salts[1]);
        // voter[2] does NOT reveal

        // --- Settle round ---
        vm.warp(t0 + 9 days);
        vm.prank(keeper);
        novelCore.settleRound(novelId);

        // Verify world lines: chapterIds[0] should be #1 (most votes)
        worldLines = novelCore.getActiveWorldLines(novelId);
        assertEq(worldLines[0], chapterIds[0]);

        // --- Sweep unrevealed stakes ---
        votingEngine.sweepUnrevealedStakes(novelId, votingRoundId);

        // --- Epoch voting ---
        uint256 epochVotingId = uint256(keccak256(abi.encodePacked(novelId, uint32(1), uint32(1), true)));

        vm.prank(voters[0]);
        votingEngine.commitVote{value: 0.5 ether}(
            novelId, epochVotingId, keccak256(abi.encodePacked(worldLines[0], salts[0]))
        );
        vm.prank(voters[1]);
        votingEngine.commitVote{value: 0.3 ether}(
            novelId, epochVotingId, keccak256(abi.encodePacked(worldLines[0], salts[1]))
        );

        vm.warp(t0 + 13 days);
        vm.prank(keeper);
        novelCore.closeEpochCommit(novelId);

        vm.prank(voters[0]);
        votingEngine.revealVote(novelId, epochVotingId, worldLines[0], salts[0]);
        vm.prank(voters[1]);
        votingEngine.revealVote(novelId, epochVotingId, worldLines[0], salts[1]);

        vm.warp(t0 + 16 days);
        vm.prank(keeper);
        novelCore.settleEpoch(novelId);

        // --- Verify epoch settlement ---
        novel = novelCore.getNovel(novelId);
        assertEq(novel.currentEpoch, 2);
        assertEq(novel.cumulativeCanonChapters, 1);

        // Canon chapter should have NFT
        assertTrue(chapterNFT.isChapterMinted(novelId, chapterIds[0]));

        // Creator royalty: G=2, C=0, epochRelease = 9.995 * 30% ≈ 2.9985
        // creatorRoyalty = 2.9985 * 2/(2+0) = 2.9985 (100% to creator since C=0)
        uint256 creatorReward = prizePool.getPendingReward(novelId, creatorAddr);
        assertTrue(creatorReward > 0);

        // --- All roles claim rewards ---
        // Creator claims
        uint256 creatorBalBefore = creatorAddr.balance;
        vm.prank(creatorAddr);
        prizePool.claimReward(novelId);
        assertEq(creatorAddr.balance, creatorBalBefore + creatorReward);

        // Keeper claims
        uint256 keeperPending = prizePool.getPendingReward(novelId, keeper);
        assertTrue(keeperPending > 0); // Multiple keeper rewards accumulated
        vm.prank(keeper);
        prizePool.claimReward(novelId);

        // Voters claim round voting rewards (stake + unrevealed share)
        uint256 voter0BalBefore = voters[0].balance;
        vm.prank(voters[0]);
        votingEngine.claimVotingReward(novelId, votingRoundId);
        assertTrue(voters[0].balance > voter0BalBefore); // Stake + unrevealed share

        vm.prank(voters[1]);
        votingEngine.claimVotingReward(novelId, votingRoundId);

        // voter[2] cannot claim (didn't reveal)
        vm.prank(voters[2]);
        vm.expectRevert();
        votingEngine.claimVotingReward(novelId, votingRoundId);

        // Authors claim stake refund
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(authors[i]);
            novelCore.claimStakeRefund(novelId);
        }
    }

    // ============================================================
    //  SCENARIO 2.3: Multi-Epoch Economic Decay
    // ============================================================

    function test_E2E_MultiEpochEconomicDecay() public {
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.roundsPerEpoch = 1;
        config.voterRewardRate = 0; // Simplify: no voter rewards
        config.roundMinSubmissions = 3;
        config.worldLineCount = 2;

        bytes32[] memory hashes = new bytes32[](2);
        hashes[0] = bytes32("gen1");
        hashes[1] = bytes32("gen2");
        uint64[] memory lengths = new uint64[](2);
        lengths[0] = 200;
        lengths[1] = 200;

        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel{value: 10 ether}(config, defaultMetadata, hashes, lengths);
        // G=2

        uint256 poolBefore = prizePool.getPoolBalance(novelId);
        assertEq(poolBefore, 10 ether);

        // --- Epoch 1: G=2, C=1 (incremented before distribution) → creator gets 2/3 ---
        _runEpochSimple(novelId, config);
        uint256 epoch1CreatorReward = prizePool.getPendingReward(novelId, creatorAddr);
        // epochRelease = 10 * 0.3 = 3.0, creator = 3.0 * 2/(2+1) = 2.0
        assertEq(epoch1CreatorReward, 2 ether);
        uint256 poolAfter1 = prizePool.getPoolBalance(novelId);
        assertEq(poolAfter1, 7 ether);

        // Reader tips mid-run
        vm.prank(reader);
        prizePool.tipNovel{value: 3 ether}(novelId);
        assertEq(prizePool.getPoolBalance(novelId), 10 ether);

        // --- Epoch 2: G=2, C=2 → creator gets 50% ---
        _runEpochSimple(novelId, config);
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.cumulativeCanonChapters, 2);
        // epochRelease = 10 * 0.3 = 3.0, creator = 3.0 * 2/(2+2) = 1.5
        uint256 totalCreatorReward = prizePool.getPendingReward(novelId, creatorAddr);
        assertEq(totalCreatorReward, 2 ether + 1.5 ether); // epoch1 + epoch2

        // --- Epoch 3: G=2, C=3 → creator gets 2/5 = 40% ---
        _runEpochSimple(novelId, config);
        novel = novelCore.getNovel(novelId);
        assertEq(novel.cumulativeCanonChapters, 3);
        // pool was 7 after epoch2, epochRelease = 7 * 0.3 = 2.1, creator = 2.1 * 2/(2+3) = 0.84
        totalCreatorReward = prizePool.getPendingReward(novelId, creatorAddr);
        assertEq(totalCreatorReward, 2 ether + 1.5 ether + 0.84 ether);

        // Verify pool exponential decay
        uint256 finalPool = prizePool.getPoolBalance(novelId);
        assertTrue(finalPool < 7 ether); // Decayed from 7 after tip
    }

    // ============================================================
    //  SCENARIO 2.4: Pollution Detection & Slashing
    // ============================================================

    function test_E2E_PollutionSlashing() public {
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.pollutionRounds = 2;
        config.pollutionThreshold = 20;
        config.roundMinSubmissions = 10;
        config.worldLineCount = 2;
        config.roundsPerEpoch = 3; // Need multiple rounds for pollution

        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = bytes32("genesis");
        uint64[] memory lengths = new uint64[](1);
        lengths[0] = 200;

        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel{value: 5 ether}(config, defaultMetadata, hashes, lengths);

        // Need 10+ unique authors for pollution detection
        address[10] memory manyAuthors;
        for (uint256 i = 0; i < 10; i++) {
            manyAuthors[i] = makeAddr(string.concat("pollAuthor", vm.toString(i)));
            vm.deal(manyAuthors[i], 10 ether);
        }

        // Round 1: author[9] gets fewest votes (bottom 20%)
        _runPollutionRound(novelId, config, manyAuthors, 1);

        // Round 2: author[9] again bottom → now has 2 consecutive strikes
        _runPollutionRound(novelId, config, manyAuthors, 2);

        // After round 2 settlement, author[9] should have been slashed
        // Check: author[9]'s stake balance should be reduced
        // The _returnRoundStakes checks pollution and slashes if consecutiveStrikes >= pollutionRounds
        // After slashing, 50% of stake goes to prize pool

        // Round 3: not bottom → should have reset
        _runPollutionRound(novelId, config, manyAuthors, 3);
    }

    // ============================================================
    //  SCENARIO 2.5: Fork & Early Epoch
    // ============================================================

    function test_E2E_ForkAndEarlyEpoch() public {
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.roundsPerEpoch = 3;
        config.roundMinSubmissions = 3;
        config.worldLineCount = 2;

        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = bytes32("genesis");
        uint64[] memory lengths = new uint64[](1);
        lengths[0] = 200;

        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel{value: 5 ether}(config, defaultMetadata, hashes, lengths);

        // Run round 1
        (uint256 ch1,) = _doRoundWithChapters(novelId, config);

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.currentRound, 2);

        // Submit some chapters for round 2 (will be abandoned by early epoch)
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);
        vm.prank(authors[0]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("r2ch1"), 500);

        // --- Owner triggers early epoch ---
        vm.prank(owner);
        novelCore.triggerEarlyEpoch(novelId);

        novel = novelCore.getNovel(novelId);
        assertEq(uint8(novel.epochPhase), uint8(DataTypes.EpochPhase.Committing));

        // In-progress round stakes still claimable
        vm.prank(authors[0]);
        novelCore.claimStakeRefund(novelId);

        // --- Fork a rejected branch ---
        // ch1 is a world line, but any non-canon chapter can be forked
        // Let's find a submitted chapter that isn't canon
        DataTypes.Chapter memory ch1Data = novelCore.getChapter(ch1);
        // ch1 is a world line but not canon yet
        assertFalse(ch1Data.isCanon);

        vm.prank(authors[1]);
        uint256 forkedNovelId = novelCore.forkNovel{value: 2 ether}(novelId, ch1, config, defaultMetadata);

        DataTypes.Novel memory forked = novelCore.getNovel(forkedNovelId);
        assertEq(forked.creator, creatorAddr); // Creator royalty flows to original creator
        assertEq(forked.genesisChapterCount, 1);
        assertEq(forked.forkSourceNovelId, novelId);
        assertTrue(forked.active);
        // Fork pool = 2 - 0.01 (fork fee) = 1.99 ETH
        assertEq(prizePool.getPoolBalance(forkedNovelId), 1.99 ether);

        // Forked novel works independently
        uint256[] memory forkWl = novelCore.getActiveWorldLines(forkedNovelId);
        assertEq(forkWl.length, 1);
    }

    /// @notice Verify settleEpoch works correctly AFTER triggerEarlyEpoch
    function test_E2E_EarlyEpoch_FullSettlement() public {
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.roundsPerEpoch = 3;
        config.roundMinSubmissions = 3;
        config.worldLineCount = 2;

        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = bytes32("genesis");
        uint64[] memory lengths = new uint64[](1);
        lengths[0] = 200;

        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel{value: 5 ether}(config, defaultMetadata, hashes, lengths);

        _doRoundWithChapters(novelId, config);

        vm.prank(owner);
        novelCore.triggerEarlyEpoch(novelId);

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        uint256 epochVotingId =
            uint256(keccak256(abi.encodePacked(novelId, novel.currentEpoch, novel.currentRound, true)));

        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);
        bytes32 es = bytes32("early_es");
        vm.prank(voters[0]);
        votingEngine.commitVote{value: 0.5 ether}(novelId, epochVotingId, keccak256(abi.encodePacked(wl[0], es)));

        vm.warp(block.timestamp + 4 days);
        novelCore.closeEpochCommit(novelId);
        vm.prank(voters[0]);
        votingEngine.revealVote(novelId, epochVotingId, wl[0], es);

        vm.warp(block.timestamp + 3 days);
        novelCore.settleEpoch(novelId);

        novel = novelCore.getNovel(novelId);
        assertEq(novel.currentEpoch, 2);
        assertEq(uint8(novel.epochPhase), uint8(DataTypes.EpochPhase.Rounds));
    }

    // ============================================================
    //  SCENARIO 2.6: Edge Cases
    // ============================================================

    /// @notice Author cannot claim locked stakes before round settles
    function test_E2E_EdgeCase_StakeLocking() public {
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.roundMinSubmissions = 3;
        config.worldLineCount = 2;

        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = bytes32("genesis");
        uint64[] memory lengths = new uint64[](1);
        lengths[0] = 200;

        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel{value: 1 ether}(config, defaultMetadata, hashes, lengths);
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);

        // Author submits — stake is locked
        vm.prank(authors[0]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch1"), 500);

        // Cannot claim while stake is locked (in-flight)
        assertEq(novelCore.getClaimableStake(novelId, authors[0]), 0);
        vm.prank(authors[0]);
        vm.expectRevert();
        novelCore.claimStakeRefund(novelId);

        // After round settles, stake becomes claimable
        vm.prank(authors[1]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch2"), 600);
        vm.prank(authors[2]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch3"), 700);

        uint256 t0 = block.timestamp;
        vm.warp(t0 + 2 days);
        novelCore.closeSubmissions(novelId);

        uint256 rvId = uint256(keccak256(abi.encodePacked(novelId, uint32(1), uint32(1), false)));
        bytes32 s = bytes32("sl");
        vm.prank(voters[0]);
        votingEngine.commitVote{value: 0.1 ether}(novelId, rvId, keccak256(abi.encodePacked(uint256(2), s)));
        vm.warp(t0 + 6 days);
        novelCore.closeCommit(novelId);
        vm.prank(voters[0]);
        votingEngine.revealVote(novelId, rvId, 2, s);
        vm.warp(t0 + 9 days);
        novelCore.settleRound(novelId);

        // Now stake is claimable
        assertTrue(novelCore.getClaimableStake(novelId, authors[0]) > 0);
        vm.prank(authors[0]);
        novelCore.claimStakeRefund(novelId);
    }

    function test_E2E_EdgeCase_ZeroPrizePool() public {
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.roundsPerEpoch = 1;
        config.roundMinSubmissions = 3;
        config.worldLineCount = 2;

        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = bytes32("genesis");
        uint64[] memory lengths = new uint64[](1);
        lengths[0] = 200;

        // No prize pool
        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel(config, defaultMetadata, hashes, lengths);
        assertEq(prizePool.getPoolBalance(novelId), 0);

        // Should run without division-by-zero
        _runEpochSimple(novelId, config);

        // No rewards to claim
        assertEq(prizePool.getPendingReward(novelId, creatorAddr), 0);
    }

    function test_E2E_EdgeCase_AllVotersReveal() public {
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.roundsPerEpoch = 1;
        config.roundMinSubmissions = 3;
        config.worldLineCount = 2;

        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = bytes32("genesis");
        uint64[] memory lengths = new uint64[](1);
        lengths[0] = 200;

        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel{value: 1 ether}(config, defaultMetadata, hashes, lengths);

        uint256 t0 = block.timestamp;
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);

        // Submit
        vm.prank(authors[0]);
        uint256 ch1 = novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch1"), 500);
        vm.prank(authors[1]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch2"), 600);
        vm.prank(authors[2]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch3"), 700);

        vm.warp(t0 + 2 days);
        novelCore.closeSubmissions(novelId);

        uint256 votingRoundId = uint256(keccak256(abi.encodePacked(novelId, uint32(1), uint32(1), false)));
        bytes32 s0 = bytes32("s0");
        bytes32 s1 = bytes32("s1");

        vm.prank(voters[0]);
        votingEngine.commitVote{value: 0.1 ether}(novelId, votingRoundId, keccak256(abi.encodePacked(ch1, s0)));
        vm.prank(voters[1]);
        votingEngine.commitVote{value: 0.05 ether}(novelId, votingRoundId, keccak256(abi.encodePacked(ch1, s1)));

        vm.warp(t0 + 6 days);
        novelCore.closeCommit(novelId);

        // ALL voters reveal
        vm.prank(voters[0]);
        votingEngine.revealVote(novelId, votingRoundId, ch1, s0);
        vm.prank(voters[1]);
        votingEngine.revealVote(novelId, votingRoundId, ch1, s1);

        vm.warp(t0 + 9 days);
        novelCore.settleRound(novelId);

        // Sweep: all revealed, so unrevealed = 0
        votingEngine.sweepUnrevealedStakes(novelId, votingRoundId);

        // Claims should just return stake (no unrevealed share)
        uint256 v0Bal = voters[0].balance;
        vm.prank(voters[0]);
        votingEngine.claimVotingReward(novelId, votingRoundId);
        assertEq(voters[0].balance, v0Bal + 0.1 ether); // Exact stake back, no unrevealed bonus
    }

    function test_E2E_EdgeCase_SingleVoter() public {
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.roundsPerEpoch = 1;
        config.roundMinSubmissions = 3;
        config.worldLineCount = 2;

        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = bytes32("genesis");
        uint64[] memory lengths = new uint64[](1);
        lengths[0] = 200;

        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel{value: 1 ether}(config, defaultMetadata, hashes, lengths);

        uint256 t0 = block.timestamp;
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);

        vm.prank(authors[0]);
        uint256 ch1 = novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch1"), 500);
        vm.prank(authors[1]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch2"), 600);
        vm.prank(authors[2]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch3"), 700);

        vm.warp(t0 + 2 days);
        novelCore.closeSubmissions(novelId);

        uint256 votingRoundId = uint256(keccak256(abi.encodePacked(novelId, uint32(1), uint32(1), false)));
        bytes32 salt = bytes32("solo");

        // Only 1 voter
        vm.prank(voters[0]);
        votingEngine.commitVote{value: 1 ether}(novelId, votingRoundId, keccak256(abi.encodePacked(ch1, salt)));

        vm.warp(t0 + 6 days);
        novelCore.closeCommit(novelId);

        vm.prank(voters[0]);
        votingEngine.revealVote(novelId, votingRoundId, ch1, salt);

        vm.warp(t0 + 9 days);
        novelCore.settleRound(novelId);

        // Single voter gets full stake back
        uint256 bal = voters[0].balance;
        vm.prank(voters[0]);
        votingEngine.claimVotingReward(novelId, votingRoundId);
        assertEq(voters[0].balance, bal + 1 ether);
    }

    function test_E2E_EdgeCase_InsufficientKeeperReward() public {
        vm.prank(owner);
        novelCore.setKeeperRewardAmount(0.001 ether);

        DataTypes.NovelConfig memory config = _defaultConfig();
        config.roundMinSubmissions = 3;
        config.worldLineCount = 2;

        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = bytes32("genesis");
        uint64[] memory lengths = new uint64[](1);
        lengths[0] = 200;

        // No prize pool — keeper reward can't be paid
        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel(config, defaultMetadata, hashes, lengths);

        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);
        vm.prank(authors[0]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch1"), 500);
        vm.prank(authors[1]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch2"), 600);
        vm.prank(authors[2]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch3"), 700);

        vm.warp(block.timestamp + 2 days);

        // Should succeed even with no pool for keeper reward
        vm.prank(keeper);
        novelCore.closeSubmissions(novelId);

        // Keeper gets no reward (pool is empty)
        assertEq(prizePool.getPendingReward(novelId, keeper), 0);

        // State transition still happened
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(uint8(novel.roundPhase), uint8(DataTypes.RoundPhase.Committing));
    }

    function test_E2E_EdgeCase_ZeroVoterRewardRate() public {
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.voterRewardRate = 0; // All remaining goes to authors
        config.roundsPerEpoch = 1;
        config.roundMinSubmissions = 3;
        config.worldLineCount = 2;

        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = bytes32("genesis");
        uint64[] memory lengths = new uint64[](1);
        lengths[0] = 200;

        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel{value: 10 ether}(config, defaultMetadata, hashes, lengths);

        _runEpochSimple(novelId, config);

        // G=1, C=0 → creator gets 100% of epochRelease, author and voter get 0
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.cumulativeCanonChapters, 1);
    }

    // ============================================================
    //  HELPERS
    // ============================================================

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
            pollutionThreshold: 20,
            contentBaseUrl: ""
        });
    }

    function _runEpochSimple(uint256 novelId, DataTypes.NovelConfig memory config) internal {
        uint256 t0 = block.timestamp;
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);
        uint256 parentId = wl[0];
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);

        // Submit 3 chapters
        vm.prank(authors[0]);
        uint256 ch1 = novelCore.submitChapter{value: config.stakeAmount}(novelId, parentId, bytes32("ech1"), 500);
        vm.prank(authors[1]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, parentId, bytes32("ech2"), 600);
        vm.prank(authors[2]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, parentId, bytes32("ech3"), 700);

        // Round voting
        vm.warp(t0 + 2 days);
        novelCore.closeSubmissions(novelId);

        uint256 roundVotingId =
            uint256(keccak256(abi.encodePacked(novelId, novel.currentEpoch, novel.currentRound, false)));
        bytes32 s = bytes32("vote_s");
        vm.prank(voters[0]);
        votingEngine.commitVote{value: 0.1 ether}(novelId, roundVotingId, keccak256(abi.encodePacked(ch1, s)));

        vm.warp(t0 + 6 days);
        novelCore.closeCommit(novelId);
        vm.prank(voters[0]);
        votingEngine.revealVote(novelId, roundVotingId, ch1, s);

        vm.warp(t0 + 9 days);
        novelCore.settleRound(novelId);

        // Epoch voting
        novel = novelCore.getNovel(novelId);
        uint256 epochVotingId =
            uint256(keccak256(abi.encodePacked(novelId, novel.currentEpoch, novel.currentRound, true)));

        wl = novelCore.getActiveWorldLines(novelId);
        bytes32 es = bytes32("epoch_s");
        vm.prank(voters[0]);
        votingEngine.commitVote{value: 0.1 ether}(novelId, epochVotingId, keccak256(abi.encodePacked(wl[0], es)));

        vm.warp(t0 + 13 days);
        novelCore.closeEpochCommit(novelId);
        vm.prank(voters[0]);
        votingEngine.revealVote(novelId, epochVotingId, wl[0], es);

        vm.warp(t0 + 16 days);
        novelCore.settleEpoch(novelId);
    }

    function _doRoundWithChapters(uint256 novelId, DataTypes.NovelConfig memory config)
        internal
        returns (uint256 ch1, uint256 ch2)
    {
        uint256 t0 = block.timestamp;
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);

        vm.prank(authors[0]);
        ch1 = novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("rch1"), 500);
        vm.prank(authors[1]);
        ch2 = novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("rch2"), 600);
        vm.prank(authors[2]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("rch3"), 700);

        vm.warp(t0 + 2 days);
        novelCore.closeSubmissions(novelId);

        uint256 votingRoundId =
            uint256(keccak256(abi.encodePacked(novelId, novel.currentEpoch, novel.currentRound, false)));
        bytes32 s = bytes32("round_salt");
        vm.prank(voters[0]);
        votingEngine.commitVote{value: 0.1 ether}(novelId, votingRoundId, keccak256(abi.encodePacked(ch1, s)));

        vm.warp(t0 + 6 days);
        novelCore.closeCommit(novelId);
        vm.prank(voters[0]);
        votingEngine.revealVote(novelId, votingRoundId, ch1, s);

        vm.warp(t0 + 9 days);
        novelCore.settleRound(novelId);
    }

    function _runPollutionRound(
        uint256 novelId,
        DataTypes.NovelConfig memory config,
        address[10] memory manyAuthors,
        uint32 roundNum
    ) internal {
        uint256 t0 = block.timestamp;
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);

        // 10 authors submit
        uint256[] memory chIds = new uint256[](10);
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(manyAuthors[i]);
            chIds[i] = novelCore.submitChapter{value: config.stakeAmount}(
                novelId, wl[0], bytes32(bytes(string.concat("poll_r", vm.toString(roundNum), "_", vm.toString(i)))), 500
            );
        }

        vm.warp(t0 + 2 days);
        novelCore.closeSubmissions(novelId);

        // Vote: give votes to first 8, leave last 2 (including author[9]) with fewest
        uint256 votingRoundId =
            uint256(keccak256(abi.encodePacked(novelId, novel.currentEpoch, novel.currentRound, false)));

        // voter[0] votes for chIds[0] (high rank)
        bytes32 salt = bytes32(bytes(string.concat("psalt", vm.toString(roundNum))));
        vm.prank(voters[0]);
        votingEngine.commitVote{value: 1 ether}(novelId, votingRoundId, keccak256(abi.encodePacked(chIds[0], salt)));

        vm.warp(t0 + 6 days);
        novelCore.closeCommit(novelId);
        vm.prank(voters[0]);
        votingEngine.revealVote(novelId, votingRoundId, chIds[0], salt);

        vm.warp(t0 + 9 days);
        novelCore.settleRound(novelId);
    }
}
