// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title EvmV1Decoder
 * @notice Library for decoding ABI-encoded EVM transactions (types 0-4) and receipts
 * @dev The encoding format is bytes[] where each chunk contains explicitly chunked fields (deterministic grouping)
 * @dev This nested ABI encoding structure avoids "stack too deep" errors in Solidity
 * @dev The checkpoint attests to this bytes[] format - all components must use the same structure
 * @dev QueryBuilder calculates offsets from bytes[] structure, BlockProver extracts using those offsets
 *
 * @dev Selective Decoding (Gas-Efficient):
 * @dev This library provides selective decoding functions that allow you to decode only the fields you need:
 * @dev - decodeCommonTxFields(): Decode only common transaction fields (chunk 1)
 * @dev - decodeReceiptFields(): Decode only receipt fields (last chunk)
 * @dev - decodeTypeSpecificFieldsTypeX(): Decode only type-specific fields (chunks 2+)
 * @dev
 * @dev Gas Efficiency Tips:
 * @dev - Decode once in memory and reuse the struct to avoid redundant decoding within the same transaction
 * @dev - Use selective decoding when you only need specific fields (e.g., only receipt logs, only TX value)
 * @dev - Full decoding (decodeTransactionTypeX) is still available for backward compatibility
 * @dev
 * @dev Example Usage:
 * @dev ```solidity
 * @dev // Only need receipt logs? Decode just the receipt:
 * @dev ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTx);
 * @dev LogEntry[] memory logs = receipt.receiptLogs;
 * @dev
 * @dev // Need both common TX fields and receipt? Decode separately:
 * @dev CommonTxFields memory tx = EvmV1Decoder.decodeCommonTxFields(encodedTx);
 * @dev ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTx);
 * @dev // Reuse tx and receipt structs throughout your function to avoid re-decoding
 * @dev ```
 */
