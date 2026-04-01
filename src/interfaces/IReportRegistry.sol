// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IReportRegistry
/// @notice Interface for bond-based plagiarism/abuse reporting mechanism
/// @dev Reporters must post a bond; upheld reports return the bond, rejected reports forfeit it.
interface IReportRegistry {
    // ============================================================
    //                          STRUCTS
    // ============================================================

    struct Report {
        uint256 novelId;
        uint256 chapterId;
        address reporter;
        bytes32 evidenceHash;
        uint256 bondAmount;
        bool resolved;
        bool upheld;
    }

    // ============================================================
    //                          EVENTS
    // ============================================================

    event ContentReported(
        uint256 indexed reportId, uint256 indexed novelId, uint256 indexed chapterId, address reporter
    );
    event ReportResolved(uint256 indexed reportId, bool upheld);
    event BondForfeited(uint256 indexed reportId, uint256 amount);
    event MinBondAmountUpdated(uint256 oldAmount, uint256 newAmount);

    // ============================================================
    //                         ACTIONS
    // ============================================================

    /// @notice Report content for rule violation (e.g., plagiarism, abuse)
    /// @param novelId Novel ID
    /// @param chapterId Chapter ID being reported
    /// @param evidenceHash CID of off-chain evidence
    /// @return reportId The ID of the created report
    function reportContent(uint256 novelId, uint256 chapterId, bytes32 evidenceHash)
        external
        payable
        returns (uint256 reportId);

    /// @notice Resolve a report through arbitration
    /// @param reportId Report ID
    /// @param upheld Whether the report is upheld (true = violation confirmed)
    function resolveReport(uint256 reportId, bool upheld) external;

    /// @notice Set the minimum bond amount required for reporting
    /// @param amount New minimum bond amount
    function setMinBondAmount(uint256 amount) external;

    /// @notice Withdraw forfeited bond funds
    /// @param to Recipient address
    /// @param amount Amount to withdraw
    function withdrawForfeited(address to, uint256 amount) external;

    /// @notice Get report details
    /// @param reportId Report ID
    /// @return report The report data
    function getReport(uint256 reportId) external view returns (Report memory report);
}
