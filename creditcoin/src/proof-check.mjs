import 'dotenv/config';
import { JsonRpcProvider, Contract } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chainInfo, blockProver, proofProvider, utils as uscUtils } from '@gluwa/usc-sdk';

// Gas-free proof check: attestation wait + proof generation + precompile verifySingle
// (view call) + off-chain decode of the verified transaction bytes.
// Usage: node src/proof-check.mjs <sepolia_tx_hash>
const txHash = process.argv[2];
if (!txHash) {
  console.error('usage: node src/proof-check.mjs <txHash>');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const decoderAddress = '0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f';
const decoderAbi = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../contracts/out/EvmV1Decoder.sol/EvmV1Decoder.json'),
    'utf8'
  )
).abi;

const source = new JsonRpcProvider(process.env.SOURCE_RPC_URL);
const cc = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL);

const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(cc);
const chains = await chainInfoProvider.getSupportedChains();
const sepolia = chains.find((c) => c.chainId === 11155111n || c.chainId === 11155111);
if (!sepolia) throw new Error('Sepolia not supported');
const chainKey = Number(sepolia.chainKey);
console.log('sepolia chainKey:', chainKey);

const tx = await source.getTransaction(txHash);
console.log('block:', tx.blockNumber, 'from:', tx.from, 'to:', tx.to);

const t0 = Date.now();
const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, process.env.PROOF_BUILDER_URL);
console.log('[1] waiting for attestation of block', tx.blockNumber);
await proofBuilder.waitUntilHeightAttested(chainKey, tx.blockNumber);
console.log(`[1] attested in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const result = await proofBuilder.getProof(txHash);
if (!result.success || !result.data) {
  console.error('proof generation failed:', result.error);
  process.exit(1);
}
const { chainKey: ck, headerNumber, txBytes, merkleProof, continuityProof, txIndex } = result.data;
console.log('[2] proof generated:', { headerNumber, txIndex, cached: result.data.cached });
console.log('    txBytes length:', txBytes.length, 'merkle siblings:', merkleProof.siblings.length, 'cont roots:', continuityProof.roots.length);

const prover = new blockProver.PrecompileBlockProver(cc);
const verified = await prover.verifySingle(ck, headerNumber, txBytes, merkleProof, continuityProof);
console.log('[3] precompile verifySingle (eth_call):', verified);

// off-chain decode cross-check using the same EvmV1Decoder the consumer uses
const decoder = new Contract(decoderAddress, decoderAbi, cc);
const decoded = await uscUtils.decoder.decodeEvmV1Transaction(txBytes, decoder);
const rx = decoded.data.receipt;
console.log('[4] decoded tx: type', decoded.type, '| receipt status', rx.receiptStatus);
for (const log of rx.receiptLogs) {
  console.log('    log address:', log.address_, 'topics:', log.topics.map((t) => t), 'data:', log.data);
}
console.log(`\nE2E (view path): ${((Date.now() - t0) / 1000).toFixed(1)}s`);