// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @title SourceLoanMarket
/// @notice Source-chain (Ethereum Sepolia) loan market.
///         Per AGENTS.md rule 6 this contract knows NOTHING about Creditcoin,
///         USC, or TRU. It only manages loans and emits LoanRepaid events.
contract SourceLoanMarket {
    struct Loan {
        uint256 id;
        address borrower;
        uint256 principal;
        uint256 due;
        bool active;
    }

    event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 due);
    event LoanRepaid(address indexed borrower, uint256 indexed loanId, uint256 amount);

    uint256 public loanCounter;
    mapping(uint256 => Loan) public loans;

    /// @notice Creates a loan for msg.sender. Returns the new loanId.
    function createLoan(uint256 principal, uint256 dueTimestamp) external returns (uint256 loanId) {
        require(principal > 0, "Principal must be > 0");
        require(dueTimestamp > block.timestamp, "Due must be in the future");

        loanId = loanCounter++;
        loans[loanId] = Loan({id: loanId, borrower: msg.sender, principal: principal, due: dueTimestamp, active: true});

        emit LoanCreated(loanId, msg.sender, principal, dueTimestamp);
    }

    /// @notice Repays a loan the caller owns. The repaid amount is msg.value and
    ///         is what gets emitted in LoanRepaid.
    function repayLoan(uint256 loanId) external payable {
        Loan storage loan = loans[loanId];
        require(loan.active, "Loan not active");
        require(loan.borrower == msg.sender, "Not borrower");
        require(msg.value > 0, "Repay amount must be > 0");

        loan.active = false;

        emit LoanRepaid(loan.borrower, loanId, msg.value);
    }
}