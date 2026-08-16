import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider, Contract } from 'ethers';
import { utils as uscUtils } from '@gluwa/usc-sdk';

// Off-chain cross-check: decode the verified transaction bytes with the on-chain
// EvmV1Decoder library (same one the SpikeConsumer uses) and print the Repayment event.
// Usage: node src/decode-tx.mjs <txBytes_hex>
const txBytes = process.argv[2];
if (!txBytes) {
  console.error('usage: node src/decode-tx.mjs <txBytes>');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const decoderAddress = '0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f'; // CC3 testnet
const provider = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL);
const decoder = new Contract(decoderAddress, ['function decodeEvmV1Transaction(bytes)', 'function getTransactionType(bytes)'], provider);

const decoded = await uscUtils.decoder.decodeEvmV1Transaction(txBytes, decoder);
const receipt = decoded.data.receipt;
console.log('tx type        :', decoded.type);
console.log('receipt status :', receipt.receiptStatus);
console.log('from           :', decoded.data.commonTx.from);
for (const log of receipt.receiptLogs) {
  console.log('log            : address=', log.address_, 'topics=', log.topics.map((t) => t), 'dataLen=', log.data.length);
}