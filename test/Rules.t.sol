// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {NovelCore} from "../src/core/NovelCore.sol";
import {VotingEngine} from "../src/core/VotingEngine.sol";
import {PrizePool} from "../src/core/PrizePool.sol";
import {ChapterNFT} from "../src/core/ChapterNFT.sol";
import {RulesEngine} from "../src/core/RulesEngine.sol";
import {DataTypes} from "../src/libraries/DataTypes.sol";

contract RulesTest is Test {
    NovelCore public novelCore;
    VotingEngine public votingEngine;
    PrizePool public prizePool;
    ChapterNFT public chapterNFT;
    RulesEngine public rulesEngine;

    address public owner = address(0x1001);
    address public creator = address(0x1010);
    address public author1 = address(0x2020);
    address public author2 = address(0x3030);
    address public author3 = address(0x4040);
    address public voter1 = address(0x5050);
    address public voter2 = address(0x6060);

    DataTypes.NovelConfig defaultConfig;
    DataTypes.NovelMetadata defaultMetadata;

    function setUp() public {
        NovelCore novelCoreImpl = new NovelCore();
        VotingEngine votingEngineImpl = new VotingEngine();
        PrizePool prizePoolImpl = new PrizePool();
        ChapterNFT chapterNFTImpl = new ChapterNFT();

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

        RulesEngine rulesEngineImpl = new RulesEngine();
        bytes memory rulesData =
            abi.encodeCall(RulesEngine.initialize, (owner, address(novelCoreProxy), address(prizeProxy)));
        ERC1967Proxy rulesProxy = new ERC1967Proxy(address(rulesEngineImpl), rulesData);
        rulesEngine = RulesEngine(address(rulesProxy));

        vm.startPrank(owner);
        novelCore.setVotingEngine(address(votingEngine));
        novelCore.setPrizePool(address(prizePool));
        novelCore.setChapterNFT(address(chapterNFT));
        prizePool.setRulesEngine(address(rulesEngine));
        vm.stopPrank();

        vm.deal(creator, 100 ether);
        vm.deal(author1, 100 ether);
        vm.deal(author2, 100 ether);
        vm.deal(author3, 100 ether);
        vm.deal(voter1, 100 ether);
        vm.deal(voter2, 100 ether);

        defaultConfig = DataTypes.NovelConfig({
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
            contentBaseUrl: "",
            ruleFee: 0.001 ether,
            ruleVoteDuration: 3 days,
            ruleQuorum: 2
        });

        defaultMetadata =
            DataTypes.NovelMetadata({title: "Rules Test Novel", description: "A test novel", coverUri: ""});
    }

    // ============================================================
    //                         HELPERS
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

    function _createNovel() internal returns (uint256 novelId) {
        bytes memory genesis = new bytes(200);
        for (uint256 i = 0; i < 200; i++) {
            genesis[i] = bytes1(uint8(65 + (i % 26)));
        }

        vm.prank(creator);
        novelId = novelCore.createNovel{value: 1 ether}(defaultConfig, defaultMetadata, _genesisSubmissions(genesis));
    }

    /// @dev Run a full epoch: 3 authors submit, vote, settle round, settle epoch.
    ///      Uses absolute time offsets (same pattern as Integration.t.sol).
    function _runFullEpoch(uint256 novelId) internal {
        uint256[] memory worldLines = novelCore.getActiveWorldLines(novelId);
        uint256 parentId = worldLines[0];
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        uint256 t0 = block.timestamp;

        // Submit 3 chapters
        bytes memory c1 = new bytes(200);
        bytes memory c2 = new bytes(200);
        bytes memory c3 = new bytes(200);
        for (uint256 i = 0; i < 200; i++) {
            c1[i] = bytes1(uint8(65 + (i % 26)));
            c2[i] = bytes1(uint8(66 + (i % 26)));
            c3[i] = bytes1(uint8(67 + (i % 26)));
        }

        vm.prank(author1);
        uint256 ch1 = novelCore.submitChapter{value: 0.01 ether}(novelId, parentId, _makeSubmission(c1));
        vm.prank(author2);
        novelCore.submitChapter{value: 0.01 ether}(novelId, parentId, _makeSubmission(c2));
        vm.prank(author3);
        novelCore.submitChapter{value: 0.01 ether}(novelId, parentId, _makeSubmission(c3));

        // Round voting
        uint256 roundVotingId = _votingRoundId(novelId, novel.currentEpoch, novel.currentRound, false);
        bytes32 s1 = bytes32("s1");
        bytes32 s2 = bytes32("s2");

        vm.warp(t0 + 2 days);
        novelCore.closeSubmissions(novelId);

        vm.prank(voter1);
        votingEngine.commitVote{value: 0.1 ether}(novelId, roundVotingId, keccak256(abi.encodePacked(ch1, s1)));
        vm.prank(voter2);
        votingEngine.commitVote{value: 0.05 ether}(novelId, roundVotingId, keccak256(abi.encodePacked(ch1, s2)));

        vm.warp(t0 + 6 days);
        novelCore.closeCommit(novelId);
        vm.prank(voter1);
        votingEngine.revealVote(novelId, roundVotingId, ch1, s1);
        vm.prank(voter2);
        votingEngine.revealVote(novelId, roundVotingId, ch1, s2);

        vm.warp(t0 + 9 days);
        novelCore.settleRound(novelId);

        // Epoch voting
        novel = novelCore.getNovel(novelId);
        uint256 epochVotingId = _votingRoundId(novelId, novel.currentEpoch, novel.currentRound, true);
        worldLines = novelCore.getActiveWorldLines(novelId);
        bytes32 es1 = bytes32("es1");
        bytes32 es2 = bytes32("es2");

        vm.prank(voter1);
        votingEngine.commitVote{value: 0.1 ether}(
            novelId, epochVotingId, keccak256(abi.encodePacked(worldLines[0], es1))
        );
        vm.prank(voter2);
        votingEngine.commitVote{value: 0.05 ether}(
            novelId, epochVotingId, keccak256(abi.encodePacked(worldLines[0], es2))
        );

        vm.warp(t0 + 13 days);
        novelCore.closeEpochCommit(novelId);
        vm.prank(voter1);
        votingEngine.revealVote(novelId, epochVotingId, worldLines[0], es1);
        vm.prank(voter2);
        votingEngine.revealVote(novelId, epochVotingId, worldLines[0], es2);

        vm.warp(t0 + 16 days);
        novelCore.settleEpoch(novelId);
    }

    function _votingRoundId(uint256 novelId, uint32 epoch, uint32 round, bool isEpoch)
        internal
        pure
        returns (uint256)
    {
        return uint256(keccak256(abi.encodePacked(novelId, epoch, round, isEpoch)));
    }

    // ============================================================
    //                    CREATOR RULES TESTS
    // ============================================================

    function test_CreatorSetsRules() public {
        uint256 novelId = _createNovel();

        string[] memory names = new string[](2);
        string[] memory contents = new string[](2);
        names[0] = "setting";
        names[1] = "protagonist";
        contents[0] = "A cyberpunk city in 2099";
        contents[1] = "A rogue AI named Zero";

        vm.prank(creator);
        rulesEngine.setCreatorRules(novelId, names, contents);

        assertEq(rulesEngine.getRule(novelId, "setting"), "A cyberpunk city in 2099");
        assertEq(rulesEngine.getRule(novelId, "protagonist"), "A rogue AI named Zero");

        string[] memory ruleNames = rulesEngine.getRuleNames(novelId);
        assertEq(ruleNames.length, 2);
    }

    function test_CreatorCanUpdateRuleDuringEpoch1() public {
        uint256 novelId = _createNovel();

        string[] memory names = new string[](1);
        string[] memory contents = new string[](1);
        names[0] = "setting";
        contents[0] = "Original setting";

        vm.prank(creator);
        rulesEngine.setCreatorRules(novelId, names, contents);

        // Update the same rule
        contents[0] = "Updated setting";
        vm.prank(creator);
        rulesEngine.setCreatorRules(novelId, names, contents);

        assertEq(rulesEngine.getRule(novelId, "setting"), "Updated setting");
        // Should not create duplicate entries
        string[] memory ruleNames = rulesEngine.getRuleNames(novelId);
        assertEq(ruleNames.length, 1);
    }

    function test_CreatorRulesLockedAfterEpoch1() public {
        uint256 novelId = _createNovel();
        _runFullEpoch(novelId);

        string[] memory names = new string[](1);
        string[] memory contents = new string[](1);
        names[0] = "setting";
        contents[0] = "Too late";

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(RulesEngine.CreatorRulesLocked.selector, novelId));
        rulesEngine.setCreatorRules(novelId, names, contents);
    }

    function test_NonCreatorCannotSetRules() public {
        uint256 novelId = _createNovel();

        string[] memory names = new string[](1);
        string[] memory contents = new string[](1);
        names[0] = "setting";
        contents[0] = "Hacker attempt";

        vm.prank(author1);
        vm.expectRevert(abi.encodeWithSelector(RulesEngine.NotNovelCreator.selector, novelId, author1));
        rulesEngine.setCreatorRules(novelId, names, contents);
    }

    function test_InvalidRuleName() public {
        uint256 novelId = _createNovel();

        string[] memory names = new string[](1);
        string[] memory contents = new string[](1);
        names[0] = ""; // empty name
        contents[0] = "Some content";

        vm.prank(creator);
        vm.expectRevert(RulesEngine.InvalidRuleName.selector);
        rulesEngine.setCreatorRules(novelId, names, contents);
    }

    // ============================================================
    //                   PROPOSE RULE TESTS
    // ============================================================

    function test_ProposeAddRule() public {
        uint256 novelId = _createNovel();

        uint256 poolBefore = prizePool.getPoolBalance(novelId);

        vm.prank(author1);
        uint256 proposalId = rulesEngine.proposeRule{value: 0.001 ether}(
            novelId, DataTypes.RuleProposalType.Add, "new_rule", "A new world rule"
        );

        DataTypes.RuleProposal memory p = rulesEngine.getRuleProposal(proposalId);
        assertEq(p.novelId, novelId);
        assertEq(p.proposer, author1);
        assertEq(uint8(p.proposalType), uint8(DataTypes.RuleProposalType.Add));
        assertEq(p.ruleName, "new_rule");
        assertEq(p.ruleContent, "A new world rule");
        assertEq(p.voteCount, 0);
        assertFalse(p.executed);

        // Fee went to prize pool
        assertEq(prizePool.getPoolBalance(novelId), poolBefore + 0.001 ether);
    }

    function test_ProposeRuleInsufficientFee() public {
        uint256 novelId = _createNovel();

        vm.prank(author1);
        vm.expectRevert(abi.encodeWithSelector(RulesEngine.InsufficientRuleFee.selector, 0.0005 ether, 0.001 ether));
        rulesEngine.proposeRule{value: 0.0005 ether}(novelId, DataTypes.RuleProposalType.Add, "new_rule", "Content");
    }

    function test_ProposeDeleteNonExistentRule() public {
        uint256 novelId = _createNovel();

        vm.prank(author1);
        vm.expectRevert(abi.encodeWithSelector(RulesEngine.RuleNotFound.selector, "ghost"));
        rulesEngine.proposeRule{value: 0.001 ether}(novelId, DataTypes.RuleProposalType.Delete, "ghost", "");
    }

    function test_ProposeAddDuplicateRule() public {
        uint256 novelId = _createNovel();

        // Creator sets a rule first
        string[] memory names = new string[](1);
        string[] memory contents = new string[](1);
        names[0] = "setting";
        contents[0] = "Original";
        vm.prank(creator);
        rulesEngine.setCreatorRules(novelId, names, contents);

        // Propose adding a rule with the same name
        vm.prank(author1);
        vm.expectRevert(abi.encodeWithSelector(RulesEngine.RuleAlreadyExists.selector, "setting"));
        rulesEngine.proposeRule{value: 0.001 ether}(novelId, DataTypes.RuleProposalType.Add, "setting", "Duplicate");
    }

    // ============================================================
    //                   VOTE ON PROPOSAL TESTS
    // ============================================================

    function test_CanonAuthorVotesAndQuorumReached() public {
        uint256 novelId = _createNovel();
        _runFullEpoch(novelId); // Makes author1, author2 canon authors

        // Propose a new rule
        vm.prank(author1);
        uint256 proposalId = rulesEngine.proposeRule{value: 0.001 ether}(
            novelId, DataTypes.RuleProposalType.Add, "plot_twist", "The AI becomes sentient"
        );

        // First vote (quorum = 2, so not yet executed)
        vm.prank(creator);
        rulesEngine.voteOnRuleProposal(proposalId);

        DataTypes.RuleProposal memory p = rulesEngine.getRuleProposal(proposalId);
        assertEq(p.voteCount, 1);
        assertFalse(p.executed);

        // Second vote reaches quorum
        vm.prank(author1);
        rulesEngine.voteOnRuleProposal(proposalId);

        p = rulesEngine.getRuleProposal(proposalId);
        assertEq(p.voteCount, 2);
        assertTrue(p.executed);

        // Rule is now set
        assertEq(rulesEngine.getRule(novelId, "plot_twist"), "The AI becomes sentient");
    }

    function test_NonCanonAuthorCannotVote() public {
        uint256 novelId = _createNovel();

        vm.prank(author1);
        uint256 proposalId =
            rulesEngine.proposeRule{value: 0.001 ether}(novelId, DataTypes.RuleProposalType.Add, "rule1", "Content");

        // author2 is NOT a canon author (no epoch settled)
        vm.prank(author2);
        vm.expectRevert(abi.encodeWithSelector(RulesEngine.NotCanonAuthor.selector, novelId, author2));
        rulesEngine.voteOnRuleProposal(proposalId);
    }

    function test_CannotVoteTwice() public {
        uint256 novelId = _createNovel();

        vm.prank(author1);
        uint256 proposalId =
            rulesEngine.proposeRule{value: 0.001 ether}(novelId, DataTypes.RuleProposalType.Add, "rule1", "Content");

        // Creator votes once
        vm.prank(creator);
        rulesEngine.voteOnRuleProposal(proposalId);

        // Creator tries to vote again
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(RulesEngine.AlreadyVotedOnProposal.selector, proposalId, creator));
        rulesEngine.voteOnRuleProposal(proposalId);
    }

    function test_VoteAfterExpiry() public {
        uint256 novelId = _createNovel();

        vm.prank(author1);
        uint256 proposalId =
            rulesEngine.proposeRule{value: 0.001 ether}(novelId, DataTypes.RuleProposalType.Add, "rule1", "Content");

        // Warp past vote duration
        vm.warp(block.timestamp + 3 days + 1);

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(RulesEngine.ProposalExpired.selector, proposalId));
        rulesEngine.voteOnRuleProposal(proposalId);
    }

    // ============================================================
    //                   DELETE RULE TESTS
    // ============================================================

    function test_ProposeAndDeleteRule() public {
        uint256 novelId = _createNovel();

        string[] memory names = new string[](1);
        string[] memory contents = new string[](1);
        names[0] = "old_rule";
        contents[0] = "This rule is outdated";
        vm.prank(creator);
        rulesEngine.setCreatorRules(novelId, names, contents);

        // Verify rule exists
        assertEq(rulesEngine.getRule(novelId, "old_rule"), "This rule is outdated");

        // Run epoch to make authors canon
        _runFullEpoch(novelId);

        // Propose deletion
        vm.prank(author1);
        uint256 proposalId =
            rulesEngine.proposeRule{value: 0.001 ether}(novelId, DataTypes.RuleProposalType.Delete, "old_rule", "");

        // Vote to reach quorum
        vm.prank(creator);
        rulesEngine.voteOnRuleProposal(proposalId);
        vm.prank(author1);
        rulesEngine.voteOnRuleProposal(proposalId);

        // Rule should be deleted
        assertEq(bytes(rulesEngine.getRule(novelId, "old_rule")).length, 0);
        string[] memory ruleNames = rulesEngine.getRuleNames(novelId);
        assertEq(ruleNames.length, 0);
    }

    function test_IsCanonAuthor() public {
        uint256 novelId = _createNovel();

        // Creator is canon author from genesis
        assertTrue(novelCore.isCanonAuthor(novelId, creator));

        // Others are not yet
        assertFalse(novelCore.isCanonAuthor(novelId, author1));

        // After epoch, canon chapter authors become canon
        _runFullEpoch(novelId);
        assertTrue(novelCore.isCanonAuthor(novelId, author1));
    }
}
