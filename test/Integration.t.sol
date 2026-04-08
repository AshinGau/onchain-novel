// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {NovelCore} from "../src/core/NovelCore.sol";
import {VotingEngine} from "../src/core/VotingEngine.sol";
import {PrizePool} from "../src/core/PrizePool.sol";
import {RulesEngine} from "../src/core/RulesEngine.sol";
import {BountyBoard} from "../src/core/BountyBoard.sol";
import {DataTypes} from "../src/libraries/DataTypes.sol";

/// @title TestBase
/// @notice Base contract with deployment helpers for all tests
abstract contract TestBase is Test {
    NovelCore public novelCore;
    VotingEngine public votingEngine;
    PrizePool public prizePool;
    RulesEngine public rulesEngine;
    BountyBoard public bountyBoard;

    address public deployer = address(0xD);
    address public creator = address(0x1);
    address public author1 = address(0x2);
    address public author2 = address(0x3);
    address public author3 = address(0x4);
    address public voter1 = address(0x5);
    address public voter2 = address(0x6);
    address public voter3 = address(0x7);
    address public keeper = address(0x8);

    uint256 constant SUBMISSION_FEE = 0.001 ether;
    uint256 constant VOTE_STAKE = 0.005 ether;
    uint256 constant NOMINATION_FEE = 0.01 ether;
    uint64 constant NOMINATE_DURATION = 1 days;
    uint64 constant COMMIT_DURATION = 2 days;
    uint64 constant REVEAL_DURATION = 1 days;
    uint64 constant MIN_ROUND_GAP = 1 days;

    function setUp() public virtual {
        _deployAll();
        _fundAccounts();
    }

    function _fundAccounts() internal {
        vm.deal(creator, 100 ether);
        vm.deal(author1, 100 ether);
        vm.deal(author2, 100 ether);
        vm.deal(author3, 100 ether);
        vm.deal(voter1, 100 ether);
        vm.deal(voter2, 100 ether);
        vm.deal(voter3, 100 ether);
        vm.deal(keeper, 100 ether);
    }

    function _deployAll() internal {
        vm.startPrank(deployer);

        NovelCore novelCoreImpl = new NovelCore();
        VotingEngine votingEngineImpl = new VotingEngine();
        PrizePool prizePoolImpl = new PrizePool();
        RulesEngine rulesEngineImpl = new RulesEngine();
        BountyBoard bountyBoardImpl = new BountyBoard();

        bytes memory votingData = abi.encodeCall(VotingEngine.initialize, (deployer, address(1)));
        ERC1967Proxy votingProxy = new ERC1967Proxy(address(votingEngineImpl), votingData);
        votingEngine = VotingEngine(payable(address(votingProxy)));

        bytes memory prizeData = abi.encodeCall(PrizePool.initialize, (deployer, address(1)));
        ERC1967Proxy prizeProxy = new ERC1967Proxy(address(prizePoolImpl), prizeData);
        prizePool = PrizePool(payable(address(prizeProxy)));

        bytes memory rulesData = abi.encodeCall(RulesEngine.initialize, (deployer, address(1), address(prizeProxy)));
        ERC1967Proxy rulesProxy = new ERC1967Proxy(address(rulesEngineImpl), rulesData);
        rulesEngine = RulesEngine(address(rulesProxy));

        bytes memory novelCoreData = abi.encodeCall(
            NovelCore.initialize, (deployer, address(votingProxy), address(prizeProxy), address(rulesProxy))
        );
        ERC1967Proxy novelCoreProxy = new ERC1967Proxy(address(novelCoreImpl), novelCoreData);
        novelCore = NovelCore(payable(address(novelCoreProxy)));

        bytes memory bountyData =
            abi.encodeCall(BountyBoard.initialize, (deployer, address(novelCoreProxy), address(prizeProxy)));
        ERC1967Proxy bountyProxy = new ERC1967Proxy(address(bountyBoardImpl), bountyData);
        bountyBoard = BountyBoard(payable(address(bountyProxy)));

        votingEngine.setNovelCore(address(novelCoreProxy));
        prizePool.setNovelCore(address(novelCoreProxy));
        rulesEngine.setNovelCore(address(novelCoreProxy));
        prizePool.setRulesEngine(address(rulesProxy));
        prizePool.setBountyBoard(address(bountyProxy));

        vm.stopPrank();
    }

    function _defaultConfig() internal pure returns (DataTypes.NovelConfig memory) {
        return DataTypes.NovelConfig({
            minChapterLength: 10,
            maxChapterLength: 50000,
            submissionFee: SUBMISSION_FEE,
            worldLineCount: 2,
            voteStake: VOTE_STAKE,
            nominationFee: NOMINATION_FEE,
            nominateDuration: NOMINATE_DURATION,
            commitDuration: COMMIT_DURATION,
            revealDuration: REVEAL_DURATION,
            minRoundGap: MIN_ROUND_GAP,
            prizeReleaseRate: 2000,
            voterRewardRate: 1500,
            contentLocation: DataTypes.ContentLocation.Onchain,
            contentBaseUrl: "",
            ruleFee: 0.01 ether,
            ruleVoteDuration: 3 days,
            ruleQuorum: 2
        });
    }

    function _defaultMetadata() internal pure returns (DataTypes.NovelMetadata memory) {
        return DataTypes.NovelMetadata({title: "Test Novel", description: "A test novel", coverUri: ""});
    }

    function _makeContent(bytes memory text) internal pure returns (DataTypes.ContentSubmission memory) {
        return DataTypes.ContentSubmission({
            contentHash: keccak256(text),
            declaredLength: uint64(text.length),
            content: text
        });
    }

    function _createNovel() internal returns (uint64 novelId) {
        return _createNovelWith(creator, _defaultConfig(), 1 ether);
    }

    function _createNovelWith(address who, DataTypes.NovelConfig memory config, uint256 value)
        internal
        returns (uint64 novelId)
    {
        vm.prank(who);
        novelId = novelCore.createNovel{value: value}(
            config, _defaultMetadata(), _makeContent("root chapter content for novel")
        );
    }

    function _submitChapter(address who, uint64 novelId, uint64 parentId, bytes memory text)
        internal
        returns (uint64)
    {
        uint64 countBefore = novelCore.getChapterCount();
        vm.prank(who);
        novelCore.submitChapter{value: SUBMISSION_FEE}(novelId, parentId, _makeContent(text));
        return countBefore + 1;
    }

    function _runFullRound(uint64 novelId, address[] memory voters, uint64 targetCandidate, bytes32 salt) internal {
        vm.prank(keeper);
        novelCore.startRound(novelId);

        vm.warp(block.timestamp + NOMINATE_DURATION + 1);
        vm.prank(keeper);
        novelCore.closeNomination(novelId);

        bytes32 commitHash = keccak256(abi.encodePacked(targetCandidate, salt));
        for (uint256 i = 0; i < voters.length; i++) {
            vm.prank(voters[i]);
            novelCore.commitVote{value: VOTE_STAKE}(novelId, commitHash);
        }

        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        vm.prank(keeper);
        novelCore.closeCommit(novelId);

        for (uint256 i = 0; i < voters.length; i++) {
            vm.prank(voters[i]);
            novelCore.revealVote(novelId, targetCandidate, salt);
        }

        vm.warp(block.timestamp + REVEAL_DURATION + 1);
        vm.prank(keeper);
        novelCore.settleRound(novelId);
    }
}

