// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @notice Sole interface TRUUniversalContract uses to forward verified repayments.
///         Kept in its own file so TRUUniversalContract and TRUCreditRegistry only
///         couple through this interface — no logic leaks across (AGENTS.md rule 6).
interface ITRUCreditRegistry {
    function recordVerifiedRepayment(bytes32 queryId, address borrower, uint256 loanId, uint256 amount) external;
}