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
    // EventType extensible; Repayment is first, Origination added for loan lifecycle (phase 9).
    enum EventType {
        Repayment,
        Origination
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

    // CreditState thresholds (deterministic, documented):
    //   NEW         = 0 repayments
    //   BUILDING    = 1-2 repayments
    //   ESTABLISHED = 3-5 repayments
    //   VERIFIED    = 6+ repayments
    enum CreditState {
        NEW,
        BUILDING,
        ESTABLISHED,
        VERIFIED
    }

    struct CreditEvidence {
        CreditState creditState;
        uint256 repayments;
        uint256 totalRepaid;
        uint256 creditLimit;
        uint256 distinctLoansRepaid;
        uint256 failedOrRejectedEvents;
    }

    function getCreditEvidence(address borrower) external view returns (CreditEvidence memory);

    // Loan lifecycle (phase 9): verified origination -> Active, verified repayment -> Repaid
    enum LoanStatus {
        NONE,
        ACTIVE,
        REPAID
    }

    struct CreditPassport {
        CreditEvidence evidence;
        VerifiedFinancialEvent[] loanHistory;
        uint256 outstandingObligations;
        uint64[] verifiedSourceChains;
    }

    function recordVerifiedLoanOrigination(
        bytes32 queryId,
        address borrower,
        uint256 loanId,
        uint256 principal,
        uint256 dueTimestamp,
        uint64 sourceChain,
        bytes32 sourceTxHash,
        uint64 sourceBlock
    ) external;

    function getLoanStatus(address borrower, uint256 loanId) external view returns (LoanStatus);
    function getOutstandingObligations(address borrower) external view returns (uint256);
    function getCreditPassport(address borrower) external view returns (CreditPassport memory);
}