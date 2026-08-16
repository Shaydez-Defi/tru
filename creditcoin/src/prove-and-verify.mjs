import 'dotenv/config';
import { JsonRpcProvider, Wallet, Contract } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chainInfo, blockProver, proofProvider } from '@gluwa/usc-sdk';

// Usage: node src/prove-and-verify.mjs <sepolia_tx_hash> <spike_consumer_address>
const [txHash, consumerAddress] = process.argv.slice(2);
if (!txHash || !consumerAddress) {
  console.error('usage: node src/prove-and-verify.mjs <txHash> <consumerAddress>');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactPath = path.resolve(__dirname, '../../contracts/out/SpikeConsumer.sol/SpikeConsumer.json');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const consumerAbi = artifact.abi;

const SEPSource = new JsonRpcProvider(process.env.SOURCE_RPC_URL);
const ccProvider = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL);
const wallet = new Wallet(process.env.CREDITCOIN_PRIVATE_KEY, ccProvider);
const proofBuilderUrl = process.env.PROOF_BUILDER_URL;

console.log('creditcoin account :', wallet.address);
console.log('spike consumer     :', consumerAddress);
console.log('sepolia tx         :', txHash);

const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(ccProvider);
const chains = await chainInfoProvider.getSupportedChains();
const sepolia = chains.find((c) => c.chainId === 11155111n || c.chainId === 11155111);
if (!sepolia) {
  console.error('Sepolia not in supported chains:', chains);
  process.exit(1);
}
const chainKey = Number(sepolia.chainKey);
console.log(`sepolia chainKey    : ${chainKey} (chainId ${sepolia.chainId})`);

const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, proofBuilderUrl);

// 1) find block + wait for attestation
const tx = await SEPSource.getTransaction(txHash);
if (!tx || tx.blockNumber == null) {
  console.error('transaction not found / not yet mined on Sepolia');
  process.exit(1);
}
const blockNumber = tx.blockNumber;
console.log(`sepolia block       : ${blockNumber}`);

const t0 = Date.now();
console.log('[1] waiting for Creditcoin attestation of block...');
await proofBuilder.waitUntilHeightAttested(chainKey, blockNumber);
console.log(`[1] block attested (waited ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

// 2) generate inclusion proof
const result = await proofBuilder.getProof(txHash);
if (!result.success || !result.data) {
  console.error('proof generation failed:', result.error);
  process.exit(1);
}
const { chainKey: ck, headerNumber, txBytes, merkleProof, continuityProof, txIndex } = result.data;
console.log(
  `[2] proof: header=${headerNumber} txIndex=${txIndex} cached=${result.data.cached}`
);

// 3) sanity: verify the proof against the on-chain precompile (view call, no gas)
const prover = new blockProver.PrecompileBlockProver(ccProvider);
const verified = await prover.verifySingle(ck, headerNumber, txBytes, merkleProof, continuityProof);
console.log(`[3] precompile verifySingle (eth_call): ${verified}`);
if (!verified) {
  console.error('on-chain verification FAILED');
  process.exit(1);
}

// 4) submit proof to SpikeConsumer (does its own verifyAndEmit + decode)
const consumer = new Contract(consumerAddress, consumerAbi, wallet);
const t1 = Date.now();
const submitTx = await consumer.execute(
  ck,
  headerNumber,
  txBytes,
  merkleProof.root,
  merkleProof.siblings,
  continuityProof.lowerEndpointDigest,
  continuityProof.roots
);
const receipt = await submitTx.wait();
const t2 = Date.now();
console.log(`[4] consumer.execute mined in block ${receipt.blockNumber} (tx ${receipt.hash}, ${((t2 - t1) / 1000).toFixed(1)}s)`);

// 5) parse the RepaymentVerified event emitted by the consumer
const parsed = [];
for (const log of receipt.logs) {
  try {
    const p = consumer.interface.parseLog(log);
    if (p) parsed.push(p);
  } catch {
    /* not our event */
  }
}
const repVerified = parsed.find((p) => p.name === 'RepaymentVerified');
if (repVerified) {
  console.log('[5] RepaymentVerified event:');
  console.log('    chainKey        =', repVerified.args.chainKey.toString());
  console.log('    blockHeight     =', repVerified.args.blockHeight.toString());
  console.log('    transactionIndex=', repVerified.args.transactionIndex.toString());
  console.log('    borrower        =', repVerified.args.borrower);
  console.log('    loanId          =', repVerified.args.loanId.toString());
  console.log('    amount          =', repVerified.args.amount.toString());
} else {
  console.log('[5] WARNING: no RepaymentVerified event parsed in receipt');
}

// 6) cross-check on-chain stored state
const [lastBorrower, lastLoanId, lastAmount, count] = await Promise.all([
  consumer.lastBorrower(),
  consumer.lastLoanId(),
  consumer.lastAmount(),
  consumer.verifiedCount(),
]);
console.log('[6] stored on-chain (last verified):');
console.log('    borrower        =', lastBorrower);
console.log('    loanId          =', lastLoanId.toString());
console.log('    amount          =', lastAmount.toString());
console.log('    verifiedCount   =', count.toString());

// 7) end-to-end timing
console.log(`\nE2E: repay->attested ${((Date.now() - t0) / 1000).toFixed(1)}s, submit->mined ${((t2 - t1) / 1000).toFixed(1)}s`);