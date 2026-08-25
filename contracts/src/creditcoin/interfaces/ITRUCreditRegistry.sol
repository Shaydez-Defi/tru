// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @notice Sole interface TRUUniversalContract uses to forward verified repayments.
///         Kept in its own file so TRUUniversalContract and TRUCreditRegistry only
///         couple through this interface — no logic leaks across (AGENTS.md rule 6).
interface ITRUCreditRegistry {
    function recordVerifiedRepayment(
        bytes32 queryId,
        address borrower,
        uint256 loanId,
        uint256 amount,
        uint64 sourceChain,
        bytes32 sourceTxHash,
        uint64 sourceBlock
    ) external;

    function getEventCount(address borrower) external view returns (uint256);
    function getEvents(
        address borrower,
        uint256 offset,
        uint256 limit
    ) external view returns (VerifiedFinancialEvent[] memory);

    // VerifiedFinancialEvent struct must be known to callers.
    // Defined here for interface compatibility.
    enum EventType {
        Repayment
    }

    struct VerifiedFinancialEvent {
        bytes32 eventId;
        address borrower;
        uint64 sourceChain;
        bytes32 sourceTxHash;
        uint64 sourceBlock;
        uint256 loanId;
        EventType eventType;
        uint256 amount;
        uint256 verifiedAt;
    }
}