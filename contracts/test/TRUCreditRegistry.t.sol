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
        // Credit rule (step 6): creditLimit = BASE_LIMIT + repayments * INCREMENT_PER_REPAYMENT.
        assertEq(creditLimit, registry.BASE_LIMIT() + 1 * registry.INCREMENT_PER_REPAYMENT());
        assertEq(creditLimit, 100); // first verified repayment: 0 -> 100
    }

    function test_verifiedRepaymentsAccumulate() public {
        vm.prank(universalContract);
        registry.recordVerifiedRepayment(QUERY_ID_1, borrower, 42, 500);

        vm.prank(universalContract);
        registry.recordVerifiedRepayment(QUERY_ID_2, borrower, 43, 300);

        (uint256 repayments, uint256 totalRepaid, , uint256 creditLimit) = registry.profiles(borrower);
        assertEq(repayments, 2);
        assertEq(totalRepaid, 800);
        assertEq(creditLimit, 200); // 2 verified repayments * 100
    }

    function test_thirdVerifiedRepaymentSetsCreditLimitTo300() public {
        bytes32 q3 = keccak256("chain-1-height-1-tx-3");
        bytes32 q4 = keccak256("chain-1-height-1-tx-4");
        bytes32 q5 = keccak256("chain-1-height-1-tx-5");

        vm.prank(universalContract);
        registry.recordVerifiedRepayment(QUERY_ID_1, borrower, 42, 100);
        vm.prank(universalContract);
        registry.recordVerifiedRepayment(QUERY_ID_2, borrower, 43, 100);
        vm.prank(universalContract);
        registry.recordVerifiedRepayment(q3, borrower, 44, 100);

        (, , , uint256 creditLimit) = registry.profiles(borrower);
        assertEq(creditLimit, 300); // 3 verified repayments * 100

        // A fourth verified repayment (distinct loan, distinct query) keeps scaling.
        vm.prank(universalContract);
        registry.recordVerifiedRepayment(q4, borrower, 45, 100);
        (, , , creditLimit) = registry.profiles(borrower);
        assertEq(creditLimit, 400);

        vm.prank(universalContract);
        registry.recordVerifiedRepayment(q5, borrower, 46, 100);
        (, , , creditLimit) = registry.profiles(borrower);
        assertEq(creditLimit, 500);
    }

    function test_creditLimitHasNoExternalSetter() public {
        // creditLimit must be read-only from outside: only recordVerifiedRepayment
        // (gated by onlyUniversalContract) writes it. Assert the deployed ABI
        // (compiled artifact) exposes no setter-style function by scanning the JSON
        // for any function name that could mutate creditLimit.
        string memory artifact = vm.readFile("out/TRUCreditRegistry.sol/TRUCreditRegistry.json");
        assertFalse(_contains(artifact, '"setCreditLimit"'), "found setCreditLimit in ABI");
        assertFalse(_contains(artifact, '"updateCreditLimit"'), "found updateCreditLimit in ABI");
        assertFalse(_contains(artifact, '"setProfile"'), "found setProfile in ABI");
        assertFalse(_contains(artifact, '"updateProfile"'), "found updateProfile in ABI");
        assertFalse(_contains(artifact, '"setCreditProfile"'), "found setCreditProfile in ABI");
        assertFalse(_contains(artifact, '"setBaseLimit"'), "found setBaseLimit in ABI");
        assertFalse(_contains(artifact, '"setIncrementPerRepayment"'), "found setIncrementPerRepayment in ABI");
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool matches = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    matches = false;
                    break;
                }
            }
            if (matches) return true;
        }
        return false;
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