// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IReportRegistry} from "../interfaces/IReportRegistry.sol";

/// @title ReportRegistry
/// @notice Bond-based plagiarism/abuse reporting contract. Reporters post a bond that is returned
///         if the report is upheld, or forfeited if rejected.
contract ReportRegistry is Initializable, OwnableUpgradeable, UUPSUpgradeable, IReportRegistry {
    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Minimum bond amount required when filing a report
    uint256 public minBondAmount;

    /// @notice Report counter (also used as next report ID)
    uint256 private _reportCount;

    /// @notice Report ID => Report data
    mapping(uint256 => Report) private _reports;

    /// @notice Total forfeited bonds available for withdrawal
    uint256 public forfeitedBalance;

    // ============================================================
    //                         ERRORS
    // ============================================================

    error BondTooSmall(uint256 sent, uint256 minimum);
    error ReportNotFound(uint256 reportId);
    error ReportAlreadyResolved(uint256 reportId);
    error TransferFailed();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientForfeitedBalance(uint256 requested, uint256 available);

    // ============================================================
    //                      INITIALIZER
    // ============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, uint256 minBondAmount_) external initializer {
        __Ownable_init(owner_);

        minBondAmount = minBondAmount_;
    }

    // ============================================================
    //                     ADMIN FUNCTIONS
    // ============================================================

    /// @inheritdoc IReportRegistry
    function setMinBondAmount(uint256 amount) external onlyOwner {
        uint256 oldAmount = minBondAmount;
        minBondAmount = amount;
        emit MinBondAmountUpdated(oldAmount, amount);
    }

    /// @inheritdoc IReportRegistry
    function withdrawForfeited(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > forfeitedBalance) revert InsufficientForfeitedBalance(amount, forfeitedBalance);

        forfeitedBalance -= amount;

        (bool success,) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    // ============================================================
    //                         ACTIONS
    // ============================================================

    /// @inheritdoc IReportRegistry
    function reportContent(uint256 novelId, uint256 chapterId, bytes32 evidenceHash)
        external
        payable
        returns (uint256 reportId)
    {
        if (msg.value < minBondAmount) revert BondTooSmall(msg.value, minBondAmount);

        reportId = ++_reportCount;

        _reports[reportId] = Report({
            novelId: novelId,
            chapterId: chapterId,
            reporter: msg.sender,
            evidenceHash: evidenceHash,
            bondAmount: msg.value,
            resolved: false,
            upheld: false
        });

        emit ContentReported(reportId, novelId, chapterId, msg.sender);
    }

    /// @inheritdoc IReportRegistry
    function resolveReport(uint256 reportId, bool upheld) external onlyOwner {
        Report storage report = _reports[reportId];
        if (report.reporter == address(0)) revert ReportNotFound(reportId);
        if (report.resolved) revert ReportAlreadyResolved(reportId);

        report.resolved = true;
        report.upheld = upheld;

        if (upheld) {
            // Return bond to reporter
            (bool success,) = report.reporter.call{value: report.bondAmount}("");
            if (!success) revert TransferFailed();
        } else {
            // Bond is forfeited
            forfeitedBalance += report.bondAmount;
            emit BondForfeited(reportId, report.bondAmount);
        }

        emit ReportResolved(reportId, upheld);
    }

    // ============================================================
    //                          QUERIES
    // ============================================================

    /// @inheritdoc IReportRegistry
    function getReport(uint256 reportId) external view returns (Report memory) {
        return _reports[reportId];
    }

    // ============================================================
    //                         UPGRADE
    // ============================================================

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ============================================================
    //                       STORAGE GAP
    // ============================================================

    uint256[50] private __gap;
}
