import 'dotenv/config';
import { JsonRpcProvider, Contract } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chainInfo, proofProvider } from '@gluwa/usc-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const txHash = process.argv[2];
const consumerAddress = process.argv[3];
if (!txHash) {
  console.error('usage: node src/debug.mjs <txHash> <consumerAddress>');
  process.exit(1);
}

const cc = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL);
const BLOCK_PROVER = '0x0000000000000000000000000000000000000FD2';
const bpAbi = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../node_modules/@gluwa/usc-sdk/dist/block-prover/block_prover.json'), 'utf8'));

const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(cc);
const chains = await chainInfoProvider.getSupportedChains();
const chainKey = Number(chains.find((c) => Number(c.chainId) === 11155111).chainKey);

const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, process.env.PROOF_BUILDER_URL);
const r = await proofBuilder.getProof(txHash);
if (!r.success) {
  console.error('proof failed:', r.error);
  process.exit(1);
}
const d = r.data;
console.log('headerNumber      :', d.headerNumber);
console.log('txIndex           :', d.txIndex);
console.log('merkleRoot        :', d.merkleProof.root);
console.log('siblings count    :', d.merkleProof.siblings.length);
console.log('lowerEndpointDigest:', d.continuityProof.lowerEndpointDigest);
console.log('cont roots count  :', d.continuityProof.roots.length);

// 1) call precompile verifyAndEmit directly via eth_call (returns bool)
const bp = new Contract(BLOCK_PROVER, bpAbi, cc);
const singleFn = bp.getFunction('verifyAndEmit(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))');
const verifyFn = bp.getFunction('verify(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))');
try {
  const ok = await singleFn.staticCall(d.chainKey, d.headerNumber, d.txBytes, d.merkleProof, d.continuityProof);
  console.log('precompile verifyAndEmit(single) (eth_call):', ok);
} catch (e) {
  console.log('precompile verifyAndEmit(single) (eth_call) REVERTED:', e.shortMessage ?? e.message);
  if (e.data) console.log('revert data:', e.data);
}
try {
  const ok = await verifyFn.staticCall(d.chainKey, d.headerNumber, d.txBytes, d.merkleProof, d.continuityProof);
  console.log('precompile verify(single) (eth_call)       :', ok);
} catch (e) {
  console.log('precompile verify(single) (eth_call) REVERTED:', e.shortMessage ?? e.message);
  if (e.data) console.log('revert data:', e.data);
}

// 2) call consumer.execute via eth_call and surface revert reason
if (consumerAddress) {
  const art = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../contracts/out/SpikeConsumer.sol/SpikeConsumer.json'), 'utf8'));
  const consumer = new Contract(consumerAddress, art.abi, cc);
  try {
    const ok = await consumer.execute.staticCall(
      d.chainKey, d.headerNumber, d.txBytes,
      d.merkleProof.root, d.merkleProof.siblings,
      d.continuityProof.lowerEndpointDigest, d.continuityProof.roots
    );
    console.log('consumer.execute (eth_call):', ok);
  } catch (e) {
    console.log('consumer.execute (eth_call) REVERTED:', e.shortMessage ?? e.message);
    if (e.data) {
      try {
        console.log('decoded revert:', consumer.interface.parseError(e.data)?.name);
      } catch {
        console.log('revert data:', e.data.slice(0, 200));
      }
    }
  }
}