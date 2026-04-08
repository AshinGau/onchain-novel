// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TestBase} from "./Integration.t.sol";
import {DataTypes} from "../src/libraries/DataTypes.sol";

/// @title GasProfileTest
/// @notice Gas benchmarks for protocol operations
contract GasProfileTest is TestBase {
    // ----------------------------------------------------------
    //  Novel creation gas
    // ----------------------------------------------------------
    function test_gas_novelCreation() public {
        DataTypes.NovelConfig memory config = _defaultConfig();
        DataTypes.NovelMetadata memory metadata = _defaultMetadata();
        DataTypes.ContentSubmission memory sub = _makeContent("root chapter content for novel");

        vm.prank(creator);
        uint256 gasBefore = gasleft();
        novelCore.createNovel{value: 1 ether}(config, metadata, sub);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("Gas: createNovel", gasUsed);
    }

    // ----------------------------------------------------------
    //  Chapter submission gas
    // ----------------------------------------------------------
    function test_gas_chapterSubmission() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;
        DataTypes.ContentSubmission memory sub = _makeContent("chapter submission gas test!");

        vm.prank(author1);
        uint256 gasBefore = gasleft();
        novelCore.submitChapter{value: SUBMISSION_FEE}(novelId, rootId, sub);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("Gas: submitChapter", gasUsed);
    }

    // ----------------------------------------------------------
    //  startRound DFS with small tree (~5 chapters)
    // ----------------------------------------------------------
    function test_gas_startRound_smallTree() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        _submitChapter(author1, novelId, rootId, "small tree ch2 gas test!!");
        _submitChapter(author2, novelId, rootId, "small tree ch3 gas test!!");
        uint64 ch2 = 2;
        _submitChapter(author1, novelId, ch2, "small tree ch4 gas test!!");
        _submitChapter(author2, novelId, ch2, "small tree ch5 gas test!!");

        vm.prank(keeper);
        uint256 gasBefore = gasleft();
        novelCore.startRound(novelId);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("Gas: startRound (5 chapters)", gasUsed);
    }

    // ----------------------------------------------------------
    //  startRound DFS with medium tree (~20 chapters)
    // ----------------------------------------------------------
    function test_gas_startRound_mediumTree() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;

        // Build a tree with ~20 chapters
        uint64 current = rootId;
        for (uint256 i = 0; i < 10; i++) {
            current = _submitChapter(
                i % 2 == 0 ? author1 : author2,
                novelId,
                current,
                bytes(string(abi.encodePacked("medium tree chapter number ", bytes1(uint8(48 + i)))))
            );
        }
        // Add some branches
        uint64 branch = rootId;
        for (uint256 i = 0; i < 8; i++) {
            branch = _submitChapter(
                author3,
                novelId,
                i == 0 ? rootId : branch,
                bytes(string(abi.encodePacked("branch chapter for gas num ", bytes1(uint8(48 + i)))))
            );
        }

        vm.prank(keeper);
        uint256 gasBefore = gasleft();
        novelCore.startRound(novelId);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("Gas: startRound (20 chapters)", gasUsed);
    }

    // ----------------------------------------------------------
    //  Voting gas (commit + reveal)
    // ----------------------------------------------------------
    function test_gas_voting() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;
        uint64 ch2 = _submitChapter(author1, novelId, rootId, "voting gas benchmark chapter");

        vm.prank(keeper);
        novelCore.startRound(novelId);

        vm.warp(block.timestamp + NOMINATE_DURATION + 1);
        vm.prank(keeper);
        novelCore.closeNomination(novelId);

        DataTypes.RoundData memory rd = novelCore.getRoundData(novelId, 1);
        uint64 target = rd.candidates[0];
        bytes32 salt = bytes32("gassalt");
        bytes32 commitHash = keccak256(abi.encodePacked(target, salt));

        // Commit gas
        vm.prank(voter1);
        uint256 gasBefore = gasleft();
        novelCore.commitVote{value: VOTE_STAKE}(novelId, commitHash);
        uint256 commitGas = gasBefore - gasleft();

        emit log_named_uint("Gas: commitVote", commitGas);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        vm.prank(keeper);
        novelCore.closeCommit(novelId);

        // Reveal gas
        vm.prank(voter1);
        gasBefore = gasleft();
        novelCore.revealVote(novelId, target, salt);
        uint256 revealGas = gasBefore - gasleft();

        emit log_named_uint("Gas: revealVote", revealGas);
    }

    // ----------------------------------------------------------
    //  settleRound gas
    // ----------------------------------------------------------
    function test_gas_settleRound() public {
        uint64 novelId = _createNovel();
        uint64 rootId = 1;
        uint64 ch2 = _submitChapter(author1, novelId, rootId, "settle gas benchmark ch!!");
        uint64 ch3 = _submitChapter(author2, novelId, rootId, "settle gas second branch!!");

        vm.prank(keeper);
        novelCore.startRound(novelId);

        vm.warp(block.timestamp + NOMINATE_DURATION + 1);
        vm.prank(keeper);
        novelCore.closeNomination(novelId);

        DataTypes.RoundData memory rd = novelCore.getRoundData(novelId, 1);
        uint64 target = rd.candidates[0];
        bytes32 salt = bytes32("settlegas");
        bytes32 commitHash = keccak256(abi.encodePacked(target, salt));

        vm.prank(voter1);
        novelCore.commitVote{value: VOTE_STAKE}(novelId, commitHash);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        vm.prank(keeper);
        novelCore.closeCommit(novelId);

        vm.prank(voter1);
        novelCore.revealVote(novelId, target, salt);

        vm.warp(block.timestamp + REVEAL_DURATION + 1);

        vm.prank(keeper);
        uint256 gasBefore = gasleft();
        novelCore.settleRound(novelId);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("Gas: settleRound", gasUsed);
    }
}
