// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

// Phase 0 debug: replicate SpikeConsumer.execute step by step with try/catch
// to find which internal call reverts.

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

interface IEvmV1Decoder {
    struct LogEntry { address address_; bytes32[] topics; bytes data; }
    struct ReceiptFields { uint8 receiptStatus; uint64 receiptGasUsed; LogEntry[] receiptLogs; bytes receiptLogsBloom; }
    function getTransactionType(bytes memory encodedTx) external pure returns (uint8);
    function isValidTransactionType(uint8 txType) external pure returns (bool);
    function decodeReceiptFields(bytes memory chunk) external pure returns (ReceiptFields memory);
    function getLogsByEventSignature(ReceiptFields memory receipt, bytes32 eventSignature) external pure returns (LogEntry[] memory);
        function getLogsByEventSignature(LogEntry[] memory logs, bytes32 eventSignature) external pure returns (LogEntry[] memory);
}

contract SpikeProbe {
    INativeQueryVerifier public immutable VERIFIER;
    IEvmV1Decoder public immutable DECODER;

    constructor(address decoder) {
        VERIFIER = NativeQueryVerifierLib.getVerifier();
        DECODER = IEvmV1Decoder(decoder);
    }

    function probeExecute(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (string memory) {
        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings});

        string memory out = "calcIndex ok";
        try VERIFIER.calculateTxIndex(merkleProof) returns (uint64 ti) {
            out = string.concat(out, "=", uint2str(ti));
        } catch (bytes memory) {
            return "calcIndex REVERTED";
        }

        INativeQueryVerifier.ContinuityProof memory cp =
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots});
        try VERIFIER.verifyAndEmit(chainKey, blockHeight, encodedTransaction, merkleProof, cp) returns (bool ok) {
            out = ok ? string.concat(out, " verifyAndEmit=true") : string.concat(out, " verifyAndEmit=false");
        } catch (bytes memory) {
            return string.concat(out, " verifyAndEmit REVERTED");
        }

        try DECODER.getTransactionType(encodedTransaction) returns (uint8 t) {
            out = string.concat(out, " txType=", uint2str(t));
        } catch (bytes memory) {
            return string.concat(out, " getTxType REVERTED");
        }

        try DECODER.decodeReceiptFields(encodedTransaction) returns (IEvmV1Decoder.ReceiptFields memory r) {
            return string.concat(out, " decodeStatus=", uint2str(r.receiptStatus));
        } catch (bytes memory) {
            return string.concat(out, " decodeReceipt REVERTED");
        }
    }

    function probeVerifyAndEmit2(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (string memory) {
        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings});
        INativeQueryVerifier.ContinuityProof memory cp =
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots});
        try VERIFIER.verifyAndEmit(chainKey, blockHeight, encodedTransaction, merkleProof, cp) returns (bool ok) {
            return ok ? "verifyAndEmit ok=true" : "verifyAndEmit ok=false";
        } catch (bytes memory) {
            return "verifyAndEmit REVERTED";
        }
    }

    function probeFilterCalldata(IEvmV1Decoder.ReceiptFields calldata receipt, bytes32 sig) external returns (string memory) {
        try DECODER.getLogsByEventSignature(receipt, sig) returns (IEvmV1Decoder.LogEntry[] memory logs) {
            if (logs.length == 0) return "calldata EMPTY";
            if (logs[0].topics.length != 3) return string.concat("calldata topics len=", uint2str(logs[0].topics.length));
            uint256 amount = abi.decode(logs[0].data, (uint256));
            return string.concat("calldata ALL OK amount=", uint2str(amount));
        } catch (bytes memory) {
            return "calldata REVERTED";
        }
    }

    function probeGetLogsRaw(bytes calldata encodedTransaction) external view returns (IEvmV1Decoder.LogEntry[] memory) {
        IEvmV1Decoder.ReceiptFields memory r = DECODER.decodeReceiptFields(encodedTransaction);
        return DECODER.getLogsByEventSignature(r, bytes32(0x24fcca58a997b1b2eff6db8107e860458544c09ddd3693b3b779e1df6c0d6c5d));
    }

    function probeGetLogsDirect(bytes calldata encodedTransaction) external view returns (string memory) {
        IEvmV1Decoder.ReceiptFields memory r = DECODER.decodeReceiptFields(encodedTransaction);
        try DECODER.getLogsByEventSignature(r.receiptLogs, bytes32(0x24fcca58a997b1b2eff6db8107e860458544c09ddd3693b3b779e1df6c0d6c5d)) returns (IEvmV1Decoder.LogEntry[] memory logs) {
            if (logs.length == 0) return "LogEntry[] overload: EMPTY";
            uint256 amount = abi.decode(logs[0].data, (uint256));
            return string.concat("LogEntry[] overload: OK amount=", uint2str(amount));
        } catch (bytes memory) {
            return "LogEntry[] overload: REVERTED";
        }
    }

    function probeDecode(
        bytes calldata encodedTransaction
    ) external returns (string memory) {
        try DECODER.getTransactionType(encodedTransaction) returns (uint8 t) {
            try DECODER.decodeReceiptFields(encodedTransaction) returns (IEvmV1Decoder.ReceiptFields memory r) {
                try DECODER.getLogsByEventSignature(r, bytes32(0x24fcca58a997b1b2eff6db8107e860458544c09ddd3693b3b779e1df6c0d6c5d)) returns (IEvmV1Decoder.LogEntry[] memory logs) {
                    if (logs.length == 0) return "getLogs EMPTY";
                    if (logs[0].topics.length != 3) return string.concat("topics len=", uint2str(logs[0].topics.length));
                    uint256 amount = abi.decode(logs[0].data, (uint256));
                    return string.concat("ALL OK amount=", uint2str(amount));
                } catch (bytes memory) {
                    return "getLogsByEventSignature REVERTED";
                }
            } catch (bytes memory) {
                return "decodeReceiptFields REVERTED";
            }
        } catch (bytes memory) {
            return "getTransactionType REVERTED";
        }
    }

    function uint2str(uint256 _i) internal pure returns (string memory) {
        if (_i == 0) return "0";
        uint256 j = _i;
        uint256 len;
        while (j != 0) { len++; j /= 10; }
        bytes memory bstr = new bytes(len);
        uint256 k = len;
        j = _i;
        while (j != 0) { k--; bstr[k] = bytes1(uint8(48 + j % 10)); j /= 10; }
        return string(bstr);
    }
}