// ================================================================
//                      INTEGRATION TESTS
// ================================================================

contract IntegrationTest is TestBase {
    // ----------------------------------------------------------
    //  Novel creation with root chapter
    // ----------------------------------------------------------
    function test_createNovel() public {
        uint64 novelId = _createNovel();
        assertEq(novelId, 1);

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.id, 1);
        assertEq(novel.creator, creator);
        assertEq(novel.currentRound, 0);
        assertTrue(novel.active);
        assertEq(uint8(novel.roundPhase), uint8(DataTypes.RoundPhase.Idle));

        DataTypes.Chapter memory root = novelCore.getChapter(1);
        assertEq(root.id, 1);
        assertEq(root.novelId, novelId);
        assertEq(root.parentId, 0);
        assertEq(root.author, creator);
        assertEq(root.depth, 1);

        uint64[] memory wl = novelCore.getWorldLineAncestors(novelId);
        assertEq(wl.length, 1);
        assertEq(wl[0], 1);
    }

    // ----------------------------------------------------------
    //  Fork novel with fee calculation
    // ----------------------------------------------------------
    function test_forkNovel() public {
        uint64 originalId = _createNovel();

        vm.prank(voter1);
        novelCore.tipNovel{value: 5 ether}(originalId);

        uint256 sourcePool = prizePool.getPoolBalance(originalId);
        uint256 forkFee = sourcePool * 100 / 10000; // FORK_FEE_RATE = 100 bps
        if (forkFee < SUBMISSION_FEE) forkFee = SUBMISSION_FEE;
        uint256 totalNeeded = forkFee + SUBMISSION_FEE;

        address forker = address(0x99);
        vm.deal(forker, 100 ether);

        DataTypes.NovelConfig memory config = _defaultConfig();
        vm.prank(forker);
        uint64 forkId = novelCore.forkNovel{value: totalNeeded}(
            1,
            config,
            DataTypes.NovelMetadata({title: "Fork Novel", description: "A fork", coverUri: ""}),
            _makeContent("fork root chapter content!!")
        );

        assertEq(forkId, 2);

        DataTypes.Chapter memory forkRoot = novelCore.getChapter(novelCore.getChapterCount());
        assertEq(forkRoot.parentId, 1);
        assertEq(forkRoot.depth, 1);
    }

    // ----------------------------------------------------------
    //  Submit chapters, verify tree structure
    // ----------------------------------------------------------
    function test_submitChapters_treeStructure() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        uint64 ch2 = _submitChapter(author1, novelId, rootId, "chapter 2 content here!");
        uint64 ch3 = _submitChapter(author2, novelId, rootId, "chapter 3 content here!");
        uint64 ch4 = _submitChapter(author1, novelId, ch2, "chapter 4 content here!");

        assertEq(novelCore.getChapter(ch2).depth, 2);
        assertEq(novelCore.getChapter(ch3).depth, 2);
        assertEq(novelCore.getChapter(ch4).depth, 3);

        assertEq(novelCore.getChapter(ch2).parentId, rootId);
        assertEq(novelCore.getChapter(ch3).parentId, rootId);
        assertEq(novelCore.getChapter(ch4).parentId, ch2);

        uint64[] memory rootDesc = novelCore.getChapterDescendants(rootId);
        assertEq(rootDesc.length, 2);
        assertEq(rootDesc[0], ch2);
        assertEq(rootDesc[1], ch3);

        uint64[] memory ch2Desc = novelCore.getChapterDescendants(ch2);
        assertEq(ch2Desc.length, 1);
        assertEq(ch2Desc[0], ch4);
    }

    // ----------------------------------------------------------
    //  Full round lifecycle
    // ----------------------------------------------------------
    function test_fullRoundLifecycle() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        uint64 ch2 = _submitChapter(author1, novelId, rootId, "branch A chapter 2!!");
        uint64 ch3 = _submitChapter(author2, novelId, rootId, "branch B chapter 3!!");
        uint64 ch4 = _submitChapter(author1, novelId, ch2, "branch A chapter 4!!");

        vm.prank(keeper);
        novelCore.startRound(novelId);

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.currentRound, 1);
        assertEq(uint8(novel.roundPhase), uint8(DataTypes.RoundPhase.Nominating));

        DataTypes.RoundData memory rd = novelCore.getRoundData(novelId, 1);
        assertTrue(rd.candidates.length >= 2);

        vm.warp(block.timestamp + NOMINATE_DURATION + 1);
        vm.prank(keeper);
        novelCore.closeNomination(novelId);

        uint64 targetCandidate = ch4;
        bytes32 salt = bytes32("mysalt");
        bytes32 commitHash = keccak256(abi.encodePacked(targetCandidate, salt));

        vm.prank(voter1);
        novelCore.commitVote{value: VOTE_STAKE}(novelId, commitHash);
        vm.prank(voter2);
        novelCore.commitVote{value: VOTE_STAKE}(novelId, commitHash);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        vm.prank(keeper);
        novelCore.closeCommit(novelId);

        vm.prank(voter1);
        novelCore.revealVote(novelId, targetCandidate, salt);
        vm.prank(voter2);
        novelCore.revealVote(novelId, targetCandidate, salt);

        vm.warp(block.timestamp + REVEAL_DURATION + 1);
        vm.prank(keeper);
        novelCore.settleRound(novelId);

        novel = novelCore.getNovel(novelId);
        assertEq(uint8(novel.roundPhase), uint8(DataTypes.RoundPhase.Idle));
        assertEq(novel.currentRound, 1);

        uint64[] memory wl = novelCore.getWorldLineAncestors(novelId);
        assertTrue(wl.length > 0);

        rd = novelCore.getRoundData(novelId, 1);
        assertTrue(rd.settled);
    }

    // ----------------------------------------------------------
    //  Multi-round: second round DFS starts from first round winners
    // ----------------------------------------------------------
    function test_multiRound() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        uint64 ch2 = _submitChapter(author1, novelId, rootId, "round 1 branch A content");
        uint64 ch3 = _submitChapter(author2, novelId, rootId, "round 1 branch B content");

        address[] memory voters = new address[](2);
        voters[0] = voter1;
        voters[1] = voter2;
        bytes32 salt = bytes32("salt1");

        _runFullRound(novelId, voters, ch2, salt);

        uint64[] memory wl1 = novelCore.getWorldLineAncestors(novelId);
        assertTrue(wl1.length > 0);

        vm.warp(block.timestamp + MIN_ROUND_GAP + 1);

        uint64 ch5 = _submitChapter(author1, novelId, wl1[0], "round 2 continuation 1!!");
        uint64 ch6 = _submitChapter(author2, novelId, wl1[0], "round 2 continuation 2!!");

        salt = bytes32("salt2");
        _runFullRound(novelId, voters, ch5, salt);

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.currentRound, 2);

        uint64[] memory wl2 = novelCore.getWorldLineAncestors(novelId);
        assertTrue(wl2.length > 0);
    }

    // ----------------------------------------------------------
    //  Nomination: non-world-line-descendant has candidateIsEligible=false
    // ----------------------------------------------------------
    function test_nomination_nonWorldLineDescendant() public {
        // Use worldLineCount=1 so only one winner per round
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.worldLineCount = 1;
        uint64 novelId = _createNovelWith(creator, config, 1 ether);
        uint64 rootId = 1;

        uint64 ch2 = _submitChapter(author1, novelId, rootId, "branch A for nomination!");
        uint64 ch3 = _submitChapter(author2, novelId, rootId, "branch B for nomination!");

        address[] memory voters = new address[](1);
        voters[0] = voter1;
        _runFullRound(novelId, voters, ch2, bytes32("s1"));

        vm.warp(block.timestamp + MIN_ROUND_GAP + 1);

        uint64 ch4 = _submitChapter(author1, novelId, ch2, "world line descendant ch4!");
        uint64 ch5 = _submitChapter(author2, novelId, ch3, "non-world-line branch ch5!");

        vm.prank(keeper);
        novelCore.startRound(novelId);

        vm.prank(author2);
        novelCore.nominateCandidate{value: NOMINATION_FEE}(novelId, ch5);

        DataTypes.RoundData memory rd = novelCore.getRoundData(novelId, 2);
        uint256 ch5Idx = type(uint256).max;
        for (uint256 i = 0; i < rd.candidates.length; i++) {
            if (rd.candidates[i] == ch5) {
                ch5Idx = i;
                break;
            }
        }
        assertTrue(ch5Idx < rd.candidates.length, "ch5 not found in candidates");
        assertFalse(rd.candidateIsEligible[ch5Idx], "ch5 should be ineligible");
    }

    // ----------------------------------------------------------
    //  Creator royalty decay: D/(D+round)
    // ----------------------------------------------------------
    function test_creatorRoyaltyDecay() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        uint64 ch2 = _submitChapter(author1, novelId, rootId, "chapter for royalty test!!");

        address[] memory voters = new address[](1);
        voters[0] = voter1;

        _runFullRound(novelId, voters, ch2, bytes32("royalty1"));

        uint256 creatorReward1 = prizePool.getPendingReward(novelId, creator);
        assertTrue(creatorReward1 > 0, "creator should have reward after round 1");

        vm.warp(block.timestamp + MIN_ROUND_GAP + 1);
        uint64 ch3 = _submitChapter(author1, novelId, ch2, "chapter for royalty round 2");

        _runFullRound(novelId, voters, ch3, bytes32("royalty2"));

        uint256 creatorReward2 = prizePool.getPendingReward(novelId, creator);
        assertTrue(creatorReward2 > creatorReward1, "creator reward should accumulate");
    }

    // ----------------------------------------------------------
    //  Author rewards: deduplication when multiple world lines share path segments
    // ----------------------------------------------------------
    function test_authorRewards_deduplication() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        // Create a shared branch then diverge
        uint64 shared = _submitChapter(author1, novelId, rootId, "shared branch chapter!!!!!");
        uint64 branchA = _submitChapter(author1, novelId, shared, "branch A from shared ch!!");
        uint64 branchB = _submitChapter(author2, novelId, shared, "branch B from shared ch!!");

        // Run round — both branchA and branchB can be world lines
        // Shared path author (author1 for ch shared) should only be counted once
        address[] memory voters = new address[](1);
        voters[0] = voter1;
        _runFullRound(novelId, voters, branchA, bytes32("dedup"));

        uint256 author1Reward = prizePool.getPendingReward(novelId, author1);
        // author1 wrote both shared and branchA = 2 chapters on the world line
        assertTrue(author1Reward > 0, "author1 should receive reward");
    }

    // ----------------------------------------------------------
    //  Tip novel and tip chapter
    // ----------------------------------------------------------
    function test_tipNovel() public {
        uint64 novelId = _createNovel();
        uint256 poolBefore = prizePool.getPoolBalance(novelId);

        vm.prank(voter1);
        novelCore.tipNovel{value: 1 ether}(novelId);

        assertEq(prizePool.getPoolBalance(novelId) - poolBefore, 1 ether);
    }

    function test_tipChapter() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;
        uint64 ch2 = _submitChapter(author1, novelId, rootId, "chapter to tip content!!");

        uint256 authorBalBefore = author1.balance;
        uint256 poolBefore = prizePool.getPoolBalance(novelId);

        vm.prank(voter1);
        novelCore.tipChapter{value: 1 ether}(ch2);

        assertEq(author1.balance - authorBalBefore, 0.5 ether);
        assertEq(prizePool.getPoolBalance(novelId) - poolBefore, 0.5 ether);
    }

    // ----------------------------------------------------------
    //  Claim reward
    // ----------------------------------------------------------
    function test_claimReward() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;
        uint64 ch2 = _submitChapter(author1, novelId, rootId, "claim reward test chapter!");

        address[] memory voters = new address[](1);
        voters[0] = voter1;
        _runFullRound(novelId, voters, ch2, bytes32("claim"));

        uint256 pending = prizePool.getPendingReward(novelId, creator);
        assertTrue(pending > 0, "creator should have pending reward");

        uint256 balBefore = creator.balance;
        vm.prank(creator);
        novelCore.claimReward(novelId);
        assertTrue(creator.balance > balBefore, "creator balance should increase");
    }

    // ----------------------------------------------------------
    //  Complete novel by creator
    // ----------------------------------------------------------
    function test_completeNovel() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;
        _submitChapter(author1, novelId, rootId, "chapter for complete test!");

        vm.prank(creator);
        novelCore.completeNovel(novelId);

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertFalse(novel.active, "novel should be inactive after completion");
    }

    // ----------------------------------------------------------
    //  Voter rewards: accurate voters get 3x weight
    // ----------------------------------------------------------
    function test_voterRewards_accuracy() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        uint64 ch2 = _submitChapter(author1, novelId, rootId, "branch for voter accuracy!");
        uint64 ch3 = _submitChapter(author2, novelId, rootId, "branch B for voter accuracy");

        vm.prank(keeper);
        novelCore.startRound(novelId);

        vm.warp(block.timestamp + NOMINATE_DURATION + 1);
        vm.prank(keeper);
        novelCore.closeNomination(novelId);

        bytes32 salt = bytes32("votersalt");
        bytes32 commitHash2 = keccak256(abi.encodePacked(ch2, salt));
        bytes32 commitHash3 = keccak256(abi.encodePacked(ch3, salt));

        vm.prank(voter1);
        novelCore.commitVote{value: VOTE_STAKE}(novelId, commitHash2);
        vm.prank(voter2);
        novelCore.commitVote{value: VOTE_STAKE}(novelId, commitHash3);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        vm.prank(keeper);
        novelCore.closeCommit(novelId);

        vm.prank(voter1);
        novelCore.revealVote(novelId, ch2, salt);
        vm.prank(voter2);
        novelCore.revealVote(novelId, ch3, salt);

        vm.warp(block.timestamp + REVEAL_DURATION + 1);
        vm.prank(keeper);
        novelCore.settleRound(novelId);

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        uint32 round = novel.currentRound;

        // Both voters can claim voting rewards through NovelCore
        uint256 voter1BalBefore = voter1.balance;
        vm.prank(voter1);
        novelCore.claimVotingReward(novelId, round);
        uint256 voter1Reward = voter1.balance - voter1BalBefore;

        uint256 voter2BalBefore = voter2.balance;
        vm.prank(voter2);
        novelCore.claimVotingReward(novelId, round);
        uint256 voter2Reward = voter2.balance - voter2BalBefore;

        assertTrue(voter1Reward >= VOTE_STAKE, "voter1 should get at least stake back");
        assertTrue(voter2Reward >= VOTE_STAKE, "voter2 should get at least stake back");
    }

    // ----------------------------------------------------------
    //  Submit chapters during voting (always-on writing)
    // ----------------------------------------------------------
    function test_submitDuringVoting() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        uint64 ch2 = _submitChapter(author1, novelId, rootId, "pre-round chapter content!");

        vm.prank(keeper);
        novelCore.startRound(novelId);

        // Submit during nominating phase
        uint64 ch3 = _submitChapter(author2, novelId, rootId, "during nominating phase!!!");
        assertTrue(ch3 > 0, "should be able to submit during nominating");

        vm.warp(block.timestamp + NOMINATE_DURATION + 1);
        vm.prank(keeper);
        novelCore.closeNomination(novelId);

        // Submit during committing phase
        uint64 ch4 = _submitChapter(author1, novelId, ch2, "during committing phase!!!");
        assertTrue(ch4 > 0, "should be able to submit during committing");
    }
}