library EvmV1Decoder {
    // ---------- Structs ----------
    struct AccessListEntryBytes32 { address account; bytes32[] storageKeys; }
    struct AccessListEntryUint256 { address account; uint256[] storageKeys; }
    struct AccessListEntry { address account; bytes32[] storageKeys; }

    struct AuthorizationListEntry {
        uint256 chainId;
        address account;
        uint64 nonce;
        uint8 yParity;
        uint256 r;
        uint256 s;
    }

    struct LogEntry { address address_; bytes32[] topics; bytes data; }
    struct LogEntryTuple { address address_; bytes32[] topics; bytes data; }

    /**
     * @notice Common transaction fields shared across all transaction types (Type 0-4)
     * @dev These fields are encoded in chunk 1 of the bytes[] array
     */
    struct CommonTxFields {
        uint64 nonce;
        uint64 gasLimit;
        address from;
        bool toIsNull;
        address to;
        uint256 value;
        bytes data;
    }

    /**
     * @notice Receipt fields shared across all transaction types (Type 0-4)
     * @dev These fields are encoded in the last chunk of the bytes[] array
     */
    struct ReceiptFields {
        uint8 receiptStatus;
        uint64 receiptGasUsed;
        LogEntry[] receiptLogs;
        bytes receiptLogsBloom;
    }

    struct LegacyFields { uint128 gasPrice; uint256 v; bytes32 r; bytes32 s; }
    struct Type1Fields { uint64 chainId; uint128 gasPrice; AccessListEntry[] accessList; uint8 yParity; bytes32 r; bytes32 s; }
    struct Type2Fields { uint64 chainId; uint128 maxPriorityFeePerGas; uint128 maxFeePerGas; AccessListEntry[] accessList; uint8 yParity; bytes32 r; bytes32 s; }
    struct Type3Fields { uint64 chainId; uint128 maxPriorityFeePerGas; uint128 maxFeePerGas; AccessListEntry[] accessList; uint256 maxFeePerBlobGas; bytes32[] blobVersionedHashes; uint8 yParity; bytes32 r; bytes32 s; }
    struct Type4Fields { uint64 chainId; uint128 maxPriorityFeePerGas; uint128 maxFeePerGas; AccessListEntry[] accessList; AuthorizationListEntry[] authorizationList; uint8 yParity; bytes32 r; bytes32 s; }

    /**
     * @notice Decoded transaction structure - separates common TX fields, type-specific fields, and receipt fields
     * @dev This clean structure matches the chunk organization (chunk 1: common TX, chunk 2+: type-specific, last chunk: receipt)
     */
    struct DecodedTransactionType0 { CommonTxFields commonTx; LegacyFields type0; ReceiptFields receipt; }
    struct DecodedTransactionType1 { CommonTxFields commonTx; Type1Fields type1; ReceiptFields receipt; }
    struct DecodedTransactionType2 { CommonTxFields commonTx; Type2Fields type2; ReceiptFields receipt; }
    struct DecodedTransactionType3 { CommonTxFields commonTx; Type3Fields type3; ReceiptFields receipt; }
    struct DecodedTransactionType4 { CommonTxFields commonTx; Type4Fields type4; ReceiptFields receipt; }

    // ---------- Public utils ----------
    /**
     * @notice Extracts transaction type from (uint8, bytes[]) encoded format without full decode
     * @param encodedTx - ABI-encoded (uint8, bytes[]) where uint8 is the transaction type
     * @return txType - Transaction type (0-4)
     * @dev Decodes only the first uint8 parameter without decoding the entire bytes[] array
     */
    function getTransactionType(bytes memory encodedTx) public pure returns (uint8 txType) {
        // Decode only the first uint8, ignoring the bytes[] array
        // The uint8 is at offset 32-63 (padded to 32 bytes), actual value at byte 63
        assembly {
            // Directly load and extract: encodedTx points to length, +32 gets data start
            txType := byte(31, mload(add(encodedTx, 32)))
        }
    }

    function isValidTransactionType(uint8 txType) public pure returns (bool) { return txType <= 4; }

    /**
     * @notice Filters logs by event signature
     * @param receipt - Receipt fields containing logs
     * @param eventSignature - Event signature (keccak256 hash of event signature)
     * @return Filtered logs matching the event signature
     */
    function getLogsByEventSignature(ReceiptFields memory receipt, bytes32 eventSignature)
        public pure returns (LogEntry[] memory)
    { return getLogsByEventSignature(receipt.receiptLogs, eventSignature); }

    /**
     * @notice Filters logs by event signature
     * @param logs - Array of log entries
     * @param eventSignature - Event signature (keccak256 hash of event signature)
     * @return Filtered logs matching the event signature
     */
    function getLogsByEventSignature(LogEntry[] memory logs, bytes32 eventSignature)
        public pure returns (LogEntry[] memory)
    {
        uint256 n;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == eventSignature) n++;
        }
        LogEntry[] memory out_ = new LogEntry[](n);
        uint256 k;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == eventSignature) out_[k++] = logs[i];
        }
        return out_;
    }

    // ---------- Public decoders ----------
    function decodeTransactionType0(bytes memory chunk) public pure returns (DecodedTransactionType0 memory) { require(chunk.length > 0, "EvmV1Decoder: Empty"); return _decodeType0(chunk); }
    function decodeTransactionType1(bytes memory chunk) public pure returns (DecodedTransactionType1 memory) { require(chunk.length > 0, "EvmV1Decoder: Empty"); return _decodeType1(chunk); }
    function decodeTransactionType2(bytes memory chunk) public pure returns (DecodedTransactionType2 memory) { require(chunk.length > 0, "EvmV1Decoder: Empty"); return _decodeType2(chunk); }
    function decodeTransactionType3(bytes memory chunk) public pure returns (DecodedTransactionType3 memory) { require(chunk.length > 0, "EvmV1Decoder: Empty"); return _decodeType3(chunk); }
    function decodeTransactionType4(bytes memory chunk) public pure returns (DecodedTransactionType4 memory) { require(chunk.length > 0, "EvmV1Decoder: Empty"); return _decodeType4(chunk); }

    // ---------- Selective decoders (gas-efficient) ----------
    /**
     * @notice Decodes only common transaction fields (chunk 1) from any transaction type
     * @param chunk - ABI-encoded (uint8, bytes[]) where bytes[] contains explicitly chunked chunks
     * @return Common transaction fields (nonce, gasLimit, from, toIsNull, to, value, data)
     * @dev Use this when you only need common TX fields, not receipt or type-specific fields
     * @dev Gas-efficient: decodes only chunk 1 instead of all chunks
     * @dev Tip: Decode once in memory and reuse the struct to avoid redundant decoding
     */
    function decodeCommonTxFields(bytes memory chunk) public pure returns (CommonTxFields memory) {
        require(chunk.length > 0, "EvmV1Decoder: Empty");
        return _decodeCommonTxChunk(chunk);
    }

    /**
     * @notice Decodes only receipt fields (last chunk) from any transaction type
     * @param chunk - ABI-encoded (uint8, bytes[]) where bytes[] contains explicitly chunked chunks
     * @return Receipt fields (receiptStatus, receiptGasUsed, receiptLogs, receiptLogsBloom)
     * @dev Use this when you only need receipt fields, not transaction fields
     * @dev Gas-efficient: decodes only the last chunk instead of all chunks
     * @dev Tip: Decode once in memory and reuse the struct to avoid redundant decoding
     */
    function decodeReceiptFields(bytes memory chunk) public pure returns (ReceiptFields memory) {
        require(chunk.length > 0, "EvmV1Decoder: Empty");
        uint8 txType = getTransactionType(chunk);
        require(txType <= 4, "EvmV1Decoder: Invalid transaction type");
        return _decodeReceiptChunk(chunk, txType);
    }

    /**
     * @notice Decodes only type-specific fields for Type 0 transaction (chunk 2)
     * @param chunk - ABI-encoded (uint8, bytes[]) where bytes[] contains explicitly chunked chunks
     * @return Type-specific fields (gasPrice, v)
     * @dev Use this when you only need type-specific fields, not common TX or receipt fields
     * @dev Gas-efficient: decodes only chunk 2 instead of all chunks
     */
    function decodeTypeSpecificFieldsType0(bytes memory chunk) public pure returns (LegacyFields memory) {
        require(chunk.length > 0, "EvmV1Decoder: Empty");
        (uint8 type_, bytes[] memory chunks) = abi.decode(chunk, (uint8, bytes[]));
        require(type_ == 0, "EvmV1Decoder: Invalid transaction type");
        require(chunks.length == 3, "EvmV1Decoder: Invalid chunk count for Type 0");
        return _decodeTypeSpecificChunkType0(chunks[1]);
    }

    /**
     * @notice Decodes only type-specific fields for Type 1 transaction (chunk 2)
     * @param chunk - ABI-encoded (uint8, bytes[]) where bytes[] contains explicitly chunked chunks
     * @return Type-specific fields (chainId, gasPrice, accessList, yParity)
     * @dev Use this when you only need type-specific fields, not common TX or receipt fields
     * @dev Gas-efficient: decodes only chunk 2 instead of all chunks
     */
    function decodeTypeSpecificFieldsType1(bytes memory chunk) public pure returns (Type1Fields memory) {
        require(chunk.length > 0, "EvmV1Decoder: Empty");
        (uint8 type_, bytes[] memory chunks) = abi.decode(chunk, (uint8, bytes[]));
        require(type_ == 1, "EvmV1Decoder: Invalid transaction type");
        require(chunks.length == 3, "EvmV1Decoder: Invalid chunk count for Type 1");
        return _decodeTypeSpecificChunkType1(chunks[1]);
    }

    /**
     * @notice Decodes only type-specific fields for Type 2 transaction (chunk 2)
     * @param chunk - ABI-encoded (uint8, bytes[]) where bytes[] contains explicitly chunked chunks
     * @return Type-specific fields (chainId, maxPriorityFeePerGas, maxFeePerGas, accessList, yParity)
     * @dev Use this when you only need type-specific fields, not common TX or receipt fields
     * @dev Gas-efficient: decodes only chunk 2 instead of all chunks
     */
    function decodeTypeSpecificFieldsType2(bytes memory chunk) public pure returns (Type2Fields memory) {
        require(chunk.length > 0, "EvmV1Decoder: Empty");
        (uint8 type_, bytes[] memory chunks) = abi.decode(chunk, (uint8, bytes[]));
        require(type_ == 2, "EvmV1Decoder: Invalid transaction type");
        require(chunks.length == 3, "EvmV1Decoder: Invalid chunk count for Type 2");
        return _decodeTypeSpecificChunkType2(chunks[1]);
    }

    /**
     * @notice Decodes only type-specific fields for Type 3 transaction (chunks 2 and 3)
     * @param chunk - ABI-encoded (uint8, bytes[]) where bytes[] contains explicitly chunked chunks
     * @return Type-specific fields (chainId, maxPriorityFeePerGas, maxFeePerGas, accessList, maxFeePerBlobGas, blobVersionedHashes, yParity)
     * @dev Use this when you only need type-specific fields, not common TX or receipt fields
     * @dev Gas-efficient: decodes only chunks 2 and 3 instead of all chunks
     */
    function decodeTypeSpecificFieldsType3(bytes memory chunk) public pure returns (Type3Fields memory) {
        require(chunk.length > 0, "EvmV1Decoder: Empty");
        (uint8 type_, bytes[] memory chunks) = abi.decode(chunk, (uint8, bytes[]));
        require(type_ == 3, "EvmV1Decoder: Invalid transaction type");
        require(chunks.length == 4, "EvmV1Decoder: Invalid chunk count for Type 3");
        return _decodeTypeSpecificChunkType3(chunks[1], chunks[2]);
    }

    /**
     * @notice Decodes only type-specific fields for Type 4 transaction (chunks 2 and 3)
     * @param chunk - ABI-encoded (uint8, bytes[]) where bytes[] contains explicitly chunked chunks
     * @return Type-specific fields (chainId, maxPriorityFeePerGas, maxFeePerGas, accessList, authorizationList, yParity)
     * @dev Use this when you only need type-specific fields, not common TX or receipt fields
     * @dev Gas-efficient: decodes only chunks 2 and 3 instead of all chunks
     */
    function decodeTypeSpecificFieldsType4(bytes memory chunk) public pure returns (Type4Fields memory) {
        require(chunk.length > 0, "EvmV1Decoder: Empty");
        (uint8 type_, bytes[] memory chunks) = abi.decode(chunk, (uint8, bytes[]));
        require(type_ == 4, "EvmV1Decoder: Invalid transaction type");
        require(chunks.length == 4, "EvmV1Decoder: Invalid chunk count for Type 4");
        return _decodeTypeSpecificChunkType4(chunks[1], chunks[2]);
    }

    // ---------- Helper ----------
    function _toLogs(LogEntryTuple[] memory t) private pure returns (LogEntry[] memory) {
        LogEntry[] memory out_ = new LogEntry[](t.length);
        for (uint256 i; i < t.length; i++) {
            out_[i] = LogEntry({ address_: t[i].address_, topics: t[i].topics, data: t[i].data });
        }
        return out_;
    }

    // ---------- Internal helper functions for selective decoding ----------
    /**
     * @notice Decodes chunk 1 (common transaction fields) from (uint8, bytes[]) format
     * @param chunk - ABI-encoded (uint8, bytes[]) where bytes[] contains explicitly chunked chunks
     * @return common Common transaction fields
     */
    function _decodeCommonTxChunk(bytes memory chunk) internal pure returns (CommonTxFields memory common) {
        (uint8 decodedTxType, bytes[] memory chunks) = abi.decode(chunk, (uint8, bytes[]));
        require(decodedTxType <= 4, "EvmV1Decoder: Invalid transaction type");
        require(chunks.length == 3 || chunks.length == 4, "EvmV1Decoder: Invalid chunk count");

        uint64 nonce;
        uint64 gasLimit;
        address from;
        bool toIsNull;
        address to;
        uint256 value;
        bytes memory data;

        (nonce, gasLimit, from, toIsNull, to, value, data) = abi.decode(chunks[0], (
            uint64, uint64, address, bool, address, uint256, bytes
        ));

        common.nonce = nonce;
        common.gasLimit = gasLimit;
        common.from = from;
        common.toIsNull = toIsNull;
        common.to = to;
        common.value = value;
        common.data = data;
    }

    /**
     * @notice Decodes receipt chunk (last chunk) from (uint8, bytes[]) format
     * @param chunk - ABI-encoded (uint8, bytes[]) where bytes[] contains explicitly chunked chunks
     * @param txType - Transaction type (0-4) to determine which chunk index contains receipt
     * @return receipt Receipt fields
     * @dev Types 0, 1, 2: receipt at chunk index 2
     * @dev Types 3, 4: receipt at chunk index 3
     */
    function _decodeReceiptChunk(bytes memory chunk, uint8 txType) internal pure returns (ReceiptFields memory receipt) {
        (, bytes[] memory chunks) = abi.decode(chunk, (uint8, bytes[]));
        require(txType <= 4, "EvmV1Decoder: Invalid transaction type");

        uint256 receiptChunkIndex;
        if (txType <= 2) {
            receiptChunkIndex = 2;
            require(chunks.length == 3, "EvmV1Decoder: Invalid chunk count for Type 0-2");
        } else {
            receiptChunkIndex = 3;
            require(chunks.length == 4, "EvmV1Decoder: Invalid chunk count for Type 3-4");
        }

        uint8 receiptStatus;
        uint64 receiptGasUsed;
        LogEntryTuple[] memory receiptLogs;
        bytes memory receiptLogsBloom;

        (receiptStatus, receiptGasUsed, receiptLogs, receiptLogsBloom) = abi.decode(chunks[receiptChunkIndex], (
            uint8, uint64, LogEntryTuple[], bytes
        ));

        receipt.receiptStatus = receiptStatus;
        receipt.receiptGasUsed = receiptGasUsed;
        receipt.receiptLogs = _toLogs(receiptLogs);
        receipt.receiptLogsBloom = receiptLogsBloom;
    }

    // ---------- Helper functions for access list and authorization list conversion ----------
    /**
     * @notice Converts AccessListEntryBytes32[] to AccessListEntry[]
     */
    function _convertAccessListBytes32(AccessListEntryBytes32[] memory src) private pure returns (AccessListEntry[] memory) {
        AccessListEntry[] memory dst = new AccessListEntry[](src.length);
        for (uint256 i; i < src.length; i++) {
            dst[i] = AccessListEntry({
                account: src[i].account,
                storageKeys: src[i].storageKeys
            });
        }
        return dst;
    }

    /**
     * @notice Converts AccessListEntryUint256[] to AccessListEntry[]
     */
    function _convertAccessListUint256(AccessListEntryUint256[] memory src) private pure returns (AccessListEntry[] memory) {
        AccessListEntry[] memory dst = new AccessListEntry[](src.length);
        for (uint256 i; i < src.length; i++) {
            uint256[] memory srcKeys = src[i].storageKeys;
            bytes32[] memory dstKeys = new bytes32[](srcKeys.length);
            for (uint256 j; j < srcKeys.length; j++) {
                dstKeys[j] = bytes32(srcKeys[j]);
            }
            dst[i] = AccessListEntry({
                account: src[i].account,
                storageKeys: dstKeys
            });
        }
        return dst;
    }

    /**
     * @notice Copies AuthorizationListEntry[] array
     */
    function _copyAuthorizationList(AuthorizationListEntry[] memory src) private pure returns (AuthorizationListEntry[] memory) {
        AuthorizationListEntry[] memory dst = new AuthorizationListEntry[](src.length);
        for (uint256 i; i < src.length; i++) {
            dst[i] = AuthorizationListEntry({
                chainId: src[i].chainId,
                account: src[i].account,
                nonce: src[i].nonce,
                yParity: src[i].yParity,
                r: src[i].r,
                s: src[i].s
            });
        }
        return dst;
    }

    // ---------- Type-specific chunk decoders ----------
    /**
     * @notice Decodes type-specific chunk for Type 0 (chunk 2)
     */
    function _decodeTypeSpecificChunkType0(bytes memory chunk) internal pure returns (LegacyFields memory type0) {
        uint128 gasPrice;
        uint256 v;
        bytes32 r;
        bytes32 s;
        (gasPrice, v, r, s) = abi.decode(chunk, (uint128, uint256, bytes32, bytes32));
        type0.gasPrice = gasPrice;
        type0.v = v;
        type0.r = r;
        type0.s = s;
    }

    /**
     * @notice Decodes type-specific chunk for Type 1 (chunk 2)
     */
    function _decodeTypeSpecificChunkType1(bytes memory chunk) internal pure returns (Type1Fields memory type1) {
        uint64 chainId;
        uint128 gasPrice;
        AccessListEntryBytes32[] memory accessList;
        uint8 yParity;
        bytes32 r;
        bytes32 s;

        (chainId, gasPrice, accessList, yParity, r, s) = abi.decode(chunk, (
            uint64, uint128, AccessListEntryBytes32[], uint8, bytes32, bytes32
        ));

        type1.chainId = chainId;
        type1.gasPrice = gasPrice;
        type1.yParity = yParity;
        type1.r = r;
        type1.s = s;
        type1.accessList = _convertAccessListBytes32(accessList);
    }

    /**
     * @notice Decodes type-specific chunk for Type 2 (chunk 2)
     */
    function _decodeTypeSpecificChunkType2(bytes memory chunk) internal pure returns (Type2Fields memory type2) {
        uint64 chainId;
        uint128 maxPriorityFeePerGas;
        uint128 maxFeePerGas;
        AccessListEntryBytes32[] memory accessList;
        uint8 yParity;
        bytes32 r;
        bytes32 s;

        (chainId, maxPriorityFeePerGas, maxFeePerGas, accessList, yParity, r, s) = abi.decode(chunk, (
            uint64, uint128, uint128, AccessListEntryBytes32[], uint8, bytes32, bytes32
        ));

        type2.chainId = chainId;
        type2.maxPriorityFeePerGas = maxPriorityFeePerGas;
        type2.maxFeePerGas = maxFeePerGas;
        type2.yParity = yParity;
        type2.r = r;
        type2.s = s;
        type2.accessList = _convertAccessListBytes32(accessList);
    }

    /**
     * @notice Decodes type-specific chunks for Type 3 (chunks 2 and 3)
     */
    function _decodeTypeSpecificChunkType3(bytes memory chunk2, bytes memory chunk3) internal pure returns (Type3Fields memory type3) {
        // Decode chunk 2
        uint64 chainId;
        uint128 maxPriorityFeePerGas;
        uint128 maxFeePerGas;
        AccessListEntryUint256[] memory accessList;

        (chainId, maxPriorityFeePerGas, maxFeePerGas, accessList) = abi.decode(chunk2, (
            uint64, uint128, uint128, AccessListEntryUint256[]
        ));

        // Decode chunk 3 (includes signature)
        uint256 maxFeePerBlobGas;
        bytes32[] memory blobVersionedHashes;
        uint8 yParity;
        bytes32 r;
        bytes32 s;

        (maxFeePerBlobGas, blobVersionedHashes, yParity, r, s) = abi.decode(chunk3, (
            uint256, bytes32[], uint8, bytes32, bytes32
        ));

        type3.chainId = chainId;
        type3.maxPriorityFeePerGas = maxPriorityFeePerGas;
        type3.maxFeePerGas = maxFeePerGas;
        type3.maxFeePerBlobGas = maxFeePerBlobGas;
        type3.blobVersionedHashes = blobVersionedHashes;
        type3.yParity = yParity;
        type3.r = r;
        type3.s = s;
        type3.accessList = _convertAccessListUint256(accessList);
    }

    /**
     * @notice Decodes type-specific chunks for Type 4 (chunks 2 and 3)
     */
    function _decodeTypeSpecificChunkType4(bytes memory chunk2, bytes memory chunk3) internal pure returns (Type4Fields memory type4) {
        // Decode chunk 2
        uint64 chainId;
        uint128 maxPriorityFeePerGas;
        uint128 maxFeePerGas;
        AccessListEntryUint256[] memory accessList;

        (chainId, maxPriorityFeePerGas, maxFeePerGas, accessList) = abi.decode(chunk2, (
            uint64, uint128, uint128, AccessListEntryUint256[]
        ));

        // Decode chunk 3 (includes signature)
        AuthorizationListEntry[] memory authorizationList;
        uint8 yParity;
        bytes32 r;
        bytes32 s;

        (authorizationList, yParity, r, s) = abi.decode(chunk3, (
            AuthorizationListEntry[], uint8, bytes32, bytes32
        ));

        type4.chainId = chainId;
        type4.maxPriorityFeePerGas = maxPriorityFeePerGas;
        type4.maxFeePerGas = maxFeePerGas;
        type4.yParity = yParity;
        type4.r = r;
        type4.s = s;
        type4.accessList = _convertAccessListUint256(accessList);
        type4.authorizationList = _copyAuthorizationList(authorizationList);
    }

    // ---------- Final assemblers ----------
    function _decodeType0(bytes memory chunk) internal pure returns (DecodedTransactionType0 memory d) {
        // Decode chunks and validate transaction type
        (uint8 decodedTxType, bytes[] memory chunks) = abi.decode(chunk, (uint8, bytes[]));
        require(decodedTxType == 0, "EvmV1Decoder: Mismatched transaction type, expected 0");
        require(chunks.length == 3, "EvmV1Decoder: Invalid chunk count for Type 0");

        // Decode common transaction fields and receipt fields (shared across all types)
        CommonTxFields memory commonTx = _decodeCommonTxChunk(chunk);
        ReceiptFields memory receipt = _decodeReceiptChunk(chunk, decodedTxType);

        // Decode type-specific chunk
        d.type0 = _decodeTypeSpecificChunkType0(chunks[1]);

        // Assemble structs
        d.commonTx = commonTx;
        d.receipt = receipt;
    }

    function _decodeType1(bytes memory chunk) internal pure returns (DecodedTransactionType1 memory d) {
        // Decode chunks and validate transaction type
        (uint8 decodedTxType, bytes[] memory chunks) = abi.decode(chunk, (uint8, bytes[]));
        require(decodedTxType == 1, "EvmV1Decoder: Mismatched transaction type, expected 1");
        require(chunks.length == 3, "EvmV1Decoder: Invalid chunk count for Type 1");
        
        // Decode common transaction fields and receipt fields (shared across all types)
        CommonTxFields memory commonTx = _decodeCommonTxChunk(chunk);
        ReceiptFields memory receipt = _decodeReceiptChunk(chunk, decodedTxType);

        // Decode type-specific chunk
        d.type1 = _decodeTypeSpecificChunkType1(chunks[1]);

        // Assemble structs
        d.commonTx = commonTx;
        d.receipt = receipt;
    }

    function _decodeType2(bytes memory chunk) internal pure returns (DecodedTransactionType2 memory d) {
        // Decode chunks and validate transaction type
        (uint8 decodedTxType, bytes[] memory chunks) = abi.decode(chunk, (uint8, bytes[]));
        require(decodedTxType == 2, "EvmV1Decoder: Mismatched transaction type, expected 2");
        require(chunks.length == 3, "EvmV1Decoder: Invalid chunk count for Type 2");

        // Decode common transaction fields and receipt fields (shared across all types)
        CommonTxFields memory commonTx = _decodeCommonTxChunk(chunk);
        ReceiptFields memory receipt = _decodeReceiptChunk(chunk, decodedTxType);

        // Decode type-specific chunk
        d.type2 = _decodeTypeSpecificChunkType2(chunks[1]);

        // Assemble structs
        d.commonTx = commonTx;
        d.receipt = receipt;
    }

    function _decodeType3(bytes memory chunk) internal pure returns (DecodedTransactionType3 memory d) {
        // Decode chunks and validate transaction type
        (uint8 decodedTxType, bytes[] memory chunks) = abi.decode(chunk, (uint8, bytes[]));
        require(decodedTxType == 3, "EvmV1Decoder: Mismatched transaction type, expected 3");
        require(chunks.length == 4, "EvmV1Decoder: Invalid chunk count for Type 3");

        // Decode common transaction fields and receipt fields (shared across all types)
        CommonTxFields memory commonTx = _decodeCommonTxChunk(chunk);
        ReceiptFields memory receipt = _decodeReceiptChunk(chunk, decodedTxType);

        // Decode type-specific chunks (2 and 3)
        d.type3 = _decodeTypeSpecificChunkType3(chunks[1], chunks[2]);

        // Assemble structs
        d.commonTx = commonTx;
        d.receipt = receipt;
    }

    function _decodeType4(bytes memory chunk) internal pure returns (DecodedTransactionType4 memory d) {
        // Decode chunks and validate transaction type
        (uint8 decodedTxType, bytes[] memory chunks) = abi.decode(chunk, (uint8, bytes[]));
        require(decodedTxType == 4, "EvmV1Decoder: Mismatched transaction type, expected 4");
        require(chunks.length == 4, "EvmV1Decoder: Invalid chunk count for Type 4");

        CommonTxFields memory commonTx = _decodeCommonTxChunk(chunk);
        ReceiptFields memory receipt = _decodeReceiptChunk(chunk, decodedTxType);

        // Decode type-specific chunks (2 and 3)
        d.type4 = _decodeTypeSpecificChunkType4(chunks[1], chunks[2]);

        // Assemble structs
        d.commonTx = commonTx;
        d.receipt = receipt;
    }
}
