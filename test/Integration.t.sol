// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {NovelCore} from "../src/core/NovelCore.sol";
import {VotingEngine} from "../src/core/VotingEngine.sol";
import {PrizePool} from "../src/core/PrizePool.sol";
import {RulesEngine} from "../src/core/RulesEngine.sol";
import {BountyBoard} from "../src/core/BountyBoard.sol";
import {RoundManager} from "../src/core/RoundManager.sol";
import {UserRegistry} from "../src/core/UserRegistry.sol";
import {DataTypes} from "../src/libraries/DataTypes.sol";

/// @title TestBase
/// @notice Base contract with deployment helpers for all tests
abstract contract TestBase is Test {
    NovelCore public novelCore;
    VotingEngine public votingEngine;
    PrizePool public prizePool;
    RulesEngine public rulesEngine;
    BountyBoard public bountyBoard;
    RoundManager public roundManager;
    UserRegistry public userRegistry;

    address public deployer = address(0xD);
    address public creator = address(0x1);
    address public author1 = address(0x2);
    address public author2 = address(0x3);
    address public author3 = address(0x4);
    address public voter1 = address(0x5);
    address public voter2 = address(0x6);
    address public voter3 = address(0x7);
    address public keeper = address(0x8);

    uint256 constant SUBMISSION_FEE = 0.01 ether;
    uint256 constant VOTE_STAKE = 0.005 ether;
    uint256 constant NOMINATION_FEE = 0.02 ether;
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

        // RoundManager
        RoundManager roundManagerImpl = new RoundManager();
        bytes memory roundData = abi.encodeCall(
            RoundManager.initialize, (deployer, address(novelCoreProxy), address(votingProxy), address(prizeProxy))
        );
        ERC1967Proxy roundProxy = new ERC1967Proxy(address(roundManagerImpl), roundData);
        roundManager = RoundManager(payable(address(roundProxy)));

        // Wire addresses
        votingEngine.setRoundManager(address(roundProxy));
        votingEngine.setPrizePool(address(prizeProxy));
        prizePool.setNovelCore(address(novelCoreProxy));
        prizePool.setRoundManager(address(roundProxy));
        prizePool.setRulesEngine(address(rulesProxy));
        prizePool.setBountyBoard(address(bountyProxy));
        prizePool.setVotingEngine(address(votingProxy));
        rulesEngine.setNovelCore(address(novelCoreProxy));
        novelCore.setRoundManager(address(roundProxy));
        // Configure the test `keeper` address as RoundManager's keeper so vm.prank(keeper) works.
        roundManager.setKeeper(keeper);

        // UserRegistry standalone
        userRegistry = new UserRegistry();

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
        uint64 countBefore = novelCore.chapterCount();
        vm.prank(who);
        novelCore.submitChapter{value: SUBMISSION_FEE}(novelId, parentId, _makeContent(text));
        return countBefore + 1;
    }

    // ─── Path-proof helpers ───

    /// Walk parentId chain from `from` up to (and including) `to`. Returns [from, ..., to].
    function _pathFromTo(uint64 from, uint64 to) internal view returns (uint64[] memory path) {
        uint64 cur = from;
        uint256 len = 1;
        while (cur != to) {
            DataTypes.Chapter memory ch = novelCore.getChapter(cur);
            require(ch.id != 0 && ch.depth > 1, "path: hit boundary before target");
            cur = ch.parentId;
            len++;
            require(len < 1024, "path: runaway");
        }
        path = new uint64[](len);
        cur = from;
        path[0] = cur;
        for (uint256 i = 1; i < len; i++) {
            cur = novelCore.getChapter(cur).parentId;
            path[i] = cur;
        }
    }

    /// Walk parentId chain from `from` until hitting any element of `anchors`.
    /// Returns path = [from, ..., anchor]. Reverts if no anchor found in chain.
    function _pathToAnyAnchor(uint64 from, uint64[] memory anchors) internal view returns (uint64[] memory path) {
        // First locate anchor in chain
        uint64 cur = from;
        uint256 len = 1;
        bool found = false;
        for (uint256 step = 0; step < 1024; step++) {
            for (uint256 a = 0; a < anchors.length; a++) {
                if (anchors[a] == cur) {
                    found = true;
                    break;
                }
            }
            if (found) break;
            DataTypes.Chapter memory ch = novelCore.getChapter(cur);
            require(ch.id != 0, "anchor walk: missing chapter");
            require(ch.depth > 1, "anchor walk: hit root before anchor");
            cur = ch.parentId;
            len++;
        }
        require(found, "anchor walk: anchor not found");
        path = new uint64[](len);
        cur = from;
        path[0] = cur;
        for (uint256 i = 1; i < len; i++) {
            cur = novelCore.getChapter(cur).parentId;
            path[i] = cur;
        }
    }

    /// Path from `chapterId` up to root (depth 1).
    function _pathToRoot(uint64 chapterId) internal view returns (uint64[] memory) {
        // Find root by walking
        uint64 cur = chapterId;
        while (novelCore.getChapter(cur).depth > 1) cur = novelCore.getChapter(cur).parentId;
        return _pathFromTo(chapterId, cur);
    }

    /// Single-element path. Useful when chapterId is itself an anchor.
    function _singleHop(uint64 id) internal pure returns (uint64[] memory path) {
        path = new uint64[](1);
        path[0] = id;
    }

    /// Find the first leaf descendant of `chapterId` by following children[0] greedily.
    function _firstLeafUnder(uint64 chapterId) internal view returns (uint64) {
        uint64 cur = chapterId;
        while (true) {
            DataTypes.Chapter memory ch = novelCore.getChapter(cur);
            if (ch.children.length == 0) return cur;
            cur = ch.children[0];
        }
        revert("unreachable");
    }

    /// Auto-build leaves: one leaf under each current worldLineAncestor, ensuring `target` is first.
    /// Uses worldLineCount to size the array.
    function _autoLeaves(uint64 novelId, uint64 target) internal view returns (uint64[] memory leaves) {
        DataTypes.Novel memory n = novelCore.getNovel(novelId);
        uint32 N = n.config.worldLineCount;
        uint64[] memory ancestors = novelCore.getWorldLineAncestors(novelId);
        leaves = new uint64[](N);
        leaves[0] = target;
        uint256 idx = 1;
        for (uint256 a = 0; a < ancestors.length && idx < N; a++) {
            uint64 leaf = _firstLeafUnder(ancestors[a]);
            bool dup;
            for (uint256 i = 0; i < idx; i++) {
                if (leaves[i] == leaf) {
                    dup = true;
                    break;
                }
            }
            if (!dup) leaves[idx++] = leaf;
        }
        // If still short, fall back to scanning recent chapters that are leaves
        uint64 cnt = novelCore.chapterCount();
        for (uint64 c = cnt; c >= 1 && idx < N; c--) {
            DataTypes.Chapter memory ch = novelCore.getChapter(c);
            if (ch.id == 0 || ch.novelId != novelId || ch.children.length != 0) {
                if (c == 1) break;
                continue;
            }
            bool dup;
            for (uint256 i = 0; i < idx; i++) {
                if (leaves[i] == c) {
                    dup = true;
                    break;
                }
            }
            if (!dup) leaves[idx++] = c;
            if (c == 1) break;
        }
        require(idx == N, "_autoLeaves: not enough distinct leaves");
    }

    /// Backward-compat wrapper: auto-compute leaves from worldLineAncestors.
    function _runFullRound(uint64 novelId, address[] memory voters, uint64 target, bytes32 salt) internal {
        uint64[] memory leaves = _autoLeaves(novelId, target);
        _runFullRound(novelId, leaves, voters, target, salt);
    }

    /// Run a full round. Caller provides leaves in tally order (target first, then by candidate position).
    function _runFullRound(
        uint64 novelId,
        uint64[] memory leaves,
        address[] memory voters,
        uint64 target,
        bytes32 salt
    ) internal {
        vm.prank(keeper);
        roundManager.startRound(novelId, leaves);

        vm.warp(block.timestamp + NOMINATE_DURATION + 1);
        vm.prank(keeper);
        roundManager.closeNomination(novelId);

        bytes32 commitHash = keccak256(abi.encodePacked(target, salt));
        for (uint256 i = 0; i < voters.length; i++) {
            vm.prank(voters[i]);
            roundManager.commitVote{value: VOTE_STAKE}(novelId, commitHash);
        }

        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        vm.prank(keeper);
        roundManager.closeCommit(novelId);

        for (uint256 i = 0; i < voters.length; i++) {
            vm.prank(voters[i]);
            roundManager.revealVote(novelId, target, salt);
        }

        vm.warp(block.timestamp + REVEAL_DURATION + 1);

        vm.prank(keeper);
        roundManager.settleRound(novelId);
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
        prizePool.tipNovel{value: 5 ether}(originalId);

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

        DataTypes.Chapter memory forkRoot = novelCore.getChapter(novelCore.chapterCount());
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

        uint64[] memory rootKids = novelCore.getChapterChildren(rootId);
        assertEq(rootKids.length, 2);
        assertEq(rootKids[0], ch2);
        assertEq(rootKids[1], ch3);

        uint64[] memory ch2Kids = novelCore.getChapterChildren(ch2);
        assertEq(ch2Kids.length, 1);
        assertEq(ch2Kids[0], ch4);
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

        // Leaves: ch4 (depth 3) and ch3 (depth 2)
        uint64[] memory leaves = new uint64[](2);
        leaves[0] = ch4;
        leaves[1] = ch3;

        vm.prank(keeper);
        roundManager.startRound(novelId, leaves);

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.currentRound, 1);
        assertEq(uint8(novel.roundPhase), uint8(DataTypes.RoundPhase.Nominating));

        DataTypes.RoundData memory rd = roundManager.getRoundData(novelId, 1);
        assertTrue(rd.candidates.length >= 2);

        vm.warp(block.timestamp + NOMINATE_DURATION + 1);
        vm.prank(keeper);
        roundManager.closeNomination(novelId);

        uint64 targetCandidate = ch4;
        bytes32 salt = bytes32("mysalt");
        bytes32 commitHash = keccak256(abi.encodePacked(targetCandidate, salt));

        vm.prank(voter1);
        roundManager.commitVote{value: VOTE_STAKE}(novelId, commitHash);
        vm.prank(voter2);
        roundManager.commitVote{value: VOTE_STAKE}(novelId, commitHash);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        vm.prank(keeper);
        roundManager.closeCommit(novelId);

        vm.prank(voter1);
        roundManager.revealVote(novelId, targetCandidate, salt);
        vm.prank(voter2);
        roundManager.revealVote(novelId, targetCandidate, salt);

        vm.warp(block.timestamp + REVEAL_DURATION + 1);

        vm.prank(keeper);
        roundManager.settleRound(novelId);

        novel = novelCore.getNovel(novelId);
        assertEq(uint8(novel.roundPhase), uint8(DataTypes.RoundPhase.Idle));
        assertEq(novel.currentRound, 1);

        uint64[] memory wl = novelCore.getWorldLineAncestors(novelId);
        assertTrue(wl.length > 0);

        rd = roundManager.getRoundData(novelId, 1);
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

        uint64[] memory leaves1 = new uint64[](2);
        leaves1[0] = ch2;
        leaves1[1] = ch3;
        _runFullRound(novelId, leaves1, voters, ch2, salt);

        uint64[] memory wl1 = novelCore.getWorldLineAncestors(novelId);
        assertTrue(wl1.length > 0);

        vm.warp(block.timestamp + MIN_ROUND_GAP + 1);

        uint64 ch5 = _submitChapter(author1, novelId, wl1[0], "round 2 continuation 1!!");
        uint64 ch6 = _submitChapter(author2, novelId, wl1[0], "round 2 continuation 2!!");

        salt = bytes32("salt2");
        // wl1 = [ch2, ch3]. ch5 and ch6 both extend ch2; ch3 has no continuation, but is still
        // a worldLineAncestor (and a leaf since no children). Use leaves [ch5 (target), ch6, ch3].
        // worldLineCount = 2, so leaves needs >= 2.
        uint64[] memory leaves2 = new uint64[](2);
        leaves2[0] = ch5;
        leaves2[1] = ch6;
        _runFullRound(novelId, leaves2, voters, ch5, salt);

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        assertEq(novel.currentRound, 2);

        uint64[] memory wl2 = novelCore.getWorldLineAncestors(novelId);
        assertTrue(wl2.length > 0);
    }

    // ----------------------------------------------------------
    //  Nomination: any user pays fee; path proof required (chapter must descend from worldLine)
    // ----------------------------------------------------------
    function test_nomination_requiresPathToWorldLine() public {
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.worldLineCount = 1;
        uint64 novelId = _createNovelWith(creator, config, 1 ether);
        uint64 rootId = 1;

        uint64 ch2 = _submitChapter(author1, novelId, rootId, "branch A for nomination!");
        uint64 ch3 = _submitChapter(author2, novelId, rootId, "branch B for nomination!");

        address[] memory voters = new address[](1);
        voters[0] = voter1;
        uint64[] memory leaves1 = new uint64[](1);
        leaves1[0] = ch2;
        _runFullRound(novelId, leaves1, voters, ch2, bytes32("s1"));

        vm.warp(block.timestamp + MIN_ROUND_GAP + 1);

        uint64 ch4 = _submitChapter(author1, novelId, ch2, "world line descendant ch4!");
        uint64 ch5 = _submitChapter(author2, novelId, ch3, "non-world-line branch ch5!");

        // Round 2: leaves = [ch4]. ch4 is descendant of ch2 (current worldLine).
        uint64[] memory leaves2 = new uint64[](1);
        leaves2[0] = ch4;
        vm.prank(keeper);
        roundManager.startRound(novelId, leaves2);

        // ch5 nomination requires a path to a current worldLineAncestor (which is ch2 now).
        // ch5's parent is ch3, ch3's parent is root. ch2 is NOT in ch5's parent chain.
        // So no valid path exists — nomination should revert.
        uint64[] memory bogusPath = _pathToRoot(ch5);
        vm.prank(author2);
        vm.expectRevert();
        roundManager.nominateCandidate{value: NOMINATION_FEE}(novelId, ch5, bogusPath);

        // ch4 IS a descendant of ch2 — but ch4 is already a candidate (added by startRound).
        // Build path [ch4, ch2] and try; expect AlreadyACandidate revert.
        uint64[] memory ch4Path = _pathFromTo(ch4, ch2);
        vm.prank(author1);
        vm.expectRevert();
        roundManager.nominateCandidate{value: NOMINATION_FEE}(novelId, ch4, ch4Path);
    }

    // ----------------------------------------------------------
    //  Creator royalty decay: D/(D+round)
    // ----------------------------------------------------------
    function test_creatorRoyaltyDecay() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        uint64 ch2 = _submitChapter(author1, novelId, rootId, "chapter for royalty test!!");
        _submitChapter(author2, novelId, rootId, "royalty test branch B chapter!");

        address[] memory voters = new address[](1);
        voters[0] = voter1;

        _runFullRound(novelId, voters, ch2, bytes32("royalty1"));

        uint256 creatorReward1 = prizePool.getPendingReward(novelId, creator);
        assertTrue(creatorReward1 > 0, "creator should have reward after round 1");

        vm.warp(block.timestamp + MIN_ROUND_GAP + 1);
        uint64[] memory wl = novelCore.getWorldLineAncestors(novelId);
        uint64 ch3 = _submitChapter(author1, novelId, wl[0], "chapter for royalty round 2");
        if (wl.length > 1) _submitChapter(author2, novelId, wl[1], "royalty round 2 branch B!");

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
        prizePool.tipNovel{value: 1 ether}(novelId);

        assertEq(prizePool.getPoolBalance(novelId) - poolBefore, 1 ether);
    }

    function test_tipChapter() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;
        uint64 ch2 = _submitChapter(author1, novelId, rootId, "chapter to tip content!!");

        uint256 authorBalBefore = author1.balance;
        uint256 poolBefore = prizePool.getPoolBalance(novelId);

        vm.prank(voter1);
        prizePool.tipChapter{value: 1 ether}(ch2);

        // Pull-only: author share accrues to pendingRewards, no immediate transfer.
        assertEq(author1.balance, authorBalBefore, "tip should not push to author");
        assertEq(prizePool.getPoolBalance(novelId) - poolBefore, 0.5 ether, "pool should get 50%");
        assertEq(prizePool.getPendingReward(novelId, author1), 0.5 ether, "author pending should be 50%");

        // Author claims their share
        vm.prank(author1);
        novelCore.claimReward(novelId);
        assertEq(author1.balance - authorBalBefore, 0.5 ether, "author received tip after claim");
        assertEq(prizePool.getPendingReward(novelId, author1), 0, "pending cleared after claim");
    }

    // ----------------------------------------------------------
    //  Claim reward
    // ----------------------------------------------------------
    function test_claimReward() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;
        uint64 ch2 = _submitChapter(author1, novelId, rootId, "claim reward test chapter!");
        _submitChapter(author2, novelId, rootId, "claim reward test branch B!");

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
    function test_setKeeper_revertsOnZeroAddress() public {
        vm.prank(deployer);
        vm.expectRevert(RoundManager.ZeroAddress.selector);
        roundManager.setKeeper(address(0));
    }

    function test_completeNovel_revertsOnFreshNovel() public {
        // Fresh novel with no settled round cannot be completed (B-2 guard).
        uint64 novelId = _createNovel();
        uint64 rootId = 1;
        _submitChapter(author1, novelId, rootId, "chapter for complete test!");

        vm.prank(creator);
        vm.expectRevert(RoundManager.NovelHasNoRound.selector);
        roundManager.completeNovel(novelId);
    }


    // ----------------------------------------------------------
    //  Voter rewards: accurate voters get 3x weight
    // ----------------------------------------------------------
    function test_voterRewards_accuracy() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        uint64 ch2 = _submitChapter(author1, novelId, rootId, "branch for voter accuracy!");
        uint64 ch3 = _submitChapter(author2, novelId, rootId, "branch B for voter accuracy");

        uint64[] memory leaves = new uint64[](2);
        leaves[0] = ch2;
        leaves[1] = ch3;

        vm.prank(keeper);
        roundManager.startRound(novelId, leaves);

        vm.warp(block.timestamp + NOMINATE_DURATION + 1);
        vm.prank(keeper);
        roundManager.closeNomination(novelId);

        bytes32 salt = bytes32("votersalt");
        bytes32 commitHash2 = keccak256(abi.encodePacked(ch2, salt));
        bytes32 commitHash3 = keccak256(abi.encodePacked(ch3, salt));

        vm.prank(voter1);
        roundManager.commitVote{value: VOTE_STAKE}(novelId, commitHash2);
        vm.prank(voter2);
        roundManager.commitVote{value: VOTE_STAKE}(novelId, commitHash3);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        vm.prank(keeper);
        roundManager.closeCommit(novelId);

        vm.prank(voter1);
        roundManager.revealVote(novelId, ch2, salt);
        vm.prank(voter2);
        roundManager.revealVote(novelId, ch3, salt);

        vm.warp(block.timestamp + REVEAL_DURATION + 1);

        vm.prank(keeper);
        roundManager.settleRound(novelId);

        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        uint32 round = novel.currentRound;

        // Both voters can claim voting rewards through NovelCore
        uint256 voter1BalBefore = voter1.balance;
        vm.prank(voter1);
        roundManager.claimVotingReward(novelId, round);
        uint256 voter1Reward = voter1.balance - voter1BalBefore;

        uint256 voter2BalBefore = voter2.balance;
        vm.prank(voter2);
        roundManager.claimVotingReward(novelId, round);
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
        uint64 ch2b = _submitChapter(author2, novelId, rootId, "pre-round branch B chapter!");

        uint64[] memory leaves = new uint64[](2);
        leaves[0] = ch2;
        leaves[1] = ch2b;

        vm.prank(keeper);
        roundManager.startRound(novelId, leaves);

        // Submit during nominating phase
        uint64 ch3 = _submitChapter(author2, novelId, rootId, "during nominating phase!!!");
        assertTrue(ch3 > 0, "should be able to submit during nominating");

        vm.warp(block.timestamp + NOMINATE_DURATION + 1);
        vm.prank(keeper);
        roundManager.closeNomination(novelId);

        // Submit during committing phase
        uint64 ch4 = _submitChapter(author1, novelId, ch2, "during committing phase!!!");
        assertTrue(ch4 > 0, "should be able to submit during committing");
    }

    // ----------------------------------------------------------
    //  Protocol voter reward cap: per-address reward capped at voteStake * VOTER_REWARD_CAP_MULTIPLIER (20x)
    // ----------------------------------------------------------
    function test_voterRewardCap_usesProtocolMultiplier() public {
        // Seed a pool large enough that a single voter would exceed the 20x cap without it.
        // cap = 0.005 * 20 = 0.1 ether. Need voterRewardPool > 0.1 ether so cap triggers.
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.worldLineCount = 1;

        uint64 novelId = _createNovelWith(creator, config, 50 ether);
        uint64 rootId = 1;
        uint64 ch2 = _submitChapter(author1, novelId, rootId, "branch for cap test ch!!");

        address[] memory voters = new address[](1);
        voters[0] = voter1;

        uint256 poolBefore = prizePool.getPoolBalance(novelId);
        _runFullRound(novelId, voters, ch2, bytes32("capsalt"));
        uint256 poolAfterSettle = prizePool.getPoolBalance(novelId);

        // Expected voter reward budget (round 1: creator takes 75%, remaining 25%; voter share = 15% of remaining)
        uint256 release = (poolBefore * 2000) / 10000;
        uint256 voterBudget = ((release - (release * 3) / 4) * 1500) / 10000;
        uint256 cap = VOTE_STAKE * votingEngine.VOTER_REWARD_CAP_MULTIPLIER();

        assertGt(voterBudget, cap, "test setup: voter budget must exceed cap to exercise capping");

        // Voter claim: payout = stake refund + capped reward
        uint256 balBefore = voter1.balance;
        vm.prank(voter1);
        roundManager.claimVotingReward(novelId, 1);
        assertEq(voter1.balance - balBefore, VOTE_STAKE + cap, "payout should be stake + protocol cap");

        // Excess returned to pool
        uint256 excessRecovered = poolAfterSettle - (poolBefore - release);
        assertApproxEqAbs(excessRecovered, voterBudget - cap, 2, "excess should return to pool");
    }

    // ----------------------------------------------------------
    //  Fixed 50% unreveal penalty (protocol constant, no per-novel floor)
    // ----------------------------------------------------------
    function test_unrevealPenalty_fiftyPercent() public {
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.worldLineCount = 1;

        uint64 novelId = _createNovelWith(creator, config, 1 ether);
        uint64 rootId = 1;
        uint64 ch2 = _submitChapter(author1, novelId, rootId, "branch for unreveal test!!");

        uint64[] memory leaves = new uint64[](1);
        leaves[0] = ch2;

        vm.prank(keeper);
        roundManager.startRound(novelId, leaves);
        vm.warp(block.timestamp + NOMINATE_DURATION + 1);
        vm.prank(keeper);
        roundManager.closeNomination(novelId);

        bytes32 salt = bytes32("unrevealsalt");
        bytes32 commitHash = keccak256(abi.encodePacked(ch2, salt));

        vm.prank(voter1);
        roundManager.commitVote{value: VOTE_STAKE}(novelId, commitHash);
        vm.prank(voter2);
        roundManager.commitVote{value: VOTE_STAKE}(novelId, commitHash);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        vm.prank(keeper);
        roundManager.closeCommit(novelId);

        vm.prank(voter1);
        roundManager.revealVote(novelId, ch2, salt);

        vm.warp(block.timestamp + REVEAL_DURATION + 1);

        vm.prank(keeper);
        roundManager.settleRound(novelId);

        // voter2 (unrevealed) should get stake - 50%
        uint256 expectedPenalty = (VOTE_STAKE * votingEngine.UNREVEAL_PENALTY_RATE_BP()) / 10000;
        assertEq(expectedPenalty, VOTE_STAKE / 2, "protocol constant should be 50%");

        uint256 v2Before = voter2.balance;
        vm.prank(voter2);
        roundManager.claimVotingReward(novelId, 1);
        assertEq(voter2.balance - v2Before, VOTE_STAKE - expectedPenalty, "unrevealed voter gets stake - 50%");

        // voter1 (revealed) gets stake + reward (reward includes the penalty collected from voter2)
        uint256 v1Before = voter1.balance;
        vm.prank(voter1);
        roundManager.claimVotingReward(novelId, 1);
        assertGt(voter1.balance - v1Before, VOTE_STAKE, "revealed voter gets stake + nonzero reward");
    }

    // ----------------------------------------------------------
    //  Config validation: submissionFee floor and worldLineCount ceiling
    // ----------------------------------------------------------
    function test_validateConfig_submissionFeeFloor() public {
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.submissionFee = 1; // below MIN_SUBMISSION_FEE (0.0001 ether)
        vm.prank(creator);
        vm.expectRevert();
        novelCore.createNovel{value: 1 ether}(
            config, _defaultMetadata(), _makeContent("root chapter content for novel")
        );
    }

    function test_validateConfig_worldLineCountCeiling() public {
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.worldLineCount = 17; // above MAX_WORLD_LINE_COUNT (16)
        vm.prank(creator);
        vm.expectRevert();
        novelCore.createNovel{value: 1 ether}(
            config, _defaultMetadata(), _makeContent("root chapter content for novel")
        );
    }

    // ----------------------------------------------------------
    //  Nomination cap: cannot push beyond MAX_CANDIDATES_PER_ROUND
    // ----------------------------------------------------------
    function test_nomination_capEnforced() public {
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.worldLineCount = 1;
        config.nominationFee = 0.0001 ether;
        uint64 novelId = _createNovelWith(creator, config, 1 ether);
        uint64 rootId = 1;

        // Build a wide tree of root children — keeper picks the first as the (single) leaf candidate.
        uint64[] memory children = new uint64[](70);
        for (uint256 i = 0; i < 70; i++) {
            children[i] =
                _submitChapter(author1, novelId, rootId, abi.encodePacked("child chapter content #", bytes1(uint8(i))));
        }

        // Keeper picks just one leaf to start the round (worldLineCount = 1)
        uint64[] memory leaves = new uint64[](1);
        leaves[0] = children[0];
        vm.prank(keeper);
        roundManager.startRound(novelId, leaves);

        // Nominate children[1..63] (63 nominations + 1 auto leaf = 64 candidates, the cap).
        // Each nomination needs a path proving the chapter is descendant of current worldLineAncestor (root).
        for (uint256 i = 1; i < 64; i++) {
            uint64[] memory path = _pathFromTo(children[i], rootId);
            vm.prank(author2);
            roundManager.nominateCandidate{value: 0.0001 ether}(novelId, children[i], path);
        }

        // 65th candidate (children[64]) must hit the cap and revert.
        uint64[] memory overflowPath = _pathFromTo(children[64], rootId);
        vm.prank(author2);
        vm.expectRevert(); // TooManyLeaves
        roundManager.nominateCandidate{value: 0.0001 ether}(novelId, children[64], overflowPath);
    }

    // ----------------------------------------------------------
    //  voteStake must not exceed submissionFee (voting should not cost more than writing)
    // ----------------------------------------------------------
    function test_validateConfig_voteStakeAboveSubmissionFee() public {
        DataTypes.NovelConfig memory config = _defaultConfig();
        config.voteStake = config.submissionFee + 1;
        vm.prank(creator);
        vm.expectRevert();
        novelCore.createNovel{value: 1 ether}(
            config, _defaultMetadata(), _makeContent("root chapter content for novel")
        );
    }
}
