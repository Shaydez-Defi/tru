// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { Test } from "forge-std/Test.sol";
import { TRUCreditRegistry } from "../src/creditcoin/TRUCreditRegistry.sol";
import { TRUFinancing } from "../src/creditcoin/TRUFinancing.sol";
import { ITRUCreditRegistry } from "../src/creditcoin/interfaces/ITRUCreditRegistry.sol";

contract TRUFinancingTest is Test {
    TRUCreditRegistry internal registry;
    TRUFinancing internal financing;

    address internal owner = makeAddr("owner");
    address internal universalContract = makeAddr("universalContract");
    address internal borrower = makeAddr("borrower");
    address internal freshBorrower = makeAddr("freshBorrower");

    bytes32 internal constant Q1 = keccak256("q1");
    bytes32 internal constant Q2 = keccak256("q2");
    bytes32 internal constant Q3 = keccak256("q3");
    bytes32 internal constant TX1 = keccak256("tx1");
    bytes32 internal constant TX2 = keccak256("tx2");
    bytes32 internal constant TX3 = keccak256("tx3");
    uint64 internal constant CHAIN_KEY = 1;
    uint64 internal constant SOURCE_BLOCK = 100;

    function setUp() public {
        vm.prank(owner);
        registry = new TRUCreditRegistry();
        vm.prank(owner);
        registry.setUniversalContract(universalContract);
        financing = new TRUFinancing(address(registry));
    }

    function _repay(address who, uint256 loanId, bytes32 q, bytes32 txh) internal {
        vm.prank(universalContract);
        registry.recordVerifiedRepayment(q, who, loanId, 100, CHAIN_KEY, txh, SOURCE_BLOCK);
    }

    function test_requestSucceedsWithinBounds() public {
        _repay(borrower, 1, Q1, TX1); // BUILDING, creditLimit 100
        vm.prank(borrower);
        uint256 id = financing.requestFinancing(50);
        assertEq(id, 0);
        TRUFinancing.FinancingRequest[] memory reqs = financing.getFinancingRequests(borrower);
        assertEq(reqs.length, 1);
        assertEq(reqs[0].amount, 50);
        assertEq(uint8(reqs[0].creditStateAtRequest), uint8(ITRUCreditRegistry.CreditState.BUILDING));
        assertEq(uint8(reqs[0].status), uint8(TRUFinancing.RequestStatus.APPROVED));
    }

    function test_requestRevertsForNewState() public {
        // freshBorrower has 0 repayments -> NEW
        vm.prank(freshBorrower);
        vm.expectRevert("Insufficient credit state");
        financing.requestFinancing(10);
    }

    function test_requestRevertsForAmountExceedingCreditLimit() public {
        _repay(borrower, 1, Q1, TX1); // limit 100
        vm.prank(borrower);
        vm.expectRevert("Amount exceeds credit limit");
        financing.requestFinancing(101);

        // exact limit should succeed
        vm.prank(borrower);
        financing.requestFinancing(100);
    }

    function test_multipleRequestsRecorded() public {
        _repay(borrower, 1, Q1, TX1);
        vm.prank(borrower);
        financing.requestFinancing(10);
        vm.prank(borrower);
        financing.requestFinancing(20);
        TRUFinancing.FinancingRequest[] memory reqs = financing.getFinancingRequests(borrower);
        assertEq(reqs.length, 2);
        assertEq(reqs[0].amount, 10);
        assertEq(reqs[1].amount, 20);
        assertEq(financing.getFinancingRequestCount(borrower), 2);
    }

    function test_creditStateAtRequestSnapshot() public {
        _repay(borrower, 1, Q1, TX1); // BUILDING
        vm.prank(borrower);
        financing.requestFinancing(10);
        // add two more repayments to move to ESTABLISHED
        _repay(borrower, 2, Q2, TX2);
        _repay(borrower, 3, Q3, TX3);
        vm.prank(borrower);
        financing.requestFinancing(10);

        TRUFinancing.FinancingRequest[] memory reqs = financing.getFinancingRequests(borrower);
        assertEq(reqs.length, 2);
        // first request snapshot remains BUILDING, second is ESTABLISHED
        assertEq(uint8(reqs[0].creditStateAtRequest), uint8(ITRUCreditRegistry.CreditState.BUILDING));
        assertEq(uint8(reqs[1].creditStateAtRequest), uint8(ITRUCreditRegistry.CreditState.ESTABLISHED));
    }

    function test_requestDoesNotDisburseFunds() public {
        _repay(borrower, 1, Q1, TX1);
        uint256 balBefore = borrower.balance;
        vm.prank(borrower);
        financing.requestFinancing(10);
        assertEq(borrower.balance, balBefore);
        // financing contract holds no funds
        assertEq(address(financing).balance, 0);
    }
}
