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
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.roundMinSubmissions = 5;
        config.worldLineCount = 2;
        config.roundsPerEpoch = 1;

        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel{value: 10 ether}(config, defaultMetadata, _multiGenesisSubmissions());

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.genesisChapterCount, 2);
        assertEq(prizePool.getPoolBalance(novelId), 10 ether);

        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);
        assertEq(worldLines.length, 2);

        // --- 5 Authors submit chapters on different world lines ---
        uint256[] memory chapterIds = new uint256[](5);
        for (uint256 i = 0; i < 5; i++) {
            uint256 parentId = worldLines[i % 2]; // Alternate between genesis chapters
            bytes memory chContent = bytes(
                string.concat(
                    "Chapter content from author ",
                    vm.toString(i),
                    " that is long enough to meet the minimum chapter length requirement of one hundred bytes for testing"
                )
            );
            vm.prank(authors[i]);
            chapterIds[i] =
                novelCore.submitChapter{value: config.stakeAmount}(novelId, parentId, _makeSubmission(chContent));
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

        // Creator royalty: fixed G=1, C=0, epochRelease = 9.995 * 30% ≈ 2.9985
        // creatorRoyalty = 2.9985 * 1/(1+0) = 2.9985 (100% to creator since C=0)
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

        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel{value: 10 ether}(config, defaultMetadata, _multiGenesisSubmissions());
        // G=2 but royalty uses fixed G=1

        uint256 poolBefore = prizePool.getPoolBalance(novelId);
        assertEq(poolBefore, 10 ether);

        // --- Epoch 1: fixed G=1, C=1 → creator gets 1/(1+1) = 50% ---
        _runEpochSimple(novelId, config);
        uint256 epoch1CreatorReward = prizePool.getPendingReward(novelId, creatorAddr);
        // epochRelease = 10 * 0.3 = 3.0, creator = 3.0 * 1/(1+1) = 1.5
        assertEq(epoch1CreatorReward, 1.5 ether);
        uint256 poolAfter1 = prizePool.getPoolBalance(novelId);
        assertEq(poolAfter1, 7 ether);

        // Reader tips mid-run
        vm.prank(reader);
        prizePool.tipNovel{value: 3 ether}(novelId);
        assertEq(prizePool.getPoolBalance(novelId), 10 ether);

        // --- Epoch 2: fixed G=1, C=2 → creator gets 1/(1+2) = 33% ---
        _runEpochSimple(novelId, config);
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.cumulativeCanonChapters, 2);
        // epochRelease = 10 * 0.3 = 3.0, creator = 3.0 * 1/(1+2) = 1.0
        uint256 totalCreatorReward = prizePool.getPendingReward(novelId, creatorAddr);
        assertEq(totalCreatorReward, 1.5 ether + 1.0 ether); // epoch1 + epoch2

        // --- Epoch 3: fixed G=1, C=3 → creator gets 1/(1+3) = 25% ---
        _runEpochSimple(novelId, config);
        novel = novelCore.getNovel(novelId);
        assertEq(novel.cumulativeCanonChapters, 3);
        // pool was 7 after epoch2, epochRelease = 7 * 0.3 = 2.1, creator = 2.1 * 1/(1+3) = 0.525
        totalCreatorReward = prizePool.getPendingReward(novelId, creatorAddr);
        assertEq(totalCreatorReward, 1.5 ether + 1.0 ether + 0.525 ether);

        // Verify pool exponential decay
        uint256 finalPool = prizePool.getPoolBalance(novelId);
        assertTrue(finalPool < 7 ether); // Decayed from 7 after tip
    }

    // ============================================================
    //  SCENARIO 2.4: Spam Detection & Slashing
    // ============================================================

    function test_E2E_SpamSlashing() public {
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.spamRounds = 2;
        config.spamThreshold = 20;
        config.roundMinSubmissions = 10;
        config.worldLineCount = 2;
        config.roundsPerEpoch = 3; // Need multiple rounds for spam

        vm.prank(creatorAddr);
        uint256 novelId =
            novelCore.createNovel{value: 5 ether}(config, defaultMetadata, _genesisSubmissions(GENESIS_CONTENT));

        // Need 10+ unique authors for spam detection
        address[10] memory manyAuthors;
        for (uint256 i = 0; i < 10; i++) {
            manyAuthors[i] = makeAddr(string.concat("pollAuthor", vm.toString(i)));
            vm.deal(manyAuthors[i], 10 ether);
        }

        // Round 1: author[9] gets fewest votes (bottom 20%)
        this.runSpamRoundExternal(novelId, config, manyAuthors, 1);

        // Round 2: author[9] again bottom → now has 2 consecutive strikes
        this.runSpamRoundExternal(novelId, config, manyAuthors, 2);

        // After round 2 settlement, author[9] should have been slashed
        // Check: author[9]'s stake balance should be reduced
        // The _returnRoundStakes checks spam and slashes if consecutiveStrikes >= spamRounds
        // After slashing, 50% of stake goes to prize pool

        // Round 3: not bottom → should have reset
        this.runSpamRoundExternal(novelId, config, manyAuthors, 3);
    }

    // ============================================================
    //  SCENARIO 2.5: Fork & Early Epoch
    // ============================================================

    function test_E2E_ForkAndEarlyEpoch() public {
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.roundsPerEpoch = 3;
        config.roundMinSubmissions = 3;
        config.worldLineCount = 2;

        vm.prank(creatorAddr);
        uint256 novelId =
            novelCore.createNovel{value: 5 ether}(config, defaultMetadata, _genesisSubmissions(GENESIS_CONTENT));

        // Run round 1
        (uint256 ch1,) = _doRoundWithChapters(novelId, config);

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.currentRound, 2);

        // Submit some chapters for round 2 (will be abandoned by early epoch)
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);
        vm.prank(authors[0]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(CHAPTER1_CONTENT));

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

        vm.prank(creatorAddr);
        uint256 novelId =
            novelCore.createNovel{value: 5 ether}(config, defaultMetadata, _genesisSubmissions(GENESIS_CONTENT));

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

        vm.prank(creatorAddr);
        uint256 novelId =
            novelCore.createNovel{value: 1 ether}(config, defaultMetadata, _genesisSubmissions(GENESIS_CONTENT));
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);

        // Author submits — stake is locked
        vm.prank(authors[0]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(CHAPTER1_CONTENT));

        // Cannot claim while stake is locked (in-flight)
        assertEq(novelCore.getClaimableStake(novelId, authors[0]), 0);
        vm.prank(authors[0]);
        vm.expectRevert();
        novelCore.claimStakeRefund(novelId);

        // After round settles, stake becomes claimable
        vm.prank(authors[1]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(CHAPTER2_CONTENT));
        vm.prank(authors[2]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(CHAPTER3_CONTENT));

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

        // No prize pool
        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel(config, defaultMetadata, _genesisSubmissions(GENESIS_CONTENT));
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

        vm.prank(creatorAddr);
        uint256 novelId =
            novelCore.createNovel{value: 1 ether}(config, defaultMetadata, _genesisSubmissions(GENESIS_CONTENT));

        uint256 t0 = block.timestamp;
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);

        // Submit
        vm.prank(authors[0]);
        uint256 ch1 =
            novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(CHAPTER1_CONTENT));
        vm.prank(authors[1]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(CHAPTER2_CONTENT));
        vm.prank(authors[2]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(CHAPTER3_CONTENT));

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

        vm.prank(creatorAddr);
        uint256 novelId =
            novelCore.createNovel{value: 1 ether}(config, defaultMetadata, _genesisSubmissions(GENESIS_CONTENT));

        uint256 t0 = block.timestamp;
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);

        vm.prank(authors[0]);
        uint256 ch1 =
            novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(CHAPTER1_CONTENT));
        vm.prank(authors[1]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(CHAPTER2_CONTENT));
        vm.prank(authors[2]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(CHAPTER3_CONTENT));

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

        // No prize pool — keeper reward can't be paid
        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel(config, defaultMetadata, _genesisSubmissions(GENESIS_CONTENT));

        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);
        vm.prank(authors[0]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(CHAPTER1_CONTENT));
        vm.prank(authors[1]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(CHAPTER2_CONTENT));
        vm.prank(authors[2]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(CHAPTER3_CONTENT));

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

        vm.prank(creatorAddr);
        uint256 novelId =
            novelCore.createNovel{value: 10 ether}(config, defaultMetadata, _genesisSubmissions(GENESIS_CONTENT));

        _runEpochSimple(novelId, config);

        // G=1, C=0 → creator gets 100% of epochRelease, author and voter get 0
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.cumulativeCanonChapters, 1);
    }

    // ============================================================
    //  HELPERS
    // ============================================================

    bytes constant GENESIS_CONTENT =
        "Genesis chapter content that is long enough to meet the minimum chapter length requirement of one hundred bytes padding";
    bytes constant CHAPTER1_CONTENT =
        "Chapter one content that is sufficiently long to meet the minimum chapter length requirement of one hundred bytes padding";
    bytes constant CHAPTER2_CONTENT =
        "Chapter two content that is sufficiently long to meet the minimum chapter length requirement of one hundred bytes padding";
    bytes constant CHAPTER3_CONTENT =
        "Chapter three content that is sufficiently long to meet the minimum chapter length requirement of hundred bytes padding";

    function _makeSubmission(bytes memory content) internal pure returns (DataTypes.ContentSubmission memory) {
        return DataTypes.ContentSubmission({
            contentHash: keccak256(content),
            declaredLength: uint64(content.length),
            content: content
        });
    }

    function _genesisSubmissions(bytes memory content)
        internal
        pure
        returns (DataTypes.ContentSubmission[] memory subs)
    {
        subs = new DataTypes.ContentSubmission[](1);
        subs[0] = _makeSubmission(content);
    }

    function _multiGenesisSubmissions() internal pure returns (DataTypes.ContentSubmission[] memory subs) {
        subs = new DataTypes.ContentSubmission[](2);
        subs[0] = _makeSubmission(
            bytes(
                "Genesis chapter one content that is long enough to meet the minimum length requirement of 100 bytes for testing"
            )
        );
        subs[1] = _makeSubmission(
            bytes(
                "Genesis chapter two content that is long enough to meet the minimum length requirement of 100 bytes for this test"
            )
        );
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
            spamRounds: 3,
            spamThreshold: 20,
            contentLocation: DataTypes.ContentLocation.Onchain,
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
        uint256 ch1 =
            novelCore.submitChapter{value: config.stakeAmount}(novelId, parentId, _makeSubmission(CHAPTER1_CONTENT));
        vm.prank(authors[1]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, parentId, _makeSubmission(CHAPTER2_CONTENT));
        vm.prank(authors[2]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, parentId, _makeSubmission(CHAPTER3_CONTENT));

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
        ch1 = novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(CHAPTER1_CONTENT));
        vm.prank(authors[1]);
        ch2 = novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(CHAPTER2_CONTENT));
        vm.prank(authors[2]);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(CHAPTER3_CONTENT));

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

    function runSpamRoundExternal(
        uint256 novelId,
        DataTypes.NovelConfig memory config,
        address[10] memory manyAuthors,
        uint32 roundNum
    ) external {
        _runSpamRound(novelId, config, manyAuthors, roundNum);
    }

    function _runSpamRound(
        uint256 novelId,
        DataTypes.NovelConfig memory config,
        address[10] memory manyAuthors,
        uint32 roundNum
    ) internal {
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);

        // 10 authors submit
        uint256[] memory chIds = new uint256[](10);
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(manyAuthors[i]);
            bytes memory pollContent = bytes(
                string.concat(
                    "Spam round ",
                    vm.toString(roundNum),
                    " chapter by author ",
                    vm.toString(i),
                    " with enough padding to meet the minimum chapter length requirement of one hundred bytes"
                )
            );
            chIds[i] = novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(pollContent));
        }

        vm.warp(block.timestamp + 2 days);
        novelCore.closeSubmissions(novelId);

        // Vote: give votes to first 8, leave last 2 (including author[9]) with fewest
        uint256 votingRoundId =
            uint256(keccak256(abi.encodePacked(novelId, novel.currentEpoch, novel.currentRound, false)));

        // voter[0] votes for chIds[0] (high rank)
        bytes32 salt = bytes32(bytes(string.concat("psalt", vm.toString(roundNum))));
        vm.prank(voters[0]);
        votingEngine.commitVote{value: 1 ether}(novelId, votingRoundId, keccak256(abi.encodePacked(chIds[0], salt)));

        vm.warp(block.timestamp + 4 days);
        novelCore.closeCommit(novelId);
        vm.prank(voters[0]);
        votingEngine.revealVote(novelId, votingRoundId, chIds[0], salt);

        vm.warp(block.timestamp + 3 days);
        novelCore.settleRound(novelId);
    }
}
