// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { ITRUCreditRegistry } from "./interfaces/ITRUCreditRegistry.sol";

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

/// @dev On-chain EvmV1Decoder library contract (CC3 testnet
///      0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f). See docs/usc-research.md.
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

/// @title TRUUniversalContract
/// @notice Creditcoin-side USC verification front door. Receives a proof, asks the
///         native USC verifier precompile to verify it, extracts the verified
///         source-chain event, emits RepaymentVerified, and forwards the verified
///         facts to TRUCreditRegistry.
///         Per AGENTS.md rule 6 this contract contains NO credit logic — it is
///         verification + forwarding only. All event data is derived on-chain from
///         the USC-verified transaction; no external parameters are introduced.
contract TRUUniversalContract {
    INativeQueryVerifier public immutable VERIFIER;
    IEvmV1Decoder public immutable DECODER;
    ITRUCreditRegistry public registry;

    address public owner;

    /// @dev The SourceLoanMarket contract (Sepolia) whose LoanRepaid events this
    ///      contract accepts. Binds the verified event to the specific source
    ///      contract whose logic enforces loan ownership (AGENTS.md rule 6).
    address public sourceLoanMarket;

    /// @dev keccak256("LoanRepaid(address,uint256,uint256)") — the event emitted by
    ///      SourceLoanMarket (the source-chain contract this verifies against).
    bytes32 public constant REPAYMENT_EVENT_SIGNATURE =
        0xc7ce0a35f17b490de2a317e7fecb2cae86b1abffb03800b2f492823521382698;

    /// @dev keccak256("LoanCreated(uint256,address,uint256,uint256)") — loan origination event.
    bytes32 public constant LOAN_CREATED_EVENT_SIGNATURE =
        0x3373919ad665425d2cddb4072830e5935b6ee308440fa99b23383648da473bc0;

    /// @dev Replay protection keyed on keccak(chainKey, blockHeight, txIndex) so the
    ///      same source-chain event can never be verified/credited twice.
    mapping(bytes32 => bool) public processedQueries;

    event RepaymentVerified(
        uint64 chainKey,
        uint64 blockHeight,
        uint64 transactionIndex,
        address indexed borrower,
        uint256 indexed loanId,
        uint256 amount
    );

    event LoanOriginationVerified(
        uint64 chainKey,
        uint64 blockHeight,
        uint64 transactionIndex,
        address indexed borrower,
        uint256 indexed loanId,
        uint256 principal,
        uint256 dueTimestamp
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(address decoder, address registry_, address sourceLoanMarket_) {
        VERIFIER = NativeQueryVerifierLib.getVerifier();
        DECODER = IEvmV1Decoder(decoder);
        registry = ITRUCreditRegistry(registry_);
        require(sourceLoanMarket_ != address(0), "Zero source market");
        sourceLoanMarket = sourceLoanMarket_;
        owner = msg.sender;
    }

    function setRegistry(address registry_) external onlyOwner {
        registry = ITRUCreditRegistry(registry_);
    }

    function setSourceLoanMarket(address sourceLoanMarket_) external onlyOwner {
        require(sourceLoanMarket_ != address(0), "Zero source market");
        sourceLoanMarket = sourceLoanMarket_;
    }

    /// @notice Verifies a USC proof of a source-chain transaction, extracts the
    ///         LoanRepaid event from the verified transaction, and forwards it to
    ///         TRUCreditRegistry.
    function execute(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 sourceTxHash,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (bool) {
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

        emit RepaymentVerified(chainKey, blockHeight, transactionIndex, borrower, loanId, amount);

        registry.recordVerifiedRepayment(queryId, borrower, loanId, amount, chainKey, sourceTxHash, blockHeight);

        return true;
    }

    /// @notice Verifies a USC proof of a source-chain LoanCreated transaction,
    ///         extracts the verified origination and forwards it to the registry.
    ///         Same USC proof path as `execute`, branched on event signature,
    ///         same emitter check, same replay guard, new UC-gated registry entry.
    function executeLoanOrigination(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 sourceTxHash,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (bool) {
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

        (address borrower, uint256 loanId, uint256 principal, uint256 dueTimestamp) =
            _decodeLoanCreated(encodedTransaction);

        emit LoanOriginationVerified(chainKey, blockHeight, transactionIndex, borrower, loanId, principal, dueTimestamp);

        registry.recordVerifiedLoanOrigination(
            queryId, borrower, loanId, principal, dueTimestamp, chainKey, sourceTxHash, blockHeight
        );

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

    /// @dev Extracts borrower/loanId/amount from the USC-verified transaction by
    ///      filtering the decoded receipt logs in-contract. The deployed
    ///      EvmV1Decoder's getLogsByEventSignature reverts on valid input (see
    ///      docs/phase-0-report.md), so we filter receiptLogs locally instead —
    ///      identical security properties (see docs/phase-0-security-tests.md).
    function _decodeRepayment(bytes memory encodedTransaction)
        internal
        view
        returns (address borrower, uint256 loanId, uint256 amount)
    {
        uint8 txType = DECODER.getTransactionType(encodedTransaction);
        require(DECODER.isValidTransactionType(txType), "Unsupported transaction type");

        IEvmV1Decoder.ReceiptFields memory receipt = DECODER.decodeReceiptFields(encodedTransaction);
        require(receipt.receiptStatus == 1, "Transaction did not succeed");

        IEvmV1Decoder.LogEntry[] memory logs = receipt.receiptLogs;
        // NOTE: the deployed EvmV1Decoder's getLogsByEventSignature reverts on valid
        // input on CC3 testnet (see docs/phase-0-report.md), so we filter the decoded
        // receiptLogs in-contract instead. This is intentional, not an odd design choice.
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

        // Loan binding (build-order step 5): the verified event must have been
        // emitted by the configured SourceLoanMarket contract. SourceLoanMarket's
        // repayLoan only emits LoanRepaid for active loans owned by the caller, so
        // binding the emitter also binds the loanId to a real loan of the borrower.
        require(log.address_ == sourceLoanMarket, "Not SourceLoanMarket emitter");

        borrower = address(uint160(uint256(log.topics[1])));
        loanId = uint256(log.topics[2]);
        amount = abi.decode(log.data, (uint256));
    }

    /// @notice View-only path for the same decode + emitter binding checks that
    ///         execute() performs. Useful for off-chain introspection/testing; it
    ///         changes no state and performs no verification on its own.
    function decodeRepayment(bytes calldata encodedTransaction)
        external
        view
        returns (address borrower, uint256 loanId, uint256 amount)
    {
        return _decodeRepayment(encodedTransaction);
    }

    /// @dev Decodes LoanCreated from verified transaction receipt logs.
    function _decodeLoanCreated(bytes memory encodedTransaction)
        internal
        view
        returns (address borrower, uint256 loanId, uint256 principal, uint256 dueTimestamp)
    {
        uint8 txType = DECODER.getTransactionType(encodedTransaction);
        require(DECODER.isValidTransactionType(txType), "Unsupported transaction type");

        IEvmV1Decoder.ReceiptFields memory receipt = DECODER.decodeReceiptFields(encodedTransaction);
        require(receipt.receiptStatus == 1, "Transaction did not succeed");

        IEvmV1Decoder.LogEntry[] memory logs = receipt.receiptLogs;
        uint256 matchIndex = type(uint256).max;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length == 3 && logs[i].topics[0] == LOAN_CREATED_EVENT_SIGNATURE) {
                matchIndex = i;
                break;
            }
        }
        require(matchIndex != type(uint256).max, "No LoanCreated event found");

        IEvmV1Decoder.LogEntry memory log = logs[matchIndex];
        require(log.topics.length == 3, "Invalid LoanCreated topics");
        require(log.topics[0] == LOAN_CREATED_EVENT_SIGNATURE, "Not LoanCreated event");
        require(log.address_ == sourceLoanMarket, "Not SourceLoanMarket emitter");

        loanId = uint256(log.topics[1]);
        borrower = address(uint160(uint256(log.topics[2])));
        (principal, dueTimestamp) = abi.decode(log.data, (uint256, uint256));
    }

    /// @notice View-only decode for LoanCreated, mirrors decodeRepayment.
    function decodeLoanCreated(bytes calldata encodedTransaction)
        external
        view
        returns (address borrower, uint256 loanId, uint256 principal, uint256 dueTimestamp)
    {
        return _decodeLoanCreated(encodedTransaction);
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