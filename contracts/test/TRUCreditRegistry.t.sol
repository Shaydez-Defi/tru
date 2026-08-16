// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { Test } from "forge-std/Test.sol";
import { TRUCreditRegistry } from "../src/creditcoin/TRUCreditRegistry.sol";

contract TRUCreditRegistryTest is Test {
    TRUCreditRegistry internal registry;

    address internal owner = makeAddr("owner");
    address internal universalContract = makeAddr("universalContract");
    address internal randomCaller = makeAddr("randomCaller");
    address internal borrower = makeAddr("borrower");

    bytes32 internal constant QUERY_ID_1 = keccak256("chain-1-height-1-tx-1");
    bytes32 internal constant QUERY_ID_2 = keccak256("chain-1-height-1-tx-2");

    function setUp() public {
        vm.prank(owner);
        registry = new TRUCreditRegistry();

        vm.prank(owner);
        registry.setUniversalContract(universalContract);
    }

    function test_verifiedRepaymentUpdatesProfile() public {
        vm.prank(universalContract);
        registry.recordVerifiedRepayment(QUERY_ID_1, borrower, 42, 500);

        (uint256 repayments, uint256 totalRepaid, uint256 activeLoans, uint256 creditLimit) = registry.profiles(borrower);
        assertEq(repayments, 1);
        assertEq(totalRepaid, 500);
        assertEq(activeLoans, 0); // stub, build-order step 6
        assertEq(creditLimit, 0); // stub, build-order step 6
    }

    function test_verifiedRepaymentsAccumulate() public {
        vm.prank(universalContract);
        registry.recordVerifiedRepayment(QUERY_ID_1, borrower, 42, 500);

        vm.prank(universalContract);
        registry.recordVerifiedRepayment(QUERY_ID_2, borrower, 43, 300);

        (uint256 repayments, uint256 totalRepaid, , ) = registry.profiles(borrower);
        assertEq(repayments, 2);
        assertEq(totalRepaid, 800);
    }

    function test_randomAddressCallReverts() public {
        vm.prank(randomCaller);
        vm.expectRevert("Only TRUUniversalContract");
        registry.recordVerifiedRepayment(QUERY_ID_1, borrower, 42, 500);
    }

    function test_unconfiguredContractCannotRecord() public {
        vm.prank(owner);
        registry.setUniversalContract(address(0));

        vm.prank(universalContract);
        vm.expectRevert("Only TRUUniversalContract");
        registry.recordVerifiedRepayment(QUERY_ID_1, borrower, 42, 500);
    }

    function test_sameRepaymentCannotBeRecordedTwice() public {
        vm.prank(universalContract);
        registry.recordVerifiedRepayment(QUERY_ID_1, borrower, 42, 500);

        vm.prank(universalContract);
        vm.expectRevert("Repayment already recorded");
        registry.recordVerifiedRepayment(QUERY_ID_1, borrower, 42, 500);

        (uint256 repayments, uint256 totalRepaid, uint256 activeLoans, uint256 creditLimit) = registry.profiles(borrower);
        assertEq(repayments, 1);
        assertEq(totalRepaid, 500);
    }

    function test_setUniversalContractOwnerOnly() public {
        vm.prank(randomCaller);
        vm.expectRevert("Only owner");
        registry.setUniversalContract(randomCaller);
    }

    function test_sameLoanIdCannotBeCreditedTwiceViaDifferentQueries() public {
        vm.prank(universalContract);
        registry.recordVerifiedRepayment(QUERY_ID_1, borrower, 42, 500);

        // Same borrower + same loanId, but a different (never-seen) queryId —
        // different code path than replay. Must still be rejected.
        vm.prank(universalContract);
        vm.expectRevert("Loan already credited");
        registry.recordVerifiedRepayment(QUERY_ID_2, borrower, 42, 600);

        (uint256 repayments, uint256 totalRepaid, , ) = registry.profiles(borrower);
        assertEq(repayments, 1);
        assertEq(totalRepaid, 500);
    }

    function test_sameLoanIdDifferentBorrowersAllowed() public {
        address otherBorrower = makeAddr("otherBorrower");

        vm.prank(universalContract);
        registry.recordVerifiedRepayment(QUERY_ID_1, borrower, 42, 500);

        // A different borrower repaying their own distinct loan #42 is a different
        // loan (loanIds are globally unique per SourceLoanMarket).
        vm.prank(universalContract);
        registry.recordVerifiedRepayment(QUERY_ID_2, otherBorrower, 42, 700);

        (uint256 repayments, uint256 totalRepaid, , ) = registry.profiles(otherBorrower);
        assertEq(repayments, 1);
        assertEq(totalRepaid, 700);
    }

    function test_sameLoanIdDifferentQueriesWithDifferentBorrowerCounted() public {
        // Regression guard for the countedLoans key: (borrower, loanId) pairs, not
        // just loanId, so a borrower's own distinct loans still accumulate.
        vm.prank(universalContract);
        registry.recordVerifiedRepayment(QUERY_ID_1, borrower, 1, 100);

        vm.prank(universalContract);
        registry.recordVerifiedRepayment(QUERY_ID_2, borrower, 2, 200);

        (uint256 repayments, uint256 totalRepaid, , ) = registry.profiles(borrower);
        assertEq(repayments, 2);
        assertEq(totalRepaid, 300);
    }
}