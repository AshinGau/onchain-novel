// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {NovelCore} from "../src/core/NovelCore.sol";
import {VotingEngine} from "../src/core/VotingEngine.sol";
import {PrizePool} from "../src/core/PrizePool.sol";
import {ChapterNFT} from "../src/core/ChapterNFT.sol";
import {DataTypes} from "../src/libraries/DataTypes.sol";

/// @title Integration Test
/// @notice Tests the full lifecycle: create novel → submit chapters → round voting → epoch settlement
contract IntegrationTest is Test {
    NovelCore public novelCore;
    VotingEngine public votingEngine;
    PrizePool public prizePool;
    ChapterNFT public chapterNFT;

    address public owner = address(0x1);
    address public creator = address(0x10);
    address public author1 = address(0x20);
    address public author2 = address(0x30);
    address public author3 = address(0x40);
    address public reader1 = address(0x50);
    address public reader2 = address(0x60);

    DataTypes.NovelConfig defaultConfig;

    function setUp() public {
        // Deploy implementations
        NovelCore novelCoreImpl = new NovelCore();
        VotingEngine votingEngineImpl = new VotingEngine();
        PrizePool prizePoolImpl = new PrizePool();
        ChapterNFT chapterNFTImpl = new ChapterNFT();

        // Deploy proxies with placeholder addresses (will set real ones after)
        bytes memory novelCoreData = abi.encodeCall(
            NovelCore.initialize,
            (owner, address(0), address(0), address(0))
        );
        ERC1967Proxy novelCoreProxy = new ERC1967Proxy(address(novelCoreImpl), novelCoreData);
        novelCore = NovelCore(address(novelCoreProxy));

        bytes memory votingData = abi.encodeCall(
            VotingEngine.initialize,
            (owner, address(novelCoreProxy))
        );
        ERC1967Proxy votingProxy = new ERC1967Proxy(address(votingEngineImpl), votingData);
        votingEngine = VotingEngine(address(votingProxy));

        bytes memory prizeData = abi.encodeCall(
            PrizePool.initialize,
            (owner, address(novelCoreProxy))
        );
        ERC1967Proxy prizeProxy = new ERC1967Proxy(address(prizePoolImpl), prizeData);
        prizePool = PrizePool(address(prizeProxy));

        bytes memory nftData = abi.encodeCall(
            ChapterNFT.initialize,
            (owner, address(novelCoreProxy))
        );
        ERC1967Proxy nftProxy = new ERC1967Proxy(address(chapterNFTImpl), nftData);
        chapterNFT = ChapterNFT(address(nftProxy));

        // Wire up NovelCore to point to real module addresses
        vm.startPrank(owner);
        novelCore.setVotingEngine(address(votingEngine));
        novelCore.setPrizePool(address(prizePool));
        novelCore.setChapterNFT(address(chapterNFT));
        vm.stopPrank();

        // Fund test accounts
        vm.deal(creator, 100 ether);
        vm.deal(author1, 100 ether);
        vm.deal(author2, 100 ether);
        vm.deal(author3, 100 ether);
        vm.deal(reader1, 100 ether);
        vm.deal(reader2, 100 ether);

        // Default config: 1 round per epoch, 2 world lines, simple params
        defaultConfig = DataTypes.NovelConfig({
            minChapterLength: 100,
            maxChapterLength: 10000,
            roundMinDuration: 1 days,
            roundMinSubmissions: 3,
            worldLineCount: 2,
            roundsPerEpoch: 1, // 1 round = 1 epoch for quick testing
            prizeReleaseRate: 3000, // 30%
            commitDuration: 3 days,
            revealDuration: 2 days,
            stakeAmount: 0.01 ether,
            votingStrategy: DataTypes.VotingStrategy.StakeToVote,
            pollutionRounds: 3,
            pollutionThreshold: 20
        });
    }

    // ============================================================
    //              TEST: Novel Creation
    // ============================================================

    function test_CreateNovel() public {
        vm.prank(creator);
        uint256 novelId = novelCore.createNovel{value: 1 ether}(
            defaultConfig,
            bytes32("genesis_hash")
        );

        assertEq(novelId, 1);
        assertEq(novelCore.getNovelCount(), 1);

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.creator, creator);
        assertEq(novel.currentRound, 1);
        assertEq(novel.currentEpoch, 1);
        assertTrue(novel.active);
        assertEq(uint8(novel.roundPhase), uint8(DataTypes.RoundPhase.Submitting));

        // Prize pool should have the 1 ETH
        assertEq(prizePool.getPoolBalance(novelId), 1 ether);

        // Should have 1 active world line (genesis)
        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);
        assertEq(worldLines.length, 1);
    }

    function test_CreateNovelWithoutPrizePool() public {
        vm.prank(creator);
        uint256 novelId = novelCore.createNovel(defaultConfig, bytes32("genesis_hash"));

        assertEq(novelId, 1);
        assertEq(prizePool.getPoolBalance(novelId), 0);
    }

    // ============================================================
    //              TEST: Chapter Submission
    // ============================================================

    function test_SubmitChapter() public {
        // Create novel
        vm.prank(creator);
        uint256 novelId = novelCore.createNovel{value: 1 ether}(defaultConfig, bytes32("genesis_hash"));

        // Get the genesis world line
        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);
        uint256 genesisId = worldLines[0];

        // Author1 submits a chapter
        vm.prank(author1);
        uint256 chapterId = novelCore.submitChapter{value: 0.01 ether}(
            novelId, genesisId, bytes32("chapter1_hash"), 500
        );

        assertEq(chapterId, 2); // Genesis is 1, this is 2

        DataTypes.Chapter memory ch = novelCore.getChapter(chapterId);
        assertEq(ch.author, author1);
        assertEq(ch.parentId, genesisId);
        assertEq(ch.contentHash, bytes32("chapter1_hash"));
        assertFalse(ch.isWorldLine);
        assertFalse(ch.isCanon);
    }

    function test_SubmitChapter_RevertWrongStake() public {
        vm.prank(creator);
        uint256 novelId = novelCore.createNovel(defaultConfig, bytes32("genesis_hash"));
        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);

        vm.prank(author1);
        vm.expectRevert();
        novelCore.submitChapter{value: 0.005 ether}(
            novelId, worldLines[0], bytes32("ch_hash"), 500
        );
    }

    function test_SubmitChapter_RevertContentTooShort() public {
        vm.prank(creator);
        uint256 novelId = novelCore.createNovel(defaultConfig, bytes32("genesis_hash"));
        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);

        vm.prank(author1);
        vm.expectRevert();
        novelCore.submitChapter{value: 0.01 ether}(
            novelId, worldLines[0], bytes32("ch_hash"), 50 // Below minChapterLength of 100
        );
    }

    // ============================================================
    //              TEST: Reader Tipping
    // ============================================================

    function test_TipNovel() public {
        vm.prank(creator);
        uint256 novelId = novelCore.createNovel{value: 1 ether}(defaultConfig, bytes32("genesis_hash"));

        vm.prank(reader1);
        prizePool.tipNovel{value: 0.5 ether}(novelId);

        assertEq(prizePool.getPoolBalance(novelId), 1.5 ether);
        assertEq(prizePool.getTotalTipped(novelId), 0.5 ether);
    }

    function test_TipNovel_RevertTooSmall() public {
        vm.prank(creator);
        uint256 novelId = novelCore.createNovel(defaultConfig, bytes32("genesis_hash"));

        vm.prank(reader1);
        vm.expectRevert();
        prizePool.tipNovel{value: 0.0001 ether}(novelId); // Below minimum
    }

    // ============================================================
    //              TEST: Full Round Lifecycle
    // ============================================================

    function test_FullRoundLifecycle() public {
        // 1. Create novel with prize pool
        vm.prank(creator);
        uint256 novelId = novelCore.createNovel{value: 1 ether}(defaultConfig, bytes32("genesis_hash"));
        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);
        uint256 genesisId = worldLines[0];

        // 2. Submit 3 chapters (meets roundMinSubmissions)
        vm.prank(author1);
        uint256 ch1 = novelCore.submitChapter{value: 0.01 ether}(
            novelId, genesisId, bytes32("ch1"), 500
        );

        vm.prank(author2);
        uint256 ch2 = novelCore.submitChapter{value: 0.01 ether}(
            novelId, genesisId, bytes32("ch2"), 600
        );

        vm.prank(author3);
        uint256 ch3 = novelCore.submitChapter{value: 0.01 ether}(
            novelId, genesisId, bytes32("ch3"), 700
        );

        // 3. Fast forward past roundMinDuration
        vm.warp(block.timestamp + 1 days + 1);

        // 4. Close submissions → enters Committing phase
        novelCore.closeSubmissions(novelId);

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(uint8(novel.roundPhase), uint8(DataTypes.RoundPhase.Committing));

        // 5. Voting: commit phase
        // Compute voting round ID (same logic as contract)
        uint256 votingRoundId = uint256(keccak256(abi.encodePacked(novelId, uint32(1), uint32(1), false)));

        // Reader1 votes for ch1
        bytes32 salt1 = bytes32("salt1");
        bytes32 commit1 = keccak256(abi.encodePacked(ch1, salt1));
        vm.prank(reader1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, votingRoundId, commit1);

        // Reader2 votes for ch2
        bytes32 salt2 = bytes32("salt2");
        bytes32 commit2 = keccak256(abi.encodePacked(ch2, salt2));
        vm.prank(reader2);
        votingEngine.commitVote{value: 0.05 ether}(novelId, votingRoundId, commit2);

        // 6. Fast forward past commitDuration
        vm.warp(block.timestamp + 3 days + 1);
        novelCore.closeCommit(novelId);

        novel = novelCore.getNovel(novelId);
        assertEq(uint8(novel.roundPhase), uint8(DataTypes.RoundPhase.Revealing));

        // 7. Reveal votes
        vm.prank(reader1);
        votingEngine.revealVote(novelId, votingRoundId, ch1, salt1);

        vm.prank(reader2);
        votingEngine.revealVote(novelId, votingRoundId, ch2, salt2);

        // 8. Fast forward past revealDuration
        vm.warp(block.timestamp + 2 days + 1);

        // 9. Settle round — since roundsPerEpoch=1, this triggers Epoch voting
        novelCore.settleRound(novelId);

        novel = novelCore.getNovel(novelId);
        // Should be in Epoch Committing phase now
        assertEq(uint8(novel.epochPhase), uint8(DataTypes.EpochPhase.Committing));

        // World lines should contain top 2 (ch1 with more votes, ch2)
        worldLines = novelCore.getActiveWorldLines(novelId);
        assertEq(worldLines.length, 2);
        assertEq(worldLines[0], ch1); // ch1 got more vote weight (0.1 ETH vs 0.05 ETH)
        assertEq(worldLines[1], ch2);
    }

    // ============================================================
    //              TEST: Full Epoch Settlement
    // ============================================================

    function test_FullEpochSettlement() public {
        // Setup: Run full round lifecycle
        vm.prank(creator);
        uint256 novelId = novelCore.createNovel{value: 1 ether}(defaultConfig, bytes32("genesis_hash"));
        uint256 genesisId = novelCore.getActiveWorldLines(novelId)[0];

        // Submit chapters
        vm.prank(author1);
        uint256 ch1 = novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, bytes32("ch1"), 500);
        vm.prank(author2);
        novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, bytes32("ch2"), 600);
        vm.prank(author3);
        novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, bytes32("ch3"), 700);

        // === ROUND VOTING ===
        // T=0 -> T=2d: Close submissions
        vm.warp(2 days);
        novelCore.closeSubmissions(novelId);

        // Commit votes
        uint256 roundVotingId = uint256(keccak256(abi.encodePacked(novelId, uint32(1), uint32(1), false)));
        bytes32 s1 = bytes32("s1");
        bytes32 s2 = bytes32("s2");

        vm.prank(reader1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, roundVotingId, keccak256(abi.encodePacked(ch1, s1)));
        vm.prank(reader2);
        votingEngine.commitVote{value: 0.05 ether}(novelId, roundVotingId, keccak256(abi.encodePacked(ch1, s2)));

        // T=2d -> T=6d: Close commit
        vm.warp(6 days);
        novelCore.closeCommit(novelId);

        // Reveal votes
        vm.prank(reader1);
        votingEngine.revealVote(novelId, roundVotingId, ch1, s1);
        vm.prank(reader2);
        votingEngine.revealVote(novelId, roundVotingId, ch1, s2);

        // T=6d -> T=9d: Settle round → Epoch Committing
        vm.warp(9 days);
        novelCore.settleRound(novelId);

        // === EPOCH VOTING ===
        uint256 epochVotingId = uint256(keccak256(abi.encodePacked(novelId, uint32(1), uint32(1), true)));
        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);

        bytes32 es1 = bytes32("es1");
        bytes32 es2 = bytes32("es2");

        vm.prank(reader1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, epochVotingId, keccak256(abi.encodePacked(worldLines[0], es1)));
        vm.prank(reader2);
        votingEngine.commitVote{value: 0.05 ether}(novelId, epochVotingId, keccak256(abi.encodePacked(worldLines[0], es2)));

        // T=9d -> T=13d: Close epoch commit
        vm.warp(13 days);
        novelCore.closeEpochCommit(novelId);

        // Reveal epoch votes
        vm.prank(reader1);
        votingEngine.revealVote(novelId, epochVotingId, worldLines[0], es1);
        vm.prank(reader2);
        votingEngine.revealVote(novelId, epochVotingId, worldLines[0], es2);

        // T=13d -> T=16d: Settle epoch
        vm.warp(16 days);
        novelCore.settleEpoch(novelId);

        // === VERIFICATIONS ===
        _verifyEpochSettlement(novelId, ch1);
    }

    function _verifyEpochSettlement(uint256 novelId, uint256 ch1) internal view {
        // Verify: epoch advanced
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.currentEpoch, 2);
        assertEq(novel.currentRound, 1);
        assertEq(uint8(novel.roundPhase), uint8(DataTypes.RoundPhase.Submitting));
        assertEq(uint8(novel.epochPhase), uint8(DataTypes.EpochPhase.Rounds));

        // Verify: canon is set
        DataTypes.Chapter memory canonChapter = novelCore.getChapter(ch1);
        assertTrue(canonChapter.isCanon);

        // Verify: NFT minted for canon author
        assertTrue(chapterNFT.isChapterMinted(novelId, ch1));

        // Verify: prize pool decreased (30% released)
        uint256 remainingPool = prizePool.getPoolBalance(novelId);
        assertEq(remainingPool, 0.7 ether);

        // Verify: author1 has pending reward (sole canon author)
        uint256 reward = prizePool.getPendingReward(novelId, author1);
        assertEq(reward, 0.3 ether);

        // Only 1 world line now (the canon)
        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);
        assertEq(worldLines.length, 1);
        assertEq(worldLines[0], ch1);
    }

    // ============================================================
    //              TEST: Fork Novel
    // ============================================================

    function test_ForkNovel() public {
        // Create and run a novel through one round to get rejected branches
        vm.prank(creator);
        uint256 novelId = novelCore.createNovel(defaultConfig, bytes32("genesis_hash"));
        uint256 genesisId = novelCore.getActiveWorldLines(novelId)[0];

        // Submit chapters
        vm.prank(author1);
        novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, bytes32("ch1"), 500);
        vm.prank(author2);
        uint256 ch2 = novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, bytes32("ch2"), 600);
        vm.prank(author3);
        novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, bytes32("ch3"), 700);

        // ch2 is just a submitted chapter, not canon → can fork from it
        vm.prank(author2);
        uint256 forkedNovelId = novelCore.forkNovel{value: 0.5 ether}(novelId, ch2, defaultConfig);

        assertEq(forkedNovelId, 2);

        DataTypes.Novel memory forked = novelCore.getNovel(forkedNovelId);
        assertEq(forked.creator, author2);
        assertEq(forked.forkSourceNovelId, novelId);
        assertEq(forked.forkSourceChapterId, ch2);
        assertTrue(forked.active);

        // Forked novel has its own prize pool
        assertEq(prizePool.getPoolBalance(forkedNovelId), 0.5 ether);

        // Original novel's pool unaffected
        assertEq(prizePool.getPoolBalance(novelId), 0);
    }
}
