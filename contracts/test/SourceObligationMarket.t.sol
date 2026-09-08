// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { Test } from "forge-std/Test.sol";
import { SourceObligationMarket } from "../src/sepolia/SourceObligationMarket.sol";

contract SourceObligationMarketTest is Test {
    SourceObligationMarket internal market;
    address internal requester = makeAddr("requester");
    address internal executor = makeAddr("executor");
    address internal other = makeAddr("other");

    function setUp() public {
        market = new SourceObligationMarket();
        vm.deal(requester, 10 ether);
        vm.deal(executor, 10 ether);
    }

    function test_createObligation() public {
        vm.prank(requester);
        uint256 id = market.createObligation(executor, 1000, block.timestamp + 1000);
        assertEq(id, 0);
        (uint256 oid, address req, address exec, uint256 val, uint256 deadline, uint8 status) = market.obligations(0);
        assertEq(oid, 0);
        assertEq(req, requester);
        assertEq(exec, executor);
        assertEq(val, 1000);
        assertEq(status, 1);
    }

    function test_createObligationEmitsEvent() public {
        vm.prank(requester);
        vm.expectEmit(true, true, true, true);
        emit SourceObligationMarket.ObligationCreated(0, requester, executor, 1000, block.timestamp + 1000);
        market.createObligation(executor, 1000, block.timestamp + 1000);
    }

    function test_completeObligation() public {
        vm.prank(requester);
        market.createObligation(executor, 1000, block.timestamp + 1000);
        vm.prank(executor);
        market.completeObligation(0);
        (, , , , , uint8 status) = market.obligations(0);
        assertEq(status, 2);
    }

    function test_completeObligationOnlyExecutor() public {
        vm.prank(requester);
        market.createObligation(executor, 1000, block.timestamp + 1000);
        vm.prank(other);
        vm.expectRevert("Not executor");
        market.completeObligation(0);
    }

    function test_failObligation() public {
        vm.prank(requester);
        market.createObligation(executor, 1000, block.timestamp + 1000);
        vm.prank(requester);
        market.failObligation(0);
        (, , , , , uint8 status) = market.obligations(0);
        assertEq(status, 3);
    }

    function test_createObligationRequiresValue() public {
        vm.prank(requester);
        vm.expectRevert("Value must be > 0");
        market.createObligation(executor, 0, block.timestamp + 1000);
    }

    function test_createObligationRequiresFutureDeadline() public {
        vm.prank(requester);
        vm.expectRevert("Deadline must be in future");
        market.createObligation(executor, 1000, block.timestamp);
    }
}
