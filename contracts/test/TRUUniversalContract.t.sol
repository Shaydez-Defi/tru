// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { Test } from "forge-std/Test.sol";
import { TRUUniversalContract, IEvmV1Decoder } from "../src/creditcoin/TRUUniversalContract.sol";

contract MockDecoder {
    uint8 public txType = 2;
    uint8 public receiptStatus = 1;
    IEvmV1Decoder.LogEntry public log;

    function getTransactionType(bytes calldata) external pure returns (uint8) {
        return 2;
    }

    function isValidTransactionType(uint8) external pure returns (bool) {
        return true;
    }

    function decodeReceiptFields(bytes calldata)
        external
        view
        returns (IEvmV1Decoder.ReceiptFields memory rf)
    {
        IEvmV1Decoder.LogEntry[] memory logs =
            new IEvmV1Decoder.LogEntry[](1);
        logs[0] = log;
        rf = IEvmV1Decoder.ReceiptFields(receiptStatus, 21000, logs, hex"");
    }

    function setLog(IEvmV1Decoder.LogEntry calldata l) external {
        log = l;
    }

    function setReceiptStatus(uint8 s) external {
        receiptStatus = s;
    }
}

contract TRUUniversalContractTest is Test {
    TRUUniversalContract internal uc;
    MockDecoder internal decoder;

    address internal sourceLoanMarket = makeAddr("sourceLoanMarket");
    address internal otherContract = makeAddr("otherContract");
    address internal borrower = makeAddr("borrower");
    uint256 internal constant LOAN_ID = 42;
    uint256 internal constant AMOUNT = 123456789;

    bytes32 internal constant SIG =
        0xc7ce0a35f17b490de2a317e7fecb2cae86b1abffb03800b2f492823521382698; // LoanRepaid(address,uint256,uint256)

    function setUp() public {
        decoder = new MockDecoder();
        uc = new TRUUniversalContract(address(decoder), address(0), sourceLoanMarket);

        bytes32[] memory topics = new bytes32[](3);
        topics[0] = SIG;
        topics[1] = bytes32(uint256(uint160(borrower)));
        topics[2] = bytes32(LOAN_ID);
        decoder.setLog(
            IEvmV1Decoder.LogEntry({address_: sourceLoanMarket, topics: topics, data: abi.encode(AMOUNT)})
        );
    }

    function test_decodeAcceptsSourceLoanMarketEmitter() public view {
        (address b, uint256 l, uint256 a) = uc.decodeRepayment(hex"1234");
        assertEq(b, borrower);
        assertEq(l, LOAN_ID);
        assertEq(a, AMOUNT);
    }

    function test_decodeRejectsForeignEmitter() public {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = SIG;
        topics[1] = bytes32(uint256(uint160(borrower)));
        topics[2] = bytes32(LOAN_ID);
        decoder.setLog(
            IEvmV1Decoder.LogEntry({address_: otherContract, topics: topics, data: abi.encode(AMOUNT)})
        );
        vm.expectRevert("Not SourceLoanMarket emitter");
        uc.decodeRepayment(hex"1234");
    }

    function test_decodeRejectsNonRepaymentSignature() public {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = keccak256("SomeOtherEvent(address,uint256,uint256)");
        topics[1] = bytes32(uint256(uint160(borrower)));
        topics[2] = bytes32(LOAN_ID);
        decoder.setLog(
            IEvmV1Decoder.LogEntry({address_: sourceLoanMarket, topics: topics, data: abi.encode(AMOUNT)})
        );
        vm.expectRevert("No Repayment event found");
        uc.decodeRepayment(hex"1234");
    }

    function test_decodeRejectsFailedTx() public {
        decoder.setReceiptStatus(0);
        vm.expectRevert("Transaction did not succeed");
        uc.decodeRepayment(hex"1234");
    }

    function test_setSourceLoanMarketOwnerOnly() public {
        vm.prank(makeAddr("random"));
        vm.expectRevert("Only owner");
        uc.setSourceLoanMarket(otherContract);
    }
}