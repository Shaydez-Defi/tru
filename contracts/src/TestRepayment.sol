// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @notice Throwaway Phase 0 spike contract on Ethereum Sepolia.
///          Proves a real event can be produced and later verified through
///          Creditcoin USC/Attestcoin. No storage, no logic.
contract TestRepayment {
    event Repayment(address indexed borrower, uint256 indexed loanId, uint256 amount);

    function repay(uint256 loanId, uint256 amount) external {
        emit Repayment(msg.sender, loanId, amount);
    }
}