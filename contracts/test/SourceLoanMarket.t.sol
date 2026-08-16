// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { Test } from "forge-std/Test.sol";
import { SourceLoanMarket } from "../src/sepolia/SourceLoanMarket.sol";

contract SourceLoanMarketTest is Test {
    SourceLoanMarket internal market;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant PRINCIPAL = 1_000 ether;
    uint256 internal constant DUE = 7 days;

    function setUp() public {
        market = new SourceLoanMarket();
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    function test_createLoan() public {
        vm.prank(alice);
        uint256 loanId = market.createLoan(PRINCIPAL, block.timestamp + DUE);

        assertEq(loanId, 0);
        (uint256 id, address borrower, uint256 principal, uint256 due, bool active) = market.loans(loanId);
        assertEq(id, 0);
        assertEq(borrower, alice);
        assertEq(principal, PRINCIPAL);
        assertEq(due, block.timestamp + DUE);
        assertTrue(active);
    }

    function test_createLoanEmitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit SourceLoanMarket.LoanCreated(0, alice, PRINCIPAL, block.timestamp + DUE);
        market.createLoan(PRINCIPAL, block.timestamp + DUE);
    }

    function test_repayLoan() public {
        vm.prank(alice);
        uint256 loanId = market.createLoan(PRINCIPAL, block.timestamp + DUE);

        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit SourceLoanMarket.LoanRepaid(alice, loanId, 1 ether);
        market.repayLoan{value: 1 ether}(loanId);

        (, , , , bool active) = market.loans(loanId);
        assertFalse(active);
    }

    function test_repayNonExistentLoanReverts() public {
        vm.prank(alice);
        vm.expectRevert("Loan not active");
        market.repayLoan{value: 1 ether}(99);
    }

    function test_repaySomeoneElsesLoanReverts() public {
        vm.prank(alice);
        uint256 loanId = market.createLoan(PRINCIPAL, block.timestamp + DUE);

        vm.prank(bob);
        vm.expectRevert("Not borrower");
        market.repayLoan{value: 1 ether}(loanId);
    }

    function test_repayAlreadyRepaidLoanReverts() public {
        vm.prank(alice);
        uint256 loanId = market.createLoan(PRINCIPAL, block.timestamp + DUE);

        vm.prank(alice);
        market.repayLoan{value: 1 ether}(loanId);

        vm.prank(alice);
        vm.expectRevert("Loan not active");
        market.repayLoan{value: 1 ether}(loanId);
    }

    function test_repayWithZeroValueReverts() public {
        vm.prank(alice);
        uint256 loanId = market.createLoan(PRINCIPAL, block.timestamp + DUE);

        vm.prank(alice);
        vm.expectRevert("Repay amount must be > 0");
        market.repayLoan(loanId);
    }
}