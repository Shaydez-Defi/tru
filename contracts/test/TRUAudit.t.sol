// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { Test } from "forge-std/Test.sol";
import { TRUCreditRegistry } from "../src/creditcoin/TRUCreditRegistry.sol";
import { TRUUniversalContract, IEvmV1Decoder, INativeQueryVerifier } from "../src/creditcoin/TRUUniversalContract.sol";
import { ITRUCreditRegistry } from "../src/creditcoin/interfaces/ITRUCreditRegistry.sol";

/// @notice Security/scalability/completeness audit tests (2026-09-12).
///         Characterization + adversarial coverage for findings that require
///         NO contract changes: relay boundary, admin rotation immutability,
///         lifecycle pinning, and empirical gas scaling of the O(n^2) views.
///         Existing suites are untouched; every test passes against the
///         currently deployed bytecode.
contract TRUAuditTest is Test {
    TRUCreditRegistry internal registry;

    address internal owner = makeAddr("owner");
    address internal universalContract = makeAddr("universalContract");
    address internal randomCaller = makeAddr("randomCaller");

    uint64 internal constant CHAIN_KEY = 1;
    uint64 internal constant SOURCE_BLOCK = 100;

    function setUp() public {
        vm.prank(owner);
        registry = new TRUCreditRegistry();
        vm.prank(owner);
        registry.setUniversalContract(universalContract);
    }

    function _create(uint256 oid, address requester, address executor, uint256 value) internal {
        vm.prank(universalContract);
        registry.recordVerifiedObligationCreated(
            keccak256(abi.encode("create", oid)),
            oid,
            requester,
            executor,
            value,
            block.timestamp + 1000,
            CHAIN_KEY,
            keccak256(abi.encode("txc", oid)),
            SOURCE_BLOCK
        );
    }

    function _complete(uint256 oid, address executor, uint256 value) internal {
        vm.prank(universalContract);
        registry.recordVerifiedObligationCompleted(
            keccak256(abi.encode("done", oid)),
            oid,
            executor,
            value,
            CHAIN_KEY,
            keccak256(abi.encode("txd", oid)),
            SOURCE_BLOCK
        );
    }

    /* ── A. Relay boundary ─────────────────────────────────────────── */

    function test_obligationRecordPathsRequireUniversalContract() public {
        address requester = makeAddr("requester");
        address executor = makeAddr("executor");
        vm.prank(randomCaller);
        vm.expectRevert("Only TRUUniversalContract");
        registry.recordVerifiedObligationCreated(
            keccak256("x"), 1, requester, executor, 100, block.timestamp + 1, CHAIN_KEY, keccak256("t"), SOURCE_BLOCK
        );
        vm.prank(randomCaller);
        vm.expectRevert("Only TRUUniversalContract");
        registry.recordVerifiedObligationCompleted(
            keccak256("y"), 1, executor, 100, CHAIN_KEY, keccak256("t"), SOURCE_BLOCK
        );
    }

    function test_nonUniversalCallerCannotReachReplayLogic() public {
        // Authorization precedes replay: a non-UC caller reverts on the
        // gatekeeper for both fresh and already-used queryIds, so the replay
        // maps are only ever reachable by the single authorized relay path
        // (which itself is permissionless at the UC layer, guarded by proof).
        address requester = makeAddr("requester");
        address executor = makeAddr("executor");
        bytes32 used = keccak256("audit-used");
        _createWithQuery(used, 12, requester, executor, 1000);
        vm.prank(randomCaller);
        vm.expectRevert("Only TRUUniversalContract");
        registry.recordVerifiedObligationCreated(
            used, 13, requester, executor, 1000, block.timestamp + 1, CHAIN_KEY, keccak256("t"), SOURCE_BLOCK
        );
        vm.prank(randomCaller);
        vm.expectRevert("Only TRUUniversalContract");
        registry.recordVerifiedObligationCreated(
            keccak256("audit-fresh"), 14, requester, executor, 1000, block.timestamp + 1, CHAIN_KEY, keccak256("t"), SOURCE_BLOCK
        );
    }

    function _createWithQuery(bytes32 q, uint256 oid, address requester, address executor, uint256 value) internal {
        vm.prank(universalContract);
        registry.recordVerifiedObligationCreated(
            q, oid, requester, executor, value, block.timestamp + 1000, CHAIN_KEY, keccak256(abi.encode("txc", oid)), SOURCE_BLOCK
        );
    }

    function _completeWithQuery(bytes32 q, uint256 oid, address executor, uint256 value) internal {
        vm.prank(universalContract);
        registry.recordVerifiedObligationCompleted(
            q, oid, executor, value, CHAIN_KEY, keccak256(abi.encode("txd", oid)), SOURCE_BLOCK
        );
    }

    /* ── B. Admin rotation immutability ────────────────────────────── */

    function test_rotatingUniversalContractPreservesHistory() public {
        // Historical facts live in registry storage. Rotating the authorized
        // UC must not rewrite them; only future writes change authority.
        address requester = makeAddr("requester");
        address executor = makeAddr("executor");
        _create(20, requester, executor, 7000);
        _complete(20, executor, 7000);

        address newUC = makeAddr("newUC");
        vm.prank(owner);
        registry.setUniversalContract(newUC);

        // Past facts intact.
        assertEq(uint8(registry.getObligationStatus(20)), uint8(ITRUCreditRegistry.ObligationStatus.COMPLETED));
        ITRUCreditRegistry.AgentPassport memory p = registry.getAgentPassport(executor);
        assertEq(p.verifiedObligations, 1);
        assertEq(p.completedObligations, 1);
        assertEq(p.verifiedSettlementVolume, 7000);
        assertEq(registry.getObligationEventCount(executor), 2);

        // Old UC is now unauthorized.
        vm.prank(universalContract);
        vm.expectRevert("Only TRUUniversalContract");
        registry.recordVerifiedObligationCreated(
            keccak256("stale"), 21, requester, executor, 1, block.timestamp + 1, CHAIN_KEY, keccak256("t"), SOURCE_BLOCK
        );

        // New UC can keep writing; old facts still intact afterwards.
        vm.prank(newUC);
        registry.recordVerifiedObligationCreated(
            keccak256("fresh"), 21, requester, executor, 5, block.timestamp + 1, CHAIN_KEY, keccak256("t"), SOURCE_BLOCK
        );
        assertEq(uint8(registry.getObligationStatus(20)), uint8(ITRUCreditRegistry.ObligationStatus.COMPLETED));
        assertEq(registry.getAgentPassport(executor).verifiedObligations, 2);
    }

    /* ── C. Lifecycle pinning (current behavior) ───────────────────── */

    function test_failedObligationsRemainZeroWithoutFailurePath() public {
        // Pins the documented limitation: no verified failure path exists, so
        // FAILED is unreachable and failedObligations stays 0.
        address requester = makeAddr("requester");
        address executor = makeAddr("executor");
        _create(30, requester, executor, 9000);
        _complete(30, executor, 9000);
        ITRUCreditRegistry.AgentPassport memory p = registry.getAgentPassport(executor);
        assertEq(p.failedObligations, 0);
        assertEq(p.activeObligations, 0);
        assertTrue(registry.getObligationStatus(30) != ITRUCreditRegistry.ObligationStatus.FAILED);
    }

    /* ── D. Empirical gas scaling of the views ─────────────────────── */

    function _freshRegistryWithCompletedObligations(uint256 n, address executor)
        internal
        returns (TRUCreditRegistry fresh)
    {
        vm.prank(owner);
        fresh = new TRUCreditRegistry();
        vm.prank(owner);
        fresh.setUniversalContract(universalContract);
        address requester = makeAddr("requester");
        for (uint256 k = 0; k < n; k++) {
            uint256 oid = 1000 + k;
            vm.prank(universalContract);
            fresh.recordVerifiedObligationCreated(
                keccak256(abi.encode("c", oid)), oid, requester, executor, 100,
                block.timestamp + 1000, CHAIN_KEY, keccak256(abi.encode("tx", oid)), SOURCE_BLOCK
            );
            vm.prank(universalContract);
            fresh.recordVerifiedObligationCompleted(
                keccak256(abi.encode("d", oid)), oid, executor, 100,
                CHAIN_KEY, keccak256(abi.encode("tx", oid)), SOURCE_BLOCK
            );
        }
    }

    function test_passportGasScalesWithHistory() public {
        // Documents the O(n^2) view cost empirically: correctness must hold at
        // every size, and absolute gas must stay far below a block ceiling.
        uint256[3] memory sizes = [uint256(2), uint256(4), uint256(8)];
        uint256 prevGas = 0;
        for (uint256 s = 0; s < sizes.length; s++) {
            address executor = makeAddr(string(abi.encodePacked("exec", s)));
            TRUCreditRegistry fresh = _freshRegistryWithCompletedObligations(sizes[s], executor);
            uint256 g0 = gasleft();
            ITRUCreditRegistry.AgentPassport memory p = fresh.getAgentPassport(executor);
            uint256 used = g0 - gasleft();
            assertEq(p.verifiedObligations, sizes[s]);
            assertEq(p.completedObligations, sizes[s]);
            assertEq(p.completionRateBps, 10000);
            emit log_named_uint(string(abi.encodePacked("passportGas_n", vm.toString(sizes[s]))), used);
            assertLt(used, 10_000_000, "passport view must fit comfortably in a block at n=8");
            if (s > 0) assertGt(used, prevGas, "passport cost grows with history size");
            prevGas = used;
        }
    }

    function test_evidenceGasScalesWithRepayments() public {
        // getCreditEvidence is read ON-CHAIN by TRUFinancing.requestFinancing,
        // so its growth curve is the one that matters for liveness.
        address borrower = makeAddr("borrower");
        uint256[3] memory sizes = [uint256(2), uint256(4), uint256(8)];
        uint256 prevGas = 0;
        for (uint256 s = 0; s < sizes.length; s++) {
            vm.prank(owner);
            TRUCreditRegistry fresh = new TRUCreditRegistry();
            vm.prank(owner);
            fresh.setUniversalContract(universalContract);
            for (uint256 k = 0; k < sizes[s]; k++) {
                vm.prank(universalContract);
                fresh.recordVerifiedRepayment(
                    keccak256(abi.encode("r", s, k)), borrower, k, 100, CHAIN_KEY,
                    keccak256(abi.encode("tx", k)), SOURCE_BLOCK
                );
            }
            uint256 g0 = gasleft();
            ITRUCreditRegistry.CreditEvidence memory ev = fresh.getCreditEvidence(borrower);
            uint256 used = g0 - gasleft();
            assertEq(ev.repayments, sizes[s]);
            assertEq(ev.creditLimit, sizes[s] * 100);
            emit log_named_uint(string(abi.encodePacked("evidenceGas_n", vm.toString(sizes[s]))), used);
            assertLt(used, 10_000_000, "evidence view must fit comfortably in a block at n=8");
            if (s > 0) assertGt(used, prevGas, "evidence cost grows with history size");
            prevGas = used;
        }
    }
}

