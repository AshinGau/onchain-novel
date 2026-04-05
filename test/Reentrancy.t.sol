// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {NovelCore} from "../src/core/NovelCore.sol";
import {VotingEngine} from "../src/core/VotingEngine.sol";
import {PrizePool} from "../src/core/PrizePool.sol";
import {ChapterNFT} from "../src/core/ChapterNFT.sol";
import {DataTypes} from "../src/libraries/DataTypes.sol";

/// @title Reentrancy attack contract targeting PrizePool.claimReward
contract ReentrancyAttacker {
    PrizePool public target;
    uint256 public novelId;
    uint256 public attackCount;

    constructor(PrizePool _target) {
        target = _target;
    }

    function setNovelId(uint256 _novelId) external {
        novelId = _novelId;
    }

    function attack() external {
        target.claimReward(novelId);
    }

    receive() external payable {
        if (attackCount < 3) {
            attackCount++;
            try target.claimReward(novelId) {} catch {}
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}

/// @title Reentrancy attack contract targeting VotingEngine.claimVotingReward
contract VotingReentrancyAttacker {
    VotingEngine public target;
    uint256 public novelId;
    uint256 public votingRoundId;
    uint256 public attackCount;

    constructor(VotingEngine _target) {
        target = _target;
    }

    function setup(uint256 _novelId, uint256 _votingRoundId) external {
        novelId = _novelId;
        votingRoundId = _votingRoundId;
    }

    function attack() external {
        target.claimVotingReward(novelId, votingRoundId);
    }

    receive() external payable {
        if (attackCount < 3) {
            attackCount++;
            try target.claimVotingReward(novelId, votingRoundId) {} catch {}
        }
    }
}

/// @title Reentrancy attack contract targeting NovelCore.claimStakeRefund
contract StakeReentrancyAttacker {
    NovelCore public target;
    uint256 public novelId;
    uint256 public attackCount;

    constructor(NovelCore _target) {
        target = _target;
    }

    function setNovelId(uint256 _novelId) external {
        novelId = _novelId;
    }

    function submitChapter(uint256 parentId, DataTypes.ContentSubmission memory submission) external payable {
        target.submitChapter{value: msg.value}(novelId, parentId, submission);
    }

    function attack() external {
        target.claimStakeRefund(novelId);
    }

    receive() external payable {
        if (attackCount < 3) {
            attackCount++;
            try target.claimStakeRefund(novelId) {} catch {}
        }
    }
}

/// @title Reentrancy Tests
/// @notice Tests reentrancy protection on all claim/transfer paths
contract ReentrancyTest is Test {
    NovelCore public novelCore;
    VotingEngine public votingEngine;
    PrizePool public prizePool;
    ChapterNFT public chapterNFT;

    address public owner = makeAddr("owner");
    address public creatorAddr = makeAddr("creator");
    address public author1 = makeAddr("author1");
    address public author2 = makeAddr("author2");
    address public author3 = makeAddr("author3");

    DataTypes.NovelMetadata defaultMetadata;

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

        defaultMetadata = DataTypes.NovelMetadata({title: "Test Novel", description: "A test novel", coverUri: ""});

        vm.deal(creatorAddr, 100 ether);
        vm.deal(author1, 100 ether);
        vm.deal(author2, 100 ether);
        vm.deal(author3, 100 ether);
    }

    /// @notice Test reentrancy on PrizePool.claimReward
    function test_Reentrancy_PrizePool_ClaimReward() public {
        ReentrancyAttacker attacker = new ReentrancyAttacker(prizePool);
        vm.deal(address(attacker), 100 ether);

        // Create novel and run epoch so attacker gets a reward
        uint256 novelId = _createNovelAndRunEpoch(address(attacker));
        attacker.setNovelId(novelId);

        // Verify attacker has pending reward
        uint256 pending = prizePool.getPendingReward(novelId, address(attacker));
        assertTrue(pending > 0);

        uint256 balBefore = address(attacker).balance;

        // Attack: claimReward with reentrant callback
        attacker.attack();

        // Should only receive once (reentrancy guard prevents double-claim)
        uint256 balAfter = address(attacker).balance;
        assertEq(balAfter - balBefore, pending);

        // Pending should be 0
        assertEq(prizePool.getPendingReward(novelId, address(attacker)), 0);
    }

    /// @notice Test reentrancy on VotingEngine.claimVotingReward
    function test_Reentrancy_VotingEngine_ClaimVotingReward() public {
        VotingReentrancyAttacker attacker = new VotingReentrancyAttacker(votingEngine);
        vm.deal(address(attacker), 100 ether);

        // Setup: create novel, submit chapters, run through voting
        uint256 novelId = _createNovelWithSubmissions();
        uint256 t0 = block.timestamp;

        vm.warp(t0 + 2 days);
        novelCore.closeSubmissions(novelId);

        uint256 votingRoundId = uint256(keccak256(abi.encodePacked(novelId, uint32(1), uint32(1), false)));
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);
        // Get a submitted chapter
        uint256[] memory subs = novelCore.getRoundSubmissions(novelId, 1, 1);

        // Attacker commits and reveals
        bytes32 salt = bytes32("attack_salt");
        vm.prank(address(attacker));
        votingEngine.commitVote{value: 1 ether}(novelId, votingRoundId, keccak256(abi.encodePacked(subs[0], salt)));

        vm.warp(t0 + 6 days);
        novelCore.closeCommit(novelId);

        vm.prank(address(attacker));
        votingEngine.revealVote(novelId, votingRoundId, subs[0], salt);

        vm.warp(t0 + 9 days);
        novelCore.settleRound(novelId);

        // Setup attacker
        attacker.setup(novelId, votingRoundId);

        uint256 balBefore = address(attacker).balance;

        // Attack
        attacker.attack();

        // Should get exactly 1 ether back (stake), not more
        uint256 balAfter = address(attacker).balance;
        assertEq(balAfter - balBefore, 1 ether);
    }

    /// @notice Test reentrancy on NovelCore.claimStakeRefund
    function test_Reentrancy_NovelCore_ClaimStakeRefund() public {
        StakeReentrancyAttacker attacker = new StakeReentrancyAttacker(novelCore);
        vm.deal(address(attacker), 100 ether);

        // Create novel
        DataTypes.ContentSubmission[] memory genesisChapters = new DataTypes.ContentSubmission[](1);
        bytes memory genContent = bytes(
            "A]Genesis chapter content for testing that is definitely longer than one hundred bytes in total length for validation"
        );
        genesisChapters[0] = _makeSubmission(genContent);

        DataTypes.NovelConfig memory config = _defaultConfig();

        vm.prank(creatorAddr);
        uint256 novelId = novelCore.createNovel{value: 1 ether}(config, defaultMetadata, genesisChapters);
        attacker.setNovelId(novelId);

        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);

        // Attacker submits chapter
        bytes memory atkContent = bytes(
            "Attacker chapter submission content for reentrancy testing that is definitely longer than one hundred bytes in length"
        );
        attacker.submitChapter{value: config.stakeAmount}(wl[0], _makeSubmission(atkContent));

        // Others submit too
        bytes memory sub1 = bytes(
            "First chapter submission content for reentrancy testing that is definitely longer than one hundred bytes in length!!"
        );
        bytes memory sub2 = bytes(
            "Second chapter submission content for reentrancy testing that is definitely longer than one hundred bytes in length!"
        );
        vm.prank(author1);
        uint256 ch1 = novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(sub1));
        vm.prank(author2);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(sub2));

        // Run round
        uint256 t0 = block.timestamp;
        vm.warp(t0 + 2 days);
        novelCore.closeSubmissions(novelId);

        uint256 rvId = uint256(keccak256(abi.encodePacked(novelId, uint32(1), uint32(1), false)));
        bytes32 s = bytes32("s1");
        vm.prank(author1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, rvId, keccak256(abi.encodePacked(ch1, s)));

        vm.warp(t0 + 6 days);
        novelCore.closeCommit(novelId);
        vm.prank(author1);
        votingEngine.revealVote(novelId, rvId, ch1, s);

        vm.warp(t0 + 9 days);
        novelCore.settleRound(novelId);

        // Attacker tries reentrancy on claimStakeRefund
        uint256 balBefore = address(attacker).balance;
        attacker.attack();

        // Should only receive stake once
        assertEq(address(attacker).balance - balBefore, config.stakeAmount);
    }

    // ============================================================
    //  HELPERS
    // ============================================================

    function _makeSubmission(bytes memory content) internal pure returns (DataTypes.ContentSubmission memory) {
        return DataTypes.ContentSubmission({
            contentHash: keccak256(content),
            declaredLength: uint64(content.length),
            content: content
        });
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
            voterRewardRate: 0,
            commitDuration: 3 days,
            revealDuration: 2 days,
            stakeAmount: 0.01 ether,
            spamRounds: 3,
            spamThreshold: 20,
            contentLocation: DataTypes.ContentLocation.Onchain,
            contentBaseUrl: ""
        });
    }

    function _createNovelWithSubmissions() internal returns (uint256 novelId) {
        DataTypes.ContentSubmission[] memory genesisChapters = new DataTypes.ContentSubmission[](1);
        bytes memory genContent = bytes(
            "A]Genesis chapter content for testing that is definitely longer than one hundred bytes in total length for validation"
        );
        genesisChapters[0] = _makeSubmission(genContent);

        DataTypes.NovelConfig memory config = _defaultConfig();
        vm.prank(creatorAddr);
        novelId = novelCore.createNovel{value: 1 ether}(config, defaultMetadata, genesisChapters);

        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);
        bytes memory sub1 = bytes(
            "First chapter submission content for reentrancy testing that is definitely longer than one hundred bytes in length!!"
        );
        bytes memory sub2 = bytes(
            "Second chapter submission content for reentrancy testing that is definitely longer than one hundred bytes in length!"
        );
        bytes memory sub3 = bytes(
            "Third chapter submission content for reentrancy testing that is definitely longer than one hundred bytes in length!!!"
        );
        vm.prank(author1);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(sub1));
        vm.prank(author2);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(sub2));
        vm.prank(author3);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(sub3));
    }

    function _createNovelAndRunEpoch(address rewardRecipient) internal returns (uint256 novelId) {
        DataTypes.ContentSubmission[] memory genesisChapters = new DataTypes.ContentSubmission[](1);
        bytes memory genContent = bytes(
            "A]Genesis chapter content for testing that is definitely longer than one hundred bytes in total length for validation"
        );
        genesisChapters[0] = _makeSubmission(genContent);

        DataTypes.NovelConfig memory config = _defaultConfig();
        // rewardRecipient creates the novel → they get creator royalty
        vm.prank(rewardRecipient);
        novelId = novelCore.createNovel{value: 10 ether}(config, defaultMetadata, genesisChapters);

        uint256 t0 = block.timestamp;
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);

        bytes memory sub1 = bytes(
            "First chapter submission content for reentrancy testing that is definitely longer than one hundred bytes in length!!"
        );
        bytes memory sub2 = bytes(
            "Second chapter submission content for reentrancy testing that is definitely longer than one hundred bytes in length!"
        );
        bytes memory sub3 = bytes(
            "Third chapter submission content for reentrancy testing that is definitely longer than one hundred bytes in length!!!"
        );
        vm.prank(author1);
        uint256 ch1 = novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(sub1));
        vm.prank(author2);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(sub2));
        vm.prank(author3);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], _makeSubmission(sub3));

        // Round
        vm.warp(t0 + 2 days);
        novelCore.closeSubmissions(novelId);

        uint256 rvId = uint256(keccak256(abi.encodePacked(novelId, uint32(1), uint32(1), false)));
        bytes32 s = bytes32("rs");
        vm.prank(author1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, rvId, keccak256(abi.encodePacked(ch1, s)));

        vm.warp(t0 + 6 days);
        novelCore.closeCommit(novelId);
        vm.prank(author1);
        votingEngine.revealVote(novelId, rvId, ch1, s);

        vm.warp(t0 + 9 days);
        novelCore.settleRound(novelId);

        // Epoch
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        uint256 evId = uint256(keccak256(abi.encodePacked(novelId, novel.currentEpoch, novel.currentRound, true)));
        wl = novelCore.getActiveWorldLines(novelId);

        bytes32 es = bytes32("es");
        vm.prank(author1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, evId, keccak256(abi.encodePacked(wl[0], es)));

        vm.warp(t0 + 13 days);
        novelCore.closeEpochCommit(novelId);
        vm.prank(author1);
        votingEngine.revealVote(novelId, evId, wl[0], es);

        vm.warp(t0 + 16 days);
        novelCore.settleEpoch(novelId);
    }
}
