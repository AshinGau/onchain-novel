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
/// @dev Simulates multi-Agent collaborative novel creation on-chain
contract IntegrationTest is Test {
    NovelCore public novelCore;
    VotingEngine public votingEngine;
    PrizePool public prizePool;
    ChapterNFT public chapterNFT;

    address public owner = address(0x1001);
    address public creator = address(0x1010);
    address public author1 = address(0x2020);
    address public author2 = address(0x3030);
    address public author3 = address(0x4040);
    address public reader1 = address(0x5050);
    address public reader2 = address(0x6060);

    DataTypes.NovelConfig defaultConfig;
    DataTypes.NovelMetadata defaultMetadata;

    function setUp() public {
        // Deploy implementations
        NovelCore novelCoreImpl = new NovelCore();
        VotingEngine votingEngineImpl = new VotingEngine();
        PrizePool prizePoolImpl = new PrizePool();
        ChapterNFT chapterNFTImpl = new ChapterNFT();

        // Deploy proxies
        bytes memory novelCoreData = abi.encodeCall(NovelCore.initialize, (owner, address(0), address(0), address(0)));
        ERC1967Proxy novelCoreProxy = new ERC1967Proxy(address(novelCoreImpl), novelCoreData);
        novelCore = NovelCore(payable(address(novelCoreProxy)));

        bytes memory votingData = abi.encodeCall(VotingEngine.initialize, (owner, address(novelCoreProxy)));
        ERC1967Proxy votingProxy = new ERC1967Proxy(address(votingEngineImpl), votingData);
        votingEngine = VotingEngine(payable(address(votingProxy)));

        bytes memory prizeData = abi.encodeCall(PrizePool.initialize, (owner, address(novelCoreProxy)));
        ERC1967Proxy prizeProxy = new ERC1967Proxy(address(prizePoolImpl), prizeData);
        prizePool = PrizePool(address(prizeProxy));

        bytes memory nftData = abi.encodeCall(ChapterNFT.initialize, (owner, address(novelCoreProxy)));
        ERC1967Proxy nftProxy = new ERC1967Proxy(address(chapterNFTImpl), nftData);
        chapterNFT = ChapterNFT(address(nftProxy));

        // Wire up NovelCore to modules
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

        // Default config: 1 round per epoch, 2 world lines
        defaultConfig = DataTypes.NovelConfig({
            minChapterLength: 100,
            maxChapterLength: 10000,
            roundMinDuration: 1 days,
            roundMinSubmissions: 3,
            worldLineCount: 2,
            roundsPerEpoch: 1,
            prizeReleaseRate: 3000, // 30%
            voterRewardRate: 1000, // 10%
            commitDuration: 3 days,
            revealDuration: 2 days,
            stakeAmount: 0.01 ether,
            pollutionRounds: 3,
            pollutionThreshold: 20,
            contentLocation: DataTypes.ContentLocation.Onchain,
            contentBaseUrl: ""
        });

        defaultMetadata = DataTypes.NovelMetadata({title: "Test Novel", description: "A test novel", coverUri: ""});
    }

    // ============================================================
    //                    HELPERS
    // ============================================================

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

    bytes constant GENESIS_CONTENT =
        "Genesis chapter content that is long enough to meet the minimum chapter length requirement of one hundred bytes padding";
    bytes constant CHAPTER1_CONTENT =
        "Chapter one content that is sufficiently long to meet the minimum chapter length requirement of one hundred bytes padding";
    bytes constant CHAPTER2_CONTENT =
        "Chapter two content that is sufficiently long to meet the minimum chapter length requirement of one hundred bytes padding";
    bytes constant CHAPTER3_CONTENT =
        "Chapter three content that is sufficiently long to meet the minimum chapter length requirement of hundred bytes padding";

    function _createNovel(uint256 ethValue) internal returns (uint256 novelId) {
        vm.prank(creator);
        novelId =
            novelCore.createNovel{value: ethValue}(defaultConfig, defaultMetadata, _genesisSubmissions(GENESIS_CONTENT));
    }

    // ============================================================
    //              TEST: Novel Creation
    // ============================================================

    function test_CreateNovel() public {
        uint256 novelId = _createNovel(1 ether);

        assertEq(novelId, 1);
        assertEq(novelCore.getNovelCount(), 1);

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.creator, creator);
        assertEq(novel.currentRound, 1);
        assertEq(novel.currentEpoch, 1);
        assertTrue(novel.active);
        assertEq(novel.genesisChapterCount, 1);
        assertEq(novel.cumulativeCanonChapters, 0);
        assertEq(uint8(novel.roundPhase), uint8(DataTypes.RoundPhase.Submitting));

        assertEq(prizePool.getPoolBalance(novelId), 1 ether);

        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);
        assertEq(worldLines.length, 1);
    }

    function test_CreateNovelWithoutPrizePool() public {
        uint256 novelId = _createNovel(0);
        assertEq(novelId, 1);
        assertEq(prizePool.getPoolBalance(novelId), 0);
    }

    function test_CreateNovelMultiGenesis() public {
        vm.prank(creator);
        uint256 novelId =
            novelCore.createNovel{value: 2 ether}(defaultConfig, defaultMetadata, _multiGenesisSubmissions());

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.genesisChapterCount, 2);

        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);
        assertEq(worldLines.length, 2);

        // Each genesis chapter exists and is a world line
        for (uint256 i = 0; i < 2; i++) {
            DataTypes.Chapter memory ch = novelCore.getChapter(worldLines[i]);
            assertTrue(ch.isWorldLine);
            assertEq(ch.author, creator);
            assertEq(ch.round, 0);
            assertEq(ch.epoch, 0);
        }
    }

    // ============================================================
    //              TEST: Chapter Submission
    // ============================================================

    function test_SubmitChapter() public {
        uint256 novelId = _createNovel(1 ether);
        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);
        uint256 genesisId = worldLines[0];

        vm.prank(author1);
        uint256 chapterId =
            novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER1_CONTENT));

        assertEq(chapterId, 2);

        DataTypes.Chapter memory ch = novelCore.getChapter(chapterId);
        assertEq(ch.author, author1);
        assertEq(ch.parentId, genesisId);
        assertFalse(ch.isWorldLine);
        assertFalse(ch.isCanon);
    }

    function test_SubmitChapter_RevertWrongStake() public {
        uint256 novelId = _createNovel(0);
        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);

        vm.prank(author1);
        vm.expectRevert();
        novelCore.submitChapter{value: 0.005 ether}(novelId, worldLines[0], _makeSubmission(CHAPTER1_CONTENT));
    }

    function test_SubmitChapter_RevertContentTooShort() public {
        uint256 novelId = _createNovel(0);
        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);

        vm.prank(author1);
        vm.expectRevert();
        novelCore.submitChapter{value: 0.01 ether}(novelId, worldLines[0], _makeSubmission(bytes("too short")));
    }

    // ============================================================
    //              TEST: Reader Tipping
    // ============================================================

    function test_TipNovel() public {
        uint256 novelId = _createNovel(1 ether);

        vm.prank(reader1);
        prizePool.tipNovel{value: 0.5 ether}(novelId);

        assertEq(prizePool.getPoolBalance(novelId), 1.5 ether);
        assertEq(prizePool.getTotalTipped(novelId), 0.5 ether);
    }

    function test_TipNovel_RevertTooSmall() public {
        uint256 novelId = _createNovel(0);

        vm.prank(reader1);
        vm.expectRevert();
        prizePool.tipNovel{value: 0.0001 ether}(novelId);
    }

    // ============================================================
    //              TEST: Full Round Lifecycle
    // ============================================================

    function test_FullRoundLifecycle() public {
        uint256 novelId = _createNovel(1 ether);
        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);
        uint256 genesisId = worldLines[0];

        // Submit 3 chapters
        vm.prank(author1);
        uint256 ch1 = novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER1_CONTENT));
        vm.prank(author2);
        uint256 ch2 = novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER2_CONTENT));
        vm.prank(author3);
        novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER3_CONTENT));

        vm.warp(block.timestamp + 1 days + 1);
        novelCore.closeSubmissions(novelId);

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(uint8(novel.roundPhase), uint8(DataTypes.RoundPhase.Committing));

        // Voting
        uint256 votingRoundId = uint256(keccak256(abi.encodePacked(novelId, uint32(1), uint32(1), false)));

        bytes32 salt1 = bytes32("salt1");
        vm.prank(reader1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, votingRoundId, keccak256(abi.encodePacked(ch1, salt1)));

        bytes32 salt2 = bytes32("salt2");
        vm.prank(reader2);
        votingEngine.commitVote{value: 0.05 ether}(novelId, votingRoundId, keccak256(abi.encodePacked(ch2, salt2)));

        vm.warp(block.timestamp + 3 days + 1);
        novelCore.closeCommit(novelId);

        vm.prank(reader1);
        votingEngine.revealVote(novelId, votingRoundId, ch1, salt1);
        vm.prank(reader2);
        votingEngine.revealVote(novelId, votingRoundId, ch2, salt2);

        vm.warp(block.timestamp + 2 days + 1);
        novelCore.settleRound(novelId);

        novel = novelCore.getNovel(novelId);
        assertEq(uint8(novel.epochPhase), uint8(DataTypes.EpochPhase.Committing));

        worldLines = novelCore.getActiveWorldLines(novelId);
        assertEq(worldLines.length, 2);
        assertEq(worldLines[0], ch1);
        assertEq(worldLines[1], ch2);
    }

    // ============================================================
    //              TEST: Full Epoch Settlement
    // ============================================================

    function test_FullEpochSettlement() public {
        (uint256 novelId, uint256 ch1) = _runFullEpoch();

        // Verify epoch advanced
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.currentEpoch, 2);
        assertEq(novel.currentRound, 1);
        assertEq(novel.cumulativeCanonChapters, 1);
        assertEq(uint8(novel.roundPhase), uint8(DataTypes.RoundPhase.Submitting));
        assertEq(uint8(novel.epochPhase), uint8(DataTypes.EpochPhase.Rounds));

        // Verify canon
        DataTypes.Chapter memory canonChapter = novelCore.getChapter(ch1);
        assertTrue(canonChapter.isCanon);
        assertTrue(chapterNFT.isChapterMinted(novelId, ch1));

        // Verify prize pool: 1 ETH * 30% = 0.3 ETH released
        // Creator royalty: G=1, C=1 (incremented before distribution) → 0.3 * 1/(1+1) = 0.15
        // Remaining: 0.3 - 0.15 = 0.15
        // Author pool (voterRewardRate=1000=10%): 0.15 * 90% = 0.135
        // Voter pool: 0.15 * 10% = 0.015
        uint256 remainingPool = prizePool.getPoolBalance(novelId);
        assertEq(remainingPool, 0.7 ether);

        // Creator gets 50% of epoch release
        uint256 creatorReward = prizePool.getPendingReward(novelId, creator);
        assertEq(creatorReward, 0.15 ether);

        // Author gets 90% of remaining (0.15 * 0.9 = 0.135)
        uint256 authorReward = prizePool.getPendingReward(novelId, author1);
        assertEq(authorReward, 0.135 ether);

        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);
        assertEq(worldLines.length, 1);
        assertEq(worldLines[0], ch1);
    }

    // ============================================================
    //      TEST: Creator Royalty Decay Across Epochs
    // ============================================================

    function test_CreatorRoyaltyDecay() public {
        // Use config with voterRewardRate=0 to simplify calculations
        DataTypes.NovelConfig memory config = defaultConfig;
        config.voterRewardRate = 0;

        vm.prank(creator);
        uint256 novelId =
            novelCore.createNovel{value: 10 ether}(config, defaultMetadata, _genesisSubmissions(GENESIS_CONTENT));

        // Run epoch 1: G=1, C=1 (incremented before distribution) → creatorRoyalty = 50%
        _runEpochForNovel(novelId);

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.cumulativeCanonChapters, 1);
        // Epoch 1 release: 10 * 30% = 3 ETH, creator gets 1/(1+1) = 50% = 1.5 ETH
        assertEq(prizePool.getPendingReward(novelId, creator), 1.5 ether);

        // Run epoch 2: G=1, C=2 → creatorRoyalty = 1/3
        _runEpochForNovel(novelId);
        novel = novelCore.getNovel(novelId);
        assertEq(novel.cumulativeCanonChapters, 2);
        // Epoch 2 release: 7 * 30% = 2.1 ETH, creator gets 1/(1+2) = 33.3% = 0.7 ETH
        // Total creator pending: 1.5 + 0.7 = 2.2 ETH
        assertEq(prizePool.getPendingReward(novelId, creator), 2.2 ether);
    }

    // ============================================================
    //              TEST: Fork Novel
    // ============================================================

    function test_ForkNovel() public {
        uint256 novelId = _createNovel(0);
        uint256 genesisId = novelCore.getActiveWorldLines(novelId)[0];

        vm.prank(author1);
        novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER1_CONTENT));
        vm.prank(author2);
        uint256 ch2 = novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER2_CONTENT));
        vm.prank(author3);
        novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER3_CONTENT));

        // Fork fee = stakeAmount (0.01 ETH) goes to original pool, rest to fork pool
        uint256 originalPoolBefore = prizePool.getPoolBalance(novelId);
        vm.prank(author2);
        uint256 forkedNovelId = novelCore.forkNovel{value: 0.5 ether}(novelId, ch2, defaultConfig, defaultMetadata);

        assertEq(forkedNovelId, 2);
        DataTypes.Novel memory forked = novelCore.getNovel(forkedNovelId);
        assertEq(forked.creator, creator); // Creator royalty goes to original creator, not fork caller
        assertEq(forked.forkSourceNovelId, novelId);
        assertEq(forked.forkSourceChapterId, ch2);
        assertEq(forked.genesisChapterCount, 1);
        assertTrue(forked.active);
        // Fork pool = 0.5 - 0.01 (fork fee) = 0.49 ETH
        assertEq(prizePool.getPoolBalance(forkedNovelId), 0.49 ether);
        // Original pool received fork fee
        assertEq(prizePool.getPoolBalance(novelId), originalPoolBefore + 0.01 ether);
    }

    // ============================================================
    //  TEST: Stake Refund
    // ============================================================

    function test_ClaimStakeRefund() public {
        uint256 novelId = _createNovel(1 ether);
        uint256 genesisId = novelCore.getActiveWorldLines(novelId)[0];

        uint256 balBefore = author1.balance;

        vm.prank(author1);
        uint256 ch1 = novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER1_CONTENT));
        vm.prank(author2);
        novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER2_CONTENT));
        vm.prank(author3);
        novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER3_CONTENT));

        vm.warp(2 days);
        novelCore.closeSubmissions(novelId);

        uint256 roundVotingId = uint256(keccak256(abi.encodePacked(novelId, uint32(1), uint32(1), false)));
        bytes32 s1 = bytes32("cs1");
        vm.prank(reader1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, roundVotingId, keccak256(abi.encodePacked(ch1, s1)));

        vm.warp(6 days);
        novelCore.closeCommit(novelId);

        vm.prank(reader1);
        votingEngine.revealVote(novelId, roundVotingId, ch1, s1);

        vm.warp(9 days);
        novelCore.settleRound(novelId);

        vm.prank(author1);
        novelCore.claimStakeRefund(novelId);
        assertEq(author1.balance, balBefore);
    }

    // ============================================================
    //  TEST: Prize Pool Reward Claim
    // ============================================================

    function test_ClaimPrizeReward() public {
        (uint256 novelId,) = _runFullEpoch();

        // Creator gets 50% of epoch release: 0.3 * 1/(1+1) = 0.15 ETH
        uint256 reward = prizePool.getPendingReward(novelId, creator);
        assertEq(reward, 0.15 ether);

        uint256 balBefore = creator.balance;
        vm.prank(creator);
        prizePool.claimReward(novelId);
        assertEq(creator.balance, balBefore + 0.15 ether);
    }

    // ============================================================
    //  TEST: Voting Reward — Both majority and minority get stakes
    // ============================================================

    function test_ClaimVotingReward_BothMajorityAndMinority() public {
        uint256 novelId = _createNovel(1 ether);
        uint256 genesisId = novelCore.getActiveWorldLines(novelId)[0];

        vm.prank(author1);
        uint256 ch1 = novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER1_CONTENT));
        vm.prank(author2);
        uint256 ch2 = novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER2_CONTENT));
        vm.prank(author3);
        novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER3_CONTENT));

        vm.warp(2 days);
        novelCore.closeSubmissions(novelId);

        uint256 votingRoundId = uint256(keccak256(abi.encodePacked(novelId, uint32(1), uint32(1), false)));

        bytes32 s1 = bytes32("vs1");
        vm.prank(reader1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, votingRoundId, keccak256(abi.encodePacked(ch1, s1)));

        bytes32 s2 = bytes32("vs2");
        vm.prank(reader2);
        votingEngine.commitVote{value: 0.05 ether}(novelId, votingRoundId, keccak256(abi.encodePacked(ch2, s2)));

        vm.warp(6 days);
        novelCore.closeCommit(novelId);

        vm.prank(reader1);
        votingEngine.revealVote(novelId, votingRoundId, ch1, s1);
        vm.prank(reader2);
        votingEngine.revealVote(novelId, votingRoundId, ch2, s2);

        vm.warp(9 days);
        novelCore.settleRound(novelId);

        // Both revealed voters should get stake back (no sweep yet, no accuracy rewards yet)
        uint256 bal1Before = reader1.balance;
        uint256 bal2Before = reader2.balance;

        vm.prank(reader1);
        votingEngine.claimVotingReward(novelId, votingRoundId);
        vm.prank(reader2);
        votingEngine.claimVotingReward(novelId, votingRoundId);

        assertEq(reader1.balance, bal1Before + 0.1 ether);
        assertEq(reader2.balance, bal2Before + 0.05 ether);
    }

    // ============================================================
    //  TEST: Sweep Unrevealed Stakes
    // ============================================================

    function test_SweepUnrevealedStakes() public {
        uint256 novelId = _createNovel(1 ether);
        uint256 genesisId = novelCore.getActiveWorldLines(novelId)[0];

        vm.prank(author1);
        uint256 ch1 = novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER1_CONTENT));
        vm.prank(author2);
        uint256 ch2 = novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER2_CONTENT));
        vm.prank(author3);
        novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER3_CONTENT));

        vm.warp(2 days);
        novelCore.closeSubmissions(novelId);

        uint256 votingRoundId = uint256(keccak256(abi.encodePacked(novelId, uint32(1), uint32(1), false)));

        // reader1 commits and reveals, reader2 only commits (doesn't reveal)
        bytes32 s1 = bytes32("sw1");
        vm.prank(reader1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, votingRoundId, keccak256(abi.encodePacked(ch1, s1)));

        bytes32 s2 = bytes32("sw2");
        vm.prank(reader2);
        votingEngine.commitVote{value: 0.05 ether}(novelId, votingRoundId, keccak256(abi.encodePacked(ch2, s2)));

        vm.warp(6 days);
        novelCore.closeCommit(novelId);

        // Only reader1 reveals
        vm.prank(reader1);
        votingEngine.revealVote(novelId, votingRoundId, ch1, s1);

        vm.warp(9 days);
        novelCore.settleRound(novelId);

        // Sweep unrevealed stakes
        votingEngine.sweepUnrevealedStakes(novelId, votingRoundId);

        // reader1 claims: stake (0.1) + unrevealed share (0.05) = 0.15
        uint256 bal1Before = reader1.balance;
        vm.prank(reader1);
        votingEngine.claimVotingReward(novelId, votingRoundId);
        assertEq(reader1.balance, bal1Before + 0.15 ether);

        // reader2 cannot claim (didn't reveal)
        vm.prank(reader2);
        vm.expectRevert();
        votingEngine.claimVotingReward(novelId, votingRoundId);
    }

    // ============================================================
    //  TEST: Keeper Rewards
    // ============================================================

    function test_KeeperRewards() public {
        // Set keeper reward
        vm.prank(owner);
        novelCore.setKeeperRewardAmount(0.001 ether);

        uint256 novelId = _createNovel(1 ether);
        uint256 genesisId = novelCore.getActiveWorldLines(novelId)[0];

        vm.prank(author1);
        novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER1_CONTENT));
        vm.prank(author2);
        novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER2_CONTENT));
        vm.prank(author3);
        novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER3_CONTENT));

        vm.warp(2 days);

        // author1 acts as keeper for closeSubmissions
        address keeper = address(0x99);
        vm.deal(keeper, 1 ether);
        vm.prank(keeper);
        novelCore.closeSubmissions(novelId);

        // Keeper should have reward pending in prize pool
        uint256 keeperReward = prizePool.getPendingReward(novelId, keeper);
        assertEq(keeperReward, 0.001 ether);

        // Pool balance decreased
        assertEq(prizePool.getPoolBalance(novelId), 0.999 ether);
    }

    // ============================================================
    //  TEST: VotingEngine phase guards
    // ============================================================

    function test_CommitAfterTally_Reverts() public {
        uint256 novelId = _createNovel(1 ether);
        uint256 genesisId = novelCore.getActiveWorldLines(novelId)[0];

        vm.prank(author1);
        uint256 ch1 = novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER1_CONTENT));
        vm.prank(author2);
        novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER2_CONTENT));
        vm.prank(author3);
        novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER3_CONTENT));

        vm.warp(2 days);
        novelCore.closeSubmissions(novelId);

        uint256 votingRoundId = uint256(keccak256(abi.encodePacked(novelId, uint32(1), uint32(1), false)));

        bytes32 s1 = bytes32("pg1");
        vm.prank(reader1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, votingRoundId, keccak256(abi.encodePacked(ch1, s1)));

        vm.warp(6 days);
        novelCore.closeCommit(novelId);

        vm.prank(reader1);
        votingEngine.revealVote(novelId, votingRoundId, ch1, s1);

        vm.warp(9 days);
        novelCore.settleRound(novelId);

        vm.prank(reader2);
        vm.expectRevert();
        votingEngine.commitVote{value: 0.1 ether}(
            novelId, votingRoundId, keccak256(abi.encodePacked(ch1, bytes32("late")))
        );
    }

    // ============================================================
    //  TEST: voterRewardRate validation
    // ============================================================

    function test_VoterRewardRate_TooHigh_Reverts() public {
        DataTypes.NovelConfig memory badConfig = defaultConfig;
        badConfig.voterRewardRate = 3000; // Over 20% limit

        vm.prank(creator);
        vm.expectRevert();
        novelCore.createNovel(badConfig, defaultMetadata, _genesisSubmissions(GENESIS_CONTENT));
    }

    // ============================================================
    //  TEST: Early Epoch Trigger
    // ============================================================

    function test_TriggerEarlyEpoch() public {
        // Use config with 3 rounds per epoch
        DataTypes.NovelConfig memory config = defaultConfig;
        config.roundsPerEpoch = 3;

        vm.prank(creator);
        uint256 novelId =
            novelCore.createNovel{value: 1 ether}(config, defaultMetadata, _genesisSubmissions(GENESIS_CONTENT));

        // Complete round 1
        _doRound(novelId);

        // Novel should be at round 2, Submitting
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.currentRound, 2);
        assertEq(uint8(novel.roundPhase), uint8(DataTypes.RoundPhase.Submitting));

        // Owner triggers early epoch
        vm.prank(owner);
        novelCore.triggerEarlyEpoch(novelId);

        novel = novelCore.getNovel(novelId);
        assertEq(uint8(novel.epochPhase), uint8(DataTypes.EpochPhase.Committing));
    }

    function test_TriggerEarlyEpoch_NonOwner_Reverts() public {
        DataTypes.NovelConfig memory config = defaultConfig;
        config.roundsPerEpoch = 3;

        vm.prank(creator);
        uint256 novelId =
            novelCore.createNovel{value: 1 ether}(config, defaultMetadata, _genesisSubmissions(GENESIS_CONTENT));

        _doRound(novelId);

        vm.prank(author1); // Not owner
        vm.expectRevert();
        novelCore.triggerEarlyEpoch(novelId);
    }

    // ============================================================
    //              HELPER: Do one round (submit→vote→settle)
    // ============================================================

    function _doRound(uint256 novelId) internal {
        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);
        uint256 parentId = worldLines[0];

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        uint32 currentRound = novel.currentRound;

        vm.prank(author1);
        uint256 ch1 = novelCore.submitChapter{value: 0.01 ether}(novelId, parentId, _makeSubmission(CHAPTER1_CONTENT));
        vm.prank(author2);
        novelCore.submitChapter{value: 0.01 ether}(novelId, parentId, _makeSubmission(CHAPTER2_CONTENT));
        vm.prank(author3);
        novelCore.submitChapter{value: 0.01 ether}(novelId, parentId, _makeSubmission(CHAPTER3_CONTENT));

        vm.warp(block.timestamp + 1 days + 1);
        novelCore.closeSubmissions(novelId);

        uint256 votingRoundId = uint256(keccak256(abi.encodePacked(novelId, novel.currentEpoch, currentRound, false)));
        bytes32 s1 = bytes32("rs1");
        vm.prank(reader1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, votingRoundId, keccak256(abi.encodePacked(ch1, s1)));

        vm.warp(block.timestamp + 3 days + 1);
        novelCore.closeCommit(novelId);

        vm.prank(reader1);
        votingEngine.revealVote(novelId, votingRoundId, ch1, s1);

        vm.warp(block.timestamp + 2 days + 1);
        novelCore.settleRound(novelId);
    }

    // ============================================================
    //              HELPER: Run full epoch
    // ============================================================

    function _runFullEpoch() internal returns (uint256 novelId, uint256 canonChapterId) {
        novelId = _createNovel(1 ether);
        canonChapterId = _runEpochForNovel(novelId);
    }

    function _runEpochForNovel(uint256 novelId) internal returns (uint256 canonChapterId) {
        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);
        uint256 genesisId = worldLines[0];
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        uint256 t0 = block.timestamp;

        vm.prank(author1);
        uint256 ch1 = novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER1_CONTENT));
        vm.prank(author2);
        novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER2_CONTENT));
        vm.prank(author3);
        novelCore.submitChapter{value: 0.01 ether}(novelId, genesisId, _makeSubmission(CHAPTER3_CONTENT));

        // Round voting
        vm.warp(t0 + 2 days);
        novelCore.closeSubmissions(novelId);

        uint256 roundVotingId =
            uint256(keccak256(abi.encodePacked(novelId, novel.currentEpoch, novel.currentRound, false)));
        bytes32 s1 = bytes32("s1");
        bytes32 s2 = bytes32("s2");
        vm.prank(reader1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, roundVotingId, keccak256(abi.encodePacked(ch1, s1)));
        vm.prank(reader2);
        votingEngine.commitVote{value: 0.05 ether}(novelId, roundVotingId, keccak256(abi.encodePacked(ch1, s2)));

        vm.warp(t0 + 6 days);
        novelCore.closeCommit(novelId);
        vm.prank(reader1);
        votingEngine.revealVote(novelId, roundVotingId, ch1, s1);
        vm.prank(reader2);
        votingEngine.revealVote(novelId, roundVotingId, ch1, s2);

        vm.warp(t0 + 9 days);
        novelCore.settleRound(novelId);

        // Epoch voting
        novel = novelCore.getNovel(novelId);
        uint256 epochVotingId =
            uint256(keccak256(abi.encodePacked(novelId, novel.currentEpoch, novel.currentRound, true)));

        worldLines = novelCore.getActiveWorldLines(novelId);
        bytes32 es1 = bytes32("es1");
        bytes32 es2 = bytes32("es2");
        vm.prank(reader1);
        votingEngine.commitVote{value: 0.1 ether}(
            novelId, epochVotingId, keccak256(abi.encodePacked(worldLines[0], es1))
        );
        vm.prank(reader2);
        votingEngine.commitVote{value: 0.05 ether}(
            novelId, epochVotingId, keccak256(abi.encodePacked(worldLines[0], es2))
        );

        vm.warp(t0 + 13 days);
        novelCore.closeEpochCommit(novelId);
        vm.prank(reader1);
        votingEngine.revealVote(novelId, epochVotingId, worldLines[0], es1);
        vm.prank(reader2);
        votingEngine.revealVote(novelId, epochVotingId, worldLines[0], es2);

        vm.warp(t0 + 16 days);
        novelCore.settleEpoch(novelId);

        return ch1;
    }
}
