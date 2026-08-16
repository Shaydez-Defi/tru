// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

// PHASE 0 SPIKE ONLY — throwaway code to prove the USC verification mechanism.
// Not TRUUniversalContract / TRUCreditRegistry. Deployed on Creditcoin CC3 Testnet.

interface INativeQueryVerifier {
    struct MerkleProofEntry {
        bytes32 hash;
        bool isLeft;
    }

    struct MerkleProof {
        bytes32 root;
        MerkleProofEntry[] siblings;
    }

    struct ContinuityProof {
        bytes32 lowerEndpointDigest;
        bytes32[] roots;
    }

    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external returns (bool);

    function calculateTxIndex(MerkleProof calldata merkle_proof) external view returns (uint64);
}

library NativeQueryVerifierLib {
    address constant PRECOMPILE_ADDRESS = 0x0000000000000000000000000000000000000FD2;

    function getVerifier() internal pure returns (INativeQueryVerifier) {
        return INativeQueryVerifier(PRECOMPILE_ADDRESS);
    }
}

/// @dev Matches the on-chain EvmV1Decoder library contract deployed on CC3 testnet
///      at 0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f (see docs/usc-research.md).
interface IEvmV1Decoder {
    struct LogEntry {
        address address_;
        bytes32[] topics;
        bytes data;
    }

    struct ReceiptFields {
        uint8 receiptStatus;
        uint64 receiptGasUsed;
        LogEntry[] receiptLogs;
        bytes receiptLogsBloom;
    }

    function getTransactionType(bytes memory encodedTx) external pure returns (uint8);
    function isValidTransactionType(uint8 txType) external pure returns (bool);
    function decodeReceiptFields(bytes memory chunk) external pure returns (ReceiptFields memory);
}

contract SpikeConsumer {
    INativeQueryVerifier public immutable VERIFIER;
    IEvmV1Decoder public immutable DECODER;

    // keccak256("Repayment(address,uint256,uint256)")
    bytes32 public constant REPAYMENT_EVENT_SIGNATURE =
        0x24fcca58a997b1b2eff6db8107e860458544c09ddd3693b3b779e1df6c0d6c5d;

    mapping(bytes32 => bool) public processedQueries;

    event RepaymentVerified(
        uint64 chainKey,
        uint64 blockHeight,
        uint64 transactionIndex,
        address indexed borrower,
        uint256 indexed loanId,
        uint256 amount
    );

    uint64 public lastChainKey;
    uint64 public lastBlockHeight;
    uint64 public lastTransactionIndex;
    address public lastBorrower;
    uint256 public lastLoanId;
    uint256 public lastAmount;
    uint256 public verifiedCount;

    constructor(address decoder) {
        VERIFIER = NativeQueryVerifierLib.getVerifier();
        DECODER = IEvmV1Decoder(decoder);
    }

    function execute(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (bool success) {
        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings});

        uint64 transactionIndex = VERIFIER.calculateTxIndex(merkleProof);

        bytes32 queryId = _computeQueryId(chainKey, blockHeight, transactionIndex);
        require(!processedQueries[queryId], "Query already processed");

        bool verified = _verifyProof(
            chainKey, blockHeight, encodedTransaction, merkleProof, lowerEndpointDigest, continuityRoots
        );
        require(verified, "Proof of inclusion verification failed");

        processedQueries[queryId] = true;

        (address borrower, uint256 loanId, uint256 amount) = _decodeRepayment(encodedTransaction);

        lastChainKey = chainKey;
        lastBlockHeight = blockHeight;
        lastTransactionIndex = transactionIndex;
        lastBorrower = borrower;
        lastLoanId = loanId;
        lastAmount = amount;
        verifiedCount++;

        emit RepaymentVerified(chainKey, blockHeight, transactionIndex, borrower, loanId, amount);

        return true;
    }

    function _verifyProof(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        INativeQueryVerifier.MerkleProof memory merkleProof,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) internal returns (bool verified) {
        INativeQueryVerifier.ContinuityProof memory continuityProof =
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots});

        // Reverts on failed verification; emits TransactionVerified on success.
        verified = VERIFIER.verifyAndEmit(chainKey, blockHeight, encodedTransaction, merkleProof, continuityProof);
        return verified;
    }

    function _decodeRepayment(bytes memory encodedTransaction)
        internal
        view
        returns (address borrower, uint256 loanId, uint256 amount)
    {
        uint8 txType = DECODER.getTransactionType(encodedTransaction);
        require(DECODER.isValidTransactionType(txType), "Unsupported transaction type");

        IEvmV1Decoder.ReceiptFields memory receipt = DECODER.decodeReceiptFields(encodedTransaction);
        require(receipt.receiptStatus == 1, "Transaction did not succeed");

        // NOTE: the deployed EvmV1Decoder's getLogsByEventSignature reverts on valid
        // input (both overloads, EOA and contract callers) on CC3 testnet; the SDK
        // filters receiptLogs in JS. So filter locally in-contract instead.
        IEvmV1Decoder.LogEntry[] memory logs = receipt.receiptLogs;
        uint256 matchIndex = type(uint256).max;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length == 3 && logs[i].topics[0] == REPAYMENT_EVENT_SIGNATURE) {
                matchIndex = i;
                break;
            }
        }
        require(matchIndex != type(uint256).max, "No Repayment event found");

        IEvmV1Decoder.LogEntry memory log = logs[matchIndex];
        require(log.topics.length == 3, "Invalid Repayment topics");
        require(log.topics[0] == REPAYMENT_EVENT_SIGNATURE, "Not Repayment event");

        borrower = address(uint160(uint256(log.topics[1])));
        loanId = uint256(log.topics[2]);
        amount = abi.decode(log.data, (uint256));
    }

    function _computeQueryId(uint64 chainKey, uint64 blockHeight, uint64 transactionIndex)
        internal
        pure
        returns (bytes32 queryId)
    {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, chainKey)
            mstore(add(ptr, 32), shl(192, blockHeight))
            mstore(add(ptr, 40), transactionIndex)
            queryId := keccak256(ptr, 72)
        }
    }
}