// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {NovelCore} from "../src/core/NovelCore.sol";
import {VotingEngine} from "../src/core/VotingEngine.sol";
import {PrizePool} from "../src/core/PrizePool.sol";
import {ChapterNFT} from "../src/core/ChapterNFT.sol";
import {DataTypes} from "../src/libraries/DataTypes.sol";

/// @title Gas Profiling Tests
/// @notice Run with `forge test --mt test_Gas -vv --gas-report` to see per-function gas costs
contract GasProfileTest is Test {
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
    address public voter2 = makeAddr("voter2");

    DataTypes.NovelConfig config;
    DataTypes.NovelMetadata defaultMetadata;
    uint256 novelId;

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
        vm.deal(voter2, 100 ether);

        defaultMetadata = DataTypes.NovelMetadata({title: "Test Novel", description: "A test novel", coverUri: ""});

        config = DataTypes.NovelConfig({
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

    function test_Gas_CreateNovel_SingleGenesis() public {
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = bytes32("gen");
        uint64[] memory lengths = new uint64[](1);
        lengths[0] = 200;

        vm.prank(creatorAddr);
        novelCore.createNovel{value: 1 ether}(config, defaultMetadata, hashes, lengths);
    }

    function test_Gas_CreateNovel_MultiGenesis() public {
        bytes32[] memory hashes = new bytes32[](2);
        uint64[] memory lengths = new uint64[](2);
        for (uint256 i = 0; i < 2; i++) {
            hashes[i] = bytes32(bytes(string.concat("g", vm.toString(i))));
            lengths[i] = 200;
        }

        vm.prank(creatorAddr);
        novelCore.createNovel{value: 1 ether}(config, defaultMetadata, hashes, lengths);
    }

    function test_Gas_SubmitChapter() public {
        _createNovel();
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);

        vm.prank(author1);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch1"), 500);
    }

    function test_Gas_CloseSubmissions() public {
        _createNovelAndSubmit3();
        vm.warp(block.timestamp + 2 days);
        novelCore.closeSubmissions(novelId);
    }

    function test_Gas_CommitVote() public {
        _createNovelAndStartVoting();
        uint256 votingRoundId = _roundVotingId();
        uint256[] memory subs = novelCore.getRoundSubmissions(novelId, 1);

        vm.prank(voter1);
        votingEngine.commitVote{value: 0.1 ether}(
            novelId, votingRoundId, keccak256(abi.encodePacked(subs[0], bytes32("s")))
        );
    }

    function test_Gas_RevealVote() public {
        _createNovelAndCommitVotes();
        uint256 votingRoundId = _roundVotingId();
        uint256[] memory subs = novelCore.getRoundSubmissions(novelId, 1);

        vm.warp(block.timestamp + 3 days + 1);
        novelCore.closeCommit(novelId);

        vm.prank(voter1);
        votingEngine.revealVote(novelId, votingRoundId, subs[0], bytes32("s1"));
    }

    function test_Gas_SettleRound() public {
        _createNovelAndRevealVotes();
        vm.warp(block.timestamp + 2 days + 1);
        novelCore.settleRound(novelId);
    }

    function test_Gas_SettleEpoch() public {
        _createNovelAndSettleRound();

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        uint256 evId = uint256(keccak256(abi.encodePacked(novelId, novel.currentEpoch, novel.currentRound, true)));
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);

        bytes32 es = bytes32("es");
        vm.prank(voter1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, evId, keccak256(abi.encodePacked(wl[0], es)));

        vm.warp(block.timestamp + 3 days + 1);
        novelCore.closeEpochCommit(novelId);

        vm.prank(voter1);
        votingEngine.revealVote(novelId, evId, wl[0], es);

        vm.warp(block.timestamp + 2 days + 1);
        novelCore.settleEpoch(novelId);
    }

    function test_Gas_TipNovel() public {
        _createNovel();
        vm.prank(voter1);
        prizePool.tipNovel{value: 0.5 ether}(novelId);
    }

    function test_Gas_ClaimStakeRefund() public {
        _createNovelAndSettleRound();

        vm.prank(author1);
        novelCore.claimStakeRefund(novelId);
    }

    function test_Gas_ClaimReward() public {
        _runFullEpoch();

        vm.prank(creatorAddr);
        prizePool.claimReward(novelId);
    }

    function test_Gas_SweepUnrevealedStakes() public {
        _createNovelAndSettleRound();
        uint256 votingRoundId = _roundVotingId();
        votingEngine.sweepUnrevealedStakes(novelId, votingRoundId);
    }

    // ============================================================
    //  SETUP HELPERS
    // ============================================================

    function _createNovel() internal {
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = bytes32("gen");
        uint64[] memory lengths = new uint64[](1);
        lengths[0] = 200;
        vm.prank(creatorAddr);
        novelId = novelCore.createNovel{value: 5 ether}(config, defaultMetadata, hashes, lengths);
    }

    function _createNovelAndSubmit3() internal {
        _createNovel();
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);
        vm.prank(author1);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch1"), 500);
        vm.prank(author2);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch2"), 600);
        vm.prank(author3);
        novelCore.submitChapter{value: config.stakeAmount}(novelId, wl[0], bytes32("ch3"), 700);
    }

    function _createNovelAndStartVoting() internal {
        _createNovelAndSubmit3();
        vm.warp(block.timestamp + 2 days);
        novelCore.closeSubmissions(novelId);
    }

    function _createNovelAndCommitVotes() internal {
        _createNovelAndStartVoting();
        uint256 votingRoundId = _roundVotingId();
        uint256[] memory subs = novelCore.getRoundSubmissions(novelId, 1);

        vm.prank(voter1);
        votingEngine.commitVote{value: 0.1 ether}(
            novelId, votingRoundId, keccak256(abi.encodePacked(subs[0], bytes32("s1")))
        );
        vm.prank(voter2);
        votingEngine.commitVote{value: 0.05 ether}(
            novelId, votingRoundId, keccak256(abi.encodePacked(subs[0], bytes32("s2")))
        );
    }

    function _createNovelAndRevealVotes() internal {
        _createNovelAndCommitVotes();
        uint256 votingRoundId = _roundVotingId();
        uint256[] memory subs = novelCore.getRoundSubmissions(novelId, 1);

        vm.warp(block.timestamp + 3 days + 1);
        novelCore.closeCommit(novelId);

        vm.prank(voter1);
        votingEngine.revealVote(novelId, votingRoundId, subs[0], bytes32("s1"));
        vm.prank(voter2);
        votingEngine.revealVote(novelId, votingRoundId, subs[0], bytes32("s2"));
    }

    function _createNovelAndSettleRound() internal {
        _createNovelAndRevealVotes();
        vm.warp(block.timestamp + 2 days + 1);
        novelCore.settleRound(novelId);
    }

    function _runFullEpoch() internal {
        _createNovelAndSettleRound();

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        uint256 evId = uint256(keccak256(abi.encodePacked(novelId, novel.currentEpoch, novel.currentRound, true)));
        uint256[] memory wl = novelCore.getActiveWorldLines(novelId);

        bytes32 es = bytes32("es");
        vm.prank(voter1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, evId, keccak256(abi.encodePacked(wl[0], es)));

        vm.warp(block.timestamp + 3 days + 1);
        novelCore.closeEpochCommit(novelId);
        vm.prank(voter1);
        votingEngine.revealVote(novelId, evId, wl[0], es);

        vm.warp(block.timestamp + 2 days + 1);
        novelCore.settleEpoch(novelId);
    }

    function _roundVotingId() internal view returns (uint256) {
        return uint256(keccak256(abi.encodePacked(novelId, uint32(1), uint32(1), false)));
    }
}