/// @notice UC admin-boundary tests for setters lacking owner-only coverage.
contract TRUAdminBoundaryTest is Test {    TRUUniversalContract internal uc;

    address internal owner = makeAddr("owner");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        vm.prank(owner);
        uc = new TRUUniversalContract(address(0xDEc0), address(0), makeAddr("market"));
    }

    function test_ucSettersAreOwnerOnly() public {
        vm.prank(stranger);
        vm.expectRevert("Only owner");
        uc.setRegistry(makeAddr("r"));
        vm.prank(stranger);
        vm.expectRevert("Only owner");
        uc.setSourceLoanMarket(makeAddr("m"));
        vm.prank(stranger);
        vm.expectRevert("Only owner");
        uc.setSourceObligationMarket(makeAddr("m"));
    }

    function test_ucSettersRejectZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert("Zero registry");
        uc.setRegistry(address(0));
        vm.prank(owner);
        vm.expectRevert("Zero source market");
        uc.setSourceLoanMarket(address(0));
        // Obligation market explicitly allows zero (unset = fail-closed:
        // obligation decoders revert while unset). Pin that behavior.
        vm.prank(owner);
        uc.setSourceObligationMarket(address(0));
    }
}

/// @notice Mock USC precompile etched at 0xFD2. Verdict is controllable so
///         tests can prove the UC enforces proof success on the full path.
contract MockPrecompile {
    bool public verdict;
    uint64 public txIndex;

    function verifyAndEmit(
        uint64,
        uint64,
        bytes calldata,
        INativeQueryVerifier.MerkleProof calldata,
        INativeQueryVerifier.ContinuityProof calldata
    ) external view returns (bool) {
        return verdict;
    }

    function calculateTxIndex(INativeQueryVerifier.MerkleProof calldata) external view returns (uint64) {
        return txIndex;
    }

    function setVerdict(bool v) external {
        verdict = v;
    }

    function setTxIndex(uint64 i) external {
        txIndex = i;
    }
}

