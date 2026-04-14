// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IRulesEngine} from "../interfaces/IRulesEngine.sol";
import {INovelCore} from "../interfaces/INovelCore.sol";
import {IPrizePool} from "../interfaces/IPrizePool.sol";
import {DataTypes} from "../libraries/DataTypes.sol";

/// @title RulesEngine
/// @notice World-building rules governance: creator rules + proposal-based rule changes.
///         Reads novel state from NovelCore via view calls.
///         Uses world-line authorship for voting eligibility.
contract RulesEngine is Initializable, OwnableUpgradeable, UUPSUpgradeable, IRulesEngine {
    // ============================================================
    //                         STORAGE
    // ============================================================

    INovelCore public novelCore;
    IPrizePool public prizePool;

    /// @notice Novel ID => rule name => rule content
    mapping(uint64 => mapping(string => string)) private _rules;

    /// @notice Novel ID => list of rule names (for enumeration)
    mapping(uint64 => string[]) private _ruleNames;

    /// @notice Novel ID => rule name => index+1 in _ruleNames (0 = not exists)
    mapping(uint64 => mapping(string => uint256)) private _ruleNameIndex;

    /// @notice Global rule proposal counter
    uint64 private _ruleProposalCount;

    /// @notice Proposal ID => proposal data
    mapping(uint64 => DataTypes.RuleProposal) private _ruleProposals;

    /// @notice Proposal ID => voter address => has voted
    mapping(uint64 => mapping(address => bool)) private _ruleProposalVotes;

    // ============================================================
    //                         ERRORS
    // ============================================================

    error NovelNotFound(uint64 novelId);
    error NovelNotActive(uint64 novelId);
    error NotNovelCreator(uint64 novelId, address caller);
    error CreatorRulesLocked(uint64 novelId);
    error InvalidRuleName();
    error InvalidRuleContent();
    error RuleNotFound(string name);
    error RuleAlreadyExists(string name);
    error ProposalNotFound(uint64 proposalId);
    error ProposalExpired(uint64 proposalId);
    error ProposalAlreadyExecuted(uint64 proposalId);
    error AlreadyVotedOnProposal(uint64 proposalId, address voter);
    error InsufficientRuleFee(uint256 sent, uint256 required);
    error ArrayLengthMismatch();

    // ============================================================
    //                      INITIALIZER
    // ============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address novelCore_, address prizePool_) external initializer {
        __Ownable_init(owner_);
        novelCore = INovelCore(novelCore_);
        prizePool = IPrizePool(prizePool_);
    }

    // ============================================================
    //                      ADMIN
    // ============================================================

    function setNovelCore(address addr) external onlyOwner {
        novelCore = INovelCore(addr);
    }

    function setPrizePool(address addr) external onlyOwner {
        prizePool = IPrizePool(addr);
    }

    // ============================================================
    //                   CREATOR RULES
    // ============================================================

    /// @inheritdoc IRulesEngine
    function setCreatorRules(uint64 novelId, string[] calldata names, string[] calldata contents) external {
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (novel.creator != msg.sender) revert NotNovelCreator(novelId, msg.sender);
        if (novel.currentRound != 0) revert CreatorRulesLocked(novelId);
        if (names.length != contents.length) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < names.length; i++) {
            if (bytes(names[i]).length == 0 || bytes(names[i]).length > 64) revert InvalidRuleName();
            if (bytes(contents[i]).length == 0) revert InvalidRuleContent();
            _setRule(novelId, names[i], contents[i]);
        }
    }

    // ============================================================
    //                   RULE PROPOSALS
    // ============================================================

    /// @inheritdoc IRulesEngine
    function proposeRule(
        uint64 novelId,
        DataTypes.RuleProposalType proposalType,
        string calldata ruleName,
        string calldata ruleContent,
        uint64[] calldata path
    ) external payable returns (uint64 proposalId) {
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        if (novel.id == 0) revert NovelNotFound(novelId);
        if (!novel.active) revert NovelNotActive(novelId);

        if (msg.value != novel.config.ruleFee) revert InsufficientRuleFee(msg.value, novel.config.ruleFee);
        if (bytes(ruleName).length == 0 || bytes(ruleName).length > 64) revert InvalidRuleName();

        if (proposalType == DataTypes.RuleProposalType.Add) {
            if (_ruleNameIndex[novelId][ruleName] != 0) revert RuleAlreadyExists(ruleName);
            if (bytes(ruleContent).length == 0) revert InvalidRuleContent();
        } else {
            if (_ruleNameIndex[novelId][ruleName] == 0) revert RuleNotFound(ruleName);
        }

        // Eligibility: path[0] must be a current worldLineAncestor and path[last] must be a chapter
        // authored by msg.sender. Reverts on failure.
        novelCore.verifyWorldLineAuthor(novelId, msg.sender, path);

        // Deposit fee to prize pool
        if (msg.value > 0) {
            prizePool.deposit{value: msg.value}(novelId, "rule_proposal");
        }

        proposalId = ++_ruleProposalCount;
        _ruleProposals[proposalId] = DataTypes.RuleProposal({
            id: proposalId,
            novelId: novelId,
            proposer: msg.sender,
            proposalType: proposalType,
            ruleName: ruleName,
            ruleContent: ruleContent,
            createdAt: uint64(block.timestamp),
            voteCount: 0,
            executed: false
        });

        emit RuleProposed(proposalId, novelId, msg.sender, uint8(proposalType), ruleName);
    }

    /// @inheritdoc IRulesEngine
    function voteOnRuleProposal(uint64 proposalId, uint64[] calldata path) external {
        DataTypes.RuleProposal storage proposal = _ruleProposals[proposalId];
        if (proposal.id == 0) revert ProposalNotFound(proposalId);
        if (proposal.executed) revert ProposalAlreadyExecuted(proposalId);

        uint64 novelId = proposal.novelId;
        DataTypes.Novel memory novel = novelCore.getNovel(novelId);
        if (!novel.active) revert NovelNotActive(novelId);

        if (block.timestamp > proposal.createdAt + novel.config.ruleVoteDuration) {
            revert ProposalExpired(proposalId);
        }

        // Eligibility: same proof requirement as proposeRule. Validity is point-in-time —
        // a vote that passes verification stays counted even if the world line later shifts.
        novelCore.verifyWorldLineAuthor(novelId, msg.sender, path);

        if (_ruleProposalVotes[proposalId][msg.sender]) revert AlreadyVotedOnProposal(proposalId, msg.sender);
        _ruleProposalVotes[proposalId][msg.sender] = true;
        proposal.voteCount++;

        emit RuleProposalVoted(proposalId, msg.sender, proposal.voteCount);

        // Auto-execute if quorum reached
        if (proposal.voteCount >= novel.config.ruleQuorum) {
            proposal.executed = true;
            if (proposal.proposalType == DataTypes.RuleProposalType.Add) {
                _setRule(novelId, proposal.ruleName, proposal.ruleContent);
            } else if (_ruleNameIndex[novelId][proposal.ruleName] != 0) {
                _deleteRule(novelId, proposal.ruleName);
            }
            emit RuleProposalExecuted(proposalId, novelId);
        }
    }

    // ============================================================
    //                        QUERIES
    // ============================================================

    /// @inheritdoc IRulesEngine
    function getRule(uint64 novelId, string calldata name) external view returns (string memory) {
        return _rules[novelId][name];
    }

    /// @inheritdoc IRulesEngine
    function getRuleNames(uint64 novelId) external view returns (string[] memory) {
        return _ruleNames[novelId];
    }

    /// @inheritdoc IRulesEngine
    function getRuleProposal(uint64 proposalId) external view returns (DataTypes.RuleProposal memory) {
        return _ruleProposals[proposalId];
    }

    // ============================================================
    //                    INTERNAL HELPERS
    // ============================================================

    function _setRule(uint64 novelId, string memory name, string memory content) internal {
        _rules[novelId][name] = content;
        if (_ruleNameIndex[novelId][name] == 0) {
            _ruleNames[novelId].push(name);
            _ruleNameIndex[novelId][name] = _ruleNames[novelId].length; // index+1
        }
        emit RuleSet(novelId, name);
    }

    function _deleteRule(uint64 novelId, string memory name) internal {
        uint256 indexPlusOne = _ruleNameIndex[novelId][name];
        if (indexPlusOne == 0) revert RuleNotFound(name);

        uint256 lastIdx = _ruleNames[novelId].length - 1;
        uint256 removeIdx = indexPlusOne - 1;
        if (removeIdx != lastIdx) {
            string memory lastName = _ruleNames[novelId][lastIdx];
            _ruleNames[novelId][removeIdx] = lastName;
            _ruleNameIndex[novelId][lastName] = indexPlusOne;
        }
        _ruleNames[novelId].pop();
        delete _ruleNameIndex[novelId][name];
        delete _rules[novelId][name];

        emit RuleDeleted(novelId, name);
    }

    // ============================================================
    //                     UUPS UPGRADE
    // ============================================================

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /// @dev Reserved storage gap for future upgrades
    uint256[43] private __gap;
}
