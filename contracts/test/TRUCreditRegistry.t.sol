// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { Test } from "forge-std/Test.sol";
import { TRUCreditRegistry } from "../src/creditcoin/TRUCreditRegistry.sol";
import { ITRUCreditRegistry } from "../src/creditcoin/interfaces/ITRUCreditRegistry.sol";

contract TRUCreditRegistryTest is Test {
    TRUCreditRegistry internal registry;

    address internal owner = makeAddr("owner");
    address internal universalContract = makeAddr("universalContract");
    address internal randomCaller = makeAddr("randomCaller");
    address internal borrower = makeAddr("borrower");

    bytes32 internal constant QUERY_ID_1 = keccak256("chain-1-height-1-tx-1");
    bytes32 internal constant QUERY_ID_2 = keccak256("chain-1-height-1-tx-2");
    bytes32 internal constant SOURCE_TX_HASH_1 = keccak256("tx-1");
    bytes32 internal constant SOURCE_TX_HASH_2 = keccak256("tx-2");
    uint64 internal constant CHAIN_KEY = 1;
    uint64 internal constant SOURCE_BLOCK = 100;

    function setUp() public {
        vm.prank(owner);
        registry = new TRUCreditRegistry();

        vm.prank(owner);
        registry.setUniversalContract(universalContract);
    }

    function _recordRepayment(bytes32 queryId, address borrower_, uint256 loanId, uint256 amount, bytes32 txHash) internal {
        vm.prank(universalContract);
        registry.recordVerifiedRepayment(queryId, borrower_, loanId, amount, CHAIN_KEY, txHash, SOURCE_BLOCK);
    }

    function test_verifiedRepaymentUpdatesProfile() public {
        _recordRepayment(QUERY_ID_1, borrower, 42, 500, SOURCE_TX_HASH_1);

        (uint256 repayments, uint256 totalRepaid, uint256 creditLimit) = registry.profiles(borrower);
        assertEq(repayments, 1);
        assertEq(totalRepaid, 500);
        // Credit rule (step 6): creditLimit = BASE_LIMIT + repayments * INCREMENT_PER_REPAYMENT.
        assertEq(creditLimit, registry.BASE_LIMIT() + 1 * registry.INCREMENT_PER_REPAYMENT());
        assertEq(creditLimit, 100); // first verified repayment: 0 -> 100
    }

    function test_verifiedRepaymentsAccumulate() public {
        _recordRepayment(QUERY_ID_1, borrower, 42, 500, SOURCE_TX_HASH_1);
        _recordRepayment(QUERY_ID_2, borrower, 43, 300, SOURCE_TX_HASH_2);

        (uint256 repayments, uint256 totalRepaid, uint256 creditLimit) = registry.profiles(borrower);
        assertEq(repayments, 2);
        assertEq(totalRepaid, 800);
        assertEq(creditLimit, 200); // 2 verified repayments * 100
    }

    function test_thirdVerifiedRepaymentSetsCreditLimitTo300() public {
        bytes32 q3 = keccak256("chain-1-height-1-tx-3");
        bytes32 q4 = keccak256("chain-1-height-1-tx-4");
        bytes32 q5 = keccak256("chain-1-height-1-tx-5");
        bytes32 tx3 = keccak256("tx-3");
        bytes32 tx4 = keccak256("tx-4");
        bytes32 tx5 = keccak256("tx-5");

        _recordRepayment(QUERY_ID_1, borrower, 42, 100, SOURCE_TX_HASH_1);
        _recordRepayment(QUERY_ID_2, borrower, 43, 100, SOURCE_TX_HASH_2);
        _recordRepayment(q3, borrower, 44, 100, tx3);

        (, , uint256 creditLimit) = registry.profiles(borrower);
        assertEq(creditLimit, 300); // 3 verified repayments * 100

        // A fourth verified repayment (distinct loan, distinct query) keeps scaling.
        _recordRepayment(q4, borrower, 45, 100, tx4);
        (, , creditLimit) = registry.profiles(borrower);
        assertEq(creditLimit, 400);

        _recordRepayment(q5, borrower, 46, 100, tx5);
        (, , creditLimit) = registry.profiles(borrower);
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
        registry.recordVerifiedRepayment(QUERY_ID_1, borrower, 42, 500, CHAIN_KEY, SOURCE_TX_HASH_1, SOURCE_BLOCK);
    }

    function test_unconfiguredContractCannotRecord() public {
        vm.prank(owner);
        registry.setUniversalContract(address(0));

        vm.prank(universalContract);
        vm.expectRevert("Only TRUUniversalContract");
        registry.recordVerifiedRepayment(QUERY_ID_1, borrower, 42, 500, CHAIN_KEY, SOURCE_TX_HASH_1, SOURCE_BLOCK);
    }

    function test_sameRepaymentCannotBeRecordedTwice() public {
        _recordRepayment(QUERY_ID_1, borrower, 42, 500, SOURCE_TX_HASH_1);

        vm.prank(universalContract);
        vm.expectRevert("Repayment already recorded");
        registry.recordVerifiedRepayment(QUERY_ID_1, borrower, 42, 500, CHAIN_KEY, SOURCE_TX_HASH_1, SOURCE_BLOCK);

        (uint256 repayments, uint256 totalRepaid, uint256 creditLimit) = registry.profiles(borrower);
        assertEq(repayments, 1);
        assertEq(totalRepaid, 500);
    }

    function test_setUniversalContractOwnerOnly() public {
        vm.prank(randomCaller);
        vm.expectRevert("Only owner");
        registry.setUniversalContract(randomCaller);
    }

    function test_sameLoanIdCannotBeCreditedTwiceViaDifferentQueries() public {
        _recordRepayment(QUERY_ID_1, borrower, 42, 500, SOURCE_TX_HASH_1);

        // Same borrower + same loanId, but a different (never-seen) queryId —
        // different code path than replay. Must still be rejected.
        vm.prank(universalContract);
        vm.expectRevert("Loan already credited");
        registry.recordVerifiedRepayment(QUERY_ID_2, borrower, 42, 600, CHAIN_KEY, SOURCE_TX_HASH_2, SOURCE_BLOCK);

        (uint256 repayments, uint256 totalRepaid, ) = registry.profiles(borrower);
        assertEq(repayments, 1);
        assertEq(totalRepaid, 500);
    }

    function test_sameLoanIdDifferentBorrowersAllowed() public {
        address otherBorrower = makeAddr("otherBorrower");

        _recordRepayment(QUERY_ID_1, borrower, 42, 500, SOURCE_TX_HASH_1);

        // A different borrower repaying their own distinct loan #42 is a different
        // loan (loanIds are globally unique per SourceLoanMarket).
        _recordRepayment(QUERY_ID_2, otherBorrower, 42, 700, SOURCE_TX_HASH_2);

        (uint256 repayments, uint256 totalRepaid, ) = registry.profiles(otherBorrower);
        assertEq(repayments, 1);
        assertEq(totalRepaid, 700);
    }

    function test_sameLoanIdDifferentQueriesWithDifferentBorrowerCounted() public {
        // Regression guard for the countedLoans key: (borrower, loanId) pairs, not
        // just loanId, so a borrower's own distinct loans still accumulate.
        _recordRepayment(QUERY_ID_1, borrower, 1, 100, SOURCE_TX_HASH_1);
        _recordRepayment(QUERY_ID_2, borrower, 2, 200, SOURCE_TX_HASH_2);

        (uint256 repayments, uint256 totalRepaid, ) = registry.profiles(borrower);
        assertEq(repayments, 2);
        assertEq(totalRepaid, 300);
    }

    // ===== Event History Tests (Phase 7) =====

    function test_verifiedRepaymentCreatesEventRecord() public {
        _recordRepayment(QUERY_ID_1, borrower, 42, 500, SOURCE_TX_HASH_1);

        uint256 eventCount = registry.getEventCount(borrower);
        assertEq(eventCount, 1);

        TRUCreditRegistry.VerifiedFinancialEvent[] memory events = registry.getEvents(borrower, 0, 10);
        assertEq(events.length, 1);

        TRUCreditRegistry.VerifiedFinancialEvent memory evt = events[0];
        assertEq(evt.eventId, QUERY_ID_1);
        assertEq(evt.borrower, borrower);
        assertEq(evt.sourceChain, CHAIN_KEY);
        assertEq(evt.sourceTxHash, SOURCE_TX_HASH_1);
        assertEq(evt.sourceBlock, SOURCE_BLOCK);
        assertEq(evt.loanId, 42);
        assertEq(uint8(evt.eventType), uint8(ITRUCreditRegistry.EventType.Repayment));
        assertEq(evt.amount, 500);
        assertGt(evt.verifiedAt, 0);
    }

    function test_multipleRepaymentsCreateMultipleEventRecords() public {
        _recordRepayment(QUERY_ID_1, borrower, 42, 500, SOURCE_TX_HASH_1);
        _recordRepayment(QUERY_ID_2, borrower, 43, 300, SOURCE_TX_HASH_2);

        uint256 eventCount = registry.getEventCount(borrower);
        assertEq(eventCount, 2);

        TRUCreditRegistry.VerifiedFinancialEvent[] memory events = registry.getEvents(borrower, 0, 10);
        assertEq(events.length, 2);

        // Most recent first (reverse chronological)
        assertEq(events[0].loanId, 43);
        assertEq(events[1].loanId, 42);
    }

    function test_eventHistoryPagination() public {
        bytes32 q3 = keccak256("chain-1-height-1-tx-3");
        bytes32 q4 = keccak256("chain-1-height-1-tx-4");
        bytes32 tx3 = keccak256("tx-3");
        bytes32 tx4 = keccak256("tx-4");

        _recordRepayment(QUERY_ID_1, borrower, 42, 500, SOURCE_TX_HASH_1);
        _recordRepayment(QUERY_ID_2, borrower, 43, 300, SOURCE_TX_HASH_2);
        _recordRepayment(q3, borrower, 44, 200, tx3);
        _recordRepayment(q4, borrower, 45, 100, tx4);

        // Test first page (most recent 2)
        TRUCreditRegistry.VerifiedFinancialEvent[] memory page1 = registry.getEvents(borrower, 0, 2);
        assertEq(page1.length, 2);
        assertEq(page1[0].loanId, 45); // most recent
        assertEq(page1[1].loanId, 44);

        // Test second page (next 2)
        TRUCreditRegistry.VerifiedFinancialEvent[] memory page2 = registry.getEvents(borrower, 2, 2);
        assertEq(page2.length, 2);
        assertEq(page2[0].loanId, 43);
        assertEq(page2[1].loanId, 42);

        // Test offset beyond length returns empty
        TRUCreditRegistry.VerifiedFinancialEvent[] memory empty = registry.getEvents(borrower, 10, 2);
        assertEq(empty.length, 0);

        // Test limit larger than remaining
        TRUCreditRegistry.VerifiedFinancialEvent[] memory page3 = registry.getEvents(borrower, 3, 10);
        assertEq(page3.length, 1);
        assertEq(page3[0].loanId, 42);
    }

    function test_replayGuardStillWorksWithEventHistory() public {
        _recordRepayment(QUERY_ID_1, borrower, 42, 500, SOURCE_TX_HASH_1);

        vm.prank(universalContract);
        vm.expectRevert("Repayment already recorded");
        registry.recordVerifiedRepayment(QUERY_ID_1, borrower, 42, 500, CHAIN_KEY, SOURCE_TX_HASH_1, SOURCE_BLOCK);

        // Event count should still be 1
        assertEq(registry.getEventCount(borrower), 1);
        TRUCreditRegistry.VerifiedFinancialEvent[] memory events = registry.getEvents(borrower, 0, 10);
        assertEq(events.length, 1);
    }

    function test_duplicateLoanGuardStillWorksWithEventHistory() public {
        _recordRepayment(QUERY_ID_1, borrower, 42, 500, SOURCE_TX_HASH_1);

        vm.prank(universalContract);
        vm.expectRevert("Loan already credited");
        registry.recordVerifiedRepayment(QUERY_ID_2, borrower, 42, 600, CHAIN_KEY, SOURCE_TX_HASH_2, SOURCE_BLOCK);

        // Event count should still be 1
        assertEq(registry.getEventCount(borrower), 1);
    }

    function test_differentBorrowersHaveSeparateEventHistories() public {
        address otherBorrower = makeAddr("otherBorrower");
        _recordRepayment(QUERY_ID_1, borrower, 42, 500, SOURCE_TX_HASH_1);
        _recordRepayment(QUERY_ID_2, otherBorrower, 42, 700, SOURCE_TX_HASH_2);

        assertEq(registry.getEventCount(borrower), 1);
        assertEq(registry.getEventCount(otherBorrower), 1);

        TRUCreditRegistry.VerifiedFinancialEvent[] memory events1 = registry.getEvents(borrower, 0, 10);
        TRUCreditRegistry.VerifiedFinancialEvent[] memory events2 = registry.getEvents(otherBorrower, 0, 10);

        assertEq(events1[0].loanId, 42);
        assertEq(events1[0].borrower, borrower);
        assertEq(events2[0].loanId, 42);
        assertEq(events2[0].borrower, otherBorrower);
    }
}