contract MockAuditDecoder {
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
        IEvmV1Decoder.LogEntry[] memory logs = new IEvmV1Decoder.LogEntry[](1);
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

/// @notice Full-path UC replay/tamper tests: the exact adversarial scenario
///         for a permissionless relay — a second caller re-submitting a
///         processed proof, and a failing proof reaching the gate.
contract TRUExecuteAdversarialTest is Test {
    address internal constant PRECOMPILE = 0x0000000000000000000000000000000000000FD2;

    TRUUniversalContract internal uc;
    TRUCreditRegistry internal registry;
    MockAuditDecoder internal decoder;

    address internal owner = makeAddr("owner");
    address internal sourceLoanMarket = makeAddr("sourceLoanMarket");
    address internal borrower = makeAddr("borrower");
    address internal callerA = makeAddr("callerA");
    address internal callerB = makeAddr("callerB");

    uint256 internal constant LOAN_ID = 42;
    uint256 internal constant AMOUNT = 123456789;
    uint64 internal constant CHAIN_KEY = 1;
    uint64 internal constant HEIGHT = 500;

    bytes32 internal constant SIG =
        0xc7ce0a35f17b490de2a317e7fecb2cae86b1abffb03800b2f492823521382698; // LoanRepaid(address,uint256,uint256)

    function setUp() public {
        MockPrecompile template = new MockPrecompile();
        vm.etch(PRECOMPILE, address(template).code);
        MockPrecompile(PRECOMPILE).setVerdict(true);
        MockPrecompile(PRECOMPILE).setTxIndex(7);

        decoder = new MockAuditDecoder();
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = SIG;
        topics[1] = bytes32(uint256(uint160(borrower)));
        topics[2] = bytes32(LOAN_ID);
        decoder.setLog(
            IEvmV1Decoder.LogEntry({address_: sourceLoanMarket, topics: topics, data: abi.encode(AMOUNT)})
        );

        vm.prank(owner);
        registry = new TRUCreditRegistry();
        vm.prank(owner);
        uc = new TRUUniversalContract(address(decoder), address(registry), sourceLoanMarket);
        vm.prank(owner);
        registry.setUniversalContract(address(uc));
    }

    function _executeArgs()
        internal
        pure
        returns (
            bytes memory encodedTx,
            bytes32 sourceTxHash,
            bytes32 merkleRoot,
            INativeQueryVerifier.MerkleProofEntry[] memory siblings,
            bytes32 lowerDigest,
            bytes32[] memory roots
        )
    {
        encodedTx = hex"02f100";
        sourceTxHash = keccak256("source-tx");
        merkleRoot = keccak256("root");
        siblings = new INativeQueryVerifier.MerkleProofEntry[](0);
        lowerDigest = keccak256("lower");
        roots = new bytes32[](0);
    }

    function _submit(address caller) internal {
        (
            bytes memory encodedTx,
            bytes32 sourceTxHash,
            bytes32 merkleRoot,
            INativeQueryVerifier.MerkleProofEntry[] memory siblings,
            bytes32 lowerDigest,
            bytes32[] memory roots
        ) = _executeArgs();
        vm.prank(caller);
        uc.execute(CHAIN_KEY, HEIGHT, encodedTx, sourceTxHash, merkleRoot, siblings, lowerDigest, roots);
    }

    function test_ucExecuteReplayByDifferentCallerReverts() public {
        // Caller A submits a valid proof: registry updates exactly once.
        _submit(callerA);
        assertEq(registry.getCreditEvidence(borrower).repayments, 1);

        // Caller B re-submits the identical proof: replay guard reverts and
        // no state mutates, regardless of caller.
        vm.expectRevert("Query already processed");
        _submit(callerB);
        assertEq(registry.getCreditEvidence(borrower).repayments, 1);
    }

    function test_ucExecuteRejectedProofRevertsWithoutStateChange() public {
        // A failing precompile verdict (tampered proof on mainnet) reverts
        // before any state change.
        MockPrecompile(PRECOMPILE).setVerdict(false);
        vm.expectRevert("Proof of inclusion verification failed");
        _submit(callerA);
        assertEq(registry.getCreditEvidence(borrower).repayments, 0);
    }

    function test_ucExecuteFailedSourceTxReverts() public {
        // A source transaction that did not succeed cannot credit anyone.
        decoder.setReceiptStatus(0);
        vm.expectRevert("Transaction did not succeed");
        _submit(callerA);
        assertEq(registry.getCreditEvidence(borrower).repayments, 0);
    }
}
