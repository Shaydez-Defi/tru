// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { ITRUCreditRegistry } from "./interfaces/ITRUCreditRegistry.sol";

/// @title TRUCreditRegistry
/// @notice Creditcoin-side credit history registry. Receives ONLY verified
///         repayment facts from TRUUniversalContract and updates credit profiles.
///         Per AGENTS.md rule 6 this contract contains NO proof/verification logic
///         and no credit-scoring logic (creditLimit is a stub until build-order
///         step 6).
contract TRUCreditRegistry is ITRUCreditRegistry {
    struct CreditProfile {
        uint256 repayments;
        uint256 totalRepaid;
        uint256 activeLoans;
        uint256 creditLimit;
    }

    address public owner;
    address public universalContract;

    mapping(address => CreditProfile) public profiles;

    /// @dev Replay protection: a queryId (keccak of chainKey, blockHeight, txIndex)
    ///      computed by TRUUniversalContract may only be recorded once.
    mapping(bytes32 => bool) public processedRepayments;

    /// @dev Duplicate protection (separate from replay): a given loanId may be
    ///      credited to a borrower's profile at most once, regardless of which
    ///      code path delivers it.
    mapping(address => mapping(uint256 => bool)) public countedLoans;

    event RepaymentRecorded(bytes32 indexed queryId, address indexed borrower, uint256 loanId, uint256 amount);

    modifier onlyUniversalContract() {
        require(msg.sender == universalContract, "Only TRUUniversalContract");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Sets the TRUUniversalContract allowed to record verified repayments.
    function setUniversalContract(address uc) external onlyOwner {
        universalContract = uc;
    }

    /// @notice Records a USC-verified repayment. Callable ONLY by TRUUniversalContract.
    /// @dev The caller is trusted to pass a correctly derived queryId; the registry
    ///      does no proof/verification work itself, it only enforces single-recording.
    function recordVerifiedRepayment(bytes32 queryId, address borrower, uint256 loanId, uint256 amount)
        external
        onlyUniversalContract
    {
        require(!processedRepayments[queryId], "Repayment already recorded");
        processedRepayments[queryId] = true;

        // Duplicate protection: a loanId counts toward a borrower's profile once.
        require(!countedLoans[borrower][loanId], "Loan already credited");
        countedLoans[borrower][loanId] = true;

        CreditProfile storage profile = profiles[borrower];
        profile.repayments += 1;
        profile.totalRepaid += amount;
        // activeLoans / creditLimit are intentionally left at 0 (build-order step 6).

        emit RepaymentRecorded(queryId, borrower, loanId, amount);
    }
}