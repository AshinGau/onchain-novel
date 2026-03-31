// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IReportRegistry
/// @notice Interface for content reporting mechanism (stub — not implemented in Phase 1)
/// @dev This interface defines the reporting API for future implementation.
///      Content verification (e.g., chapter length validation) happens off-chain.
///      Reports are submitted on-chain and resolved through arbitration.
interface IReportRegistry {
    // ============================================================
    //                          EVENTS
    // ============================================================

    event ContentReported(
        uint256 indexed reportId, uint256 indexed novelId, uint256 indexed chapterId, address reporter
    );
    event ReportResolved(uint256 indexed reportId, bool upheld);

    // ============================================================
    //                         ACTIONS
    // ============================================================

    /// @notice Report content for rule violation (e.g., length mismatch)
    /// @param novelId Novel ID
    /// @param chapterId Chapter ID being reported
    /// @param evidenceHash CID of off-chain evidence
    /// @return reportId The ID of the created report
    function reportContent(uint256 novelId, uint256 chapterId, bytes32 evidenceHash)
        external
        returns (uint256 reportId);

    /// @notice Resolve a report through arbitration
    /// @param reportId Report ID
    /// @param upheld Whether the report is upheld (true = violation confirmed)
    function resolveReport(uint256 reportId, bool upheld) external;
}
