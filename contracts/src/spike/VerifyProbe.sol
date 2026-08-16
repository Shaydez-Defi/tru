// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

// Phase 0 debug probe: isolate contract -> precompile calls.
// Interface copied from @gluwa/usc-contracts / gluwa bridge examples.

interface INativeQueryVerifier {
    struct MerkleProofEntry { bytes32 hash; bool isLeft; }
    struct MerkleProof { bytes32 root; MerkleProofEntry[] siblings; }
    struct ContinuityProof { bytes32 lowerEndpointDigest; bytes32[] roots; }
    function verifyAndEmit(uint64 chainKey, uint64 height, bytes calldata encodedTransaction, MerkleProof calldata merkleProof, ContinuityProof calldata continuityProof) external returns (bool);
    function verify(uint64 chainKey, uint64 height, bytes calldata encodedTransaction, MerkleProof calldata merkleProof, ContinuityProof calldata continuityProof) external view returns (bool);
    function calculateTxIndex(MerkleProof calldata merkle_proof) external view returns (uint64);
}

library NativeQueryVerifierLib {
    address constant PRECOMPILE_ADDRESS = 0x0000000000000000000000000000000000000FD2;
    function getVerifier() internal pure returns (INativeQueryVerifier) {
        return INativeQueryVerifier(PRECOMPILE_ADDRESS);
    }
}

// --- decoder interface (matches @gluwa/usc-contracts EvmV1Decoder deployed at 0x731c...F9f) ---
interface IEvmV1Decoder {
    struct LogEntry { address address_; bytes32[] topics; bytes data; }
    struct ReceiptFields { uint8 receiptStatus; uint64 receiptGasUsed; LogEntry[] receiptLogs; bytes receiptLogsBloom; }
    function getTransactionType(bytes memory encodedTx) external pure returns (uint8);
    function isValidTransactionType(uint8 txType) external pure returns (bool);
    function decodeReceiptFields(bytes memory chunk) external pure returns (ReceiptFields memory);
    function getLogsByEventSignature(ReceiptFields memory receipt, bytes32 eventSignature) external pure returns (LogEntry[] memory);
}

contract VerifyProbe {
    INativeQueryVerifier public immutable VERIFIER;

    // @gluwa/usc-contracts EvmV1Decoder (deployed at 0x731c...F9f)
    IEvmV1Decoder public immutable DECODER;

    constructor(address decoder) {
        VERIFIER = NativeQueryVerifierLib.getVerifier();
        DECODER = IEvmV1Decoder(decoder);
    }

    function probeVerifyAndEmit(
        uint64 chainKey, uint64 height, bytes calldata encodedTransaction,
        INativeQueryVerifier.MerkleProof calldata merkleProof,
        INativeQueryVerifier.ContinuityProof calldata continuityProof
    ) external returns (bool) {
        return VERIFIER.verifyAndEmit(chainKey, height, encodedTransaction, merkleProof, continuityProof);
    }

    function probeVerify(
        uint64 chainKey, uint64 height, bytes calldata encodedTransaction,
        INativeQueryVerifier.MerkleProof calldata merkleProof,
        INativeQueryVerifier.ContinuityProof calldata continuityProof
    ) external view returns (bool) {
        return VERIFIER.verify(chainKey, height, encodedTransaction, merkleProof, continuityProof);
    }

    function probeCalcIndex(INativeQueryVerifier.MerkleProof calldata merkleProof) external view returns (uint64) {
        return VERIFIER.calculateTxIndex(merkleProof);
    }

    // --- decoder probes ---

    function probeGetTxType(bytes calldata encodedTransaction) external view returns (uint8) {
        return DECODER.getTransactionType(encodedTransaction);
    }

    function probeIsValidType(uint8 t) external view returns (bool) {
        return DECODER.isValidTransactionType(t);
    }

    function probeDecodeReceipt(bytes calldata encodedTransaction) external view returns (IEvmV1Decoder.ReceiptFields memory) {
        return DECODER.decodeReceiptFields(encodedTransaction);
    }

    function probeFilter(IEvmV1Decoder.ReceiptFields calldata receipt, bytes32 sig) external view returns (IEvmV1Decoder.LogEntry[] memory) {
        return DECODER.getLogsByEventSignature(receipt, sig);
    }
}