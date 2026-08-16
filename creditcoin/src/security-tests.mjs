import 'dotenv/config';
import { JsonRpcProvider, Wallet, Contract, ContractFactory, Interface, keccak256 } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chainInfo, blockProver, proofProvider } from '@gluwa/usc-sdk';

// Phase 0 security tests (AGENTS.md build order step 2), against the throwaway
// spike consumer. Usage: node src/security-tests.mjs <sepolia_tx_hash> [block_hex]
// Defaults: the Phase 0 repay tx.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const consumerArt = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../contracts/out/SpikeConsumer.sol/SpikeConsumer.json'), 'utf8')
);
const decoderAbi = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../contracts/out/EvmV1Decoder.sol/EvmV1Decoder.json'), 'utf8')
).abi;

const SOURCE_TX = process.argv[2] ?? '0xbd0cdaf5ed7c37ca8472b60fc9f1fcadfd829368a943465b7951b5e2ed781c9c';
const DECODER = '0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f';
const REPAY_SIG = '0x24fcca58a997b1b2eff6db8107e860458544c09ddd3693b3b779e1df6c0d6c5d';

const source = new JsonRpcProvider(process.env.SOURCE_RPC_URL);
const cc = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL);
const wallet = new Wallet(process.env.CREDITCOIN_PRIVATE_KEY, cc);

const results = { tests: [] };
function record(name, detail) {
  results.tests.push({ name, ...detail });
  console.log(`\n===== ${name} =====`);
  for (const [k, v] of Object.entries(detail)) console.log(`  ${k}: ${v}`);
}

async function run() {
  const cip = new chainInfo.PrecompileChainInfoProvider(cc);
  const chains = await cip.getSupportedChains();
  const chainKey = Number(chains.find((c) => Number(c.chainId) === 11155111).chainKey);

  const deployConsumer = async (label) => {
    const factory = new ContractFactory(consumerArt.abi, consumerArt.bytecode.object, wallet);
    const c = await factory.deploy(DECODER);
    await c.deploymentTransaction().wait();
    console.log(`${label} SpikeConsumer :`, await c.getAddress());
    return c;
  };

  const consumerMain = await deployConsumer('main (baseline/replay)');
  const consumerFresh = await deployConsumer('fresh (tamper tests)');

  const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, process.env.PROOF_BUILDER_URL);

  // --- proof for the valid repay tx ---
  const srcTx = await source.getTransaction(SOURCE_TX);
  console.log('source tx block     :', srcTx.blockNumber);
  await proofBuilder.waitUntilHeightAttested(chainKey, srcTx.blockNumber);
  const valid = await proofBuilder.getProof(SOURCE_TX);
  if (!valid.success) throw new Error('valid proof failed: ' + JSON.stringify(valid.error));
  const d = valid.data;
  results.sourceTx = SOURCE_TX;

  // locate field offsets from the decoded log (robust)
  const decoder = new Contract(DECODER, decoderAbi, cc);
  const rxf = await decoder.decodeReceiptFields(d.txBytes);
  const log = rxf.receiptLogs[0];
  const hex = d.txBytes.slice(2).toLowerCase();
  const sigWord = REPAY_SIG.slice(2).toLowerCase();
  const borrowerWord = log.topics[1].slice(2).toLowerCase();
  const loanIdWord = log.topics[2].slice(2).toLowerCase();
  const amountWord = log.data.slice(2).toLowerCase();
  const seqIdx = hex.indexOf(sigWord + borrowerWord + loanIdWord);
  if (seqIdx < 0) throw new Error('could not locate log topic sequence in txBytes');
  const borrowerOff = seqIdx + 64;
  const loanIdOff = seqIdx + 128;
  const probe = '0000000000000000000000000000000000000000000000000000000000000020' + amountWord;
  let probeIdx = -1;
  while ((probeIdx = hex.indexOf(probe, probeIdx + 1)) >= 0) if (probeIdx % 64 === 0) break;
  if (probeIdx < 0 || probeIdx % 64 !== 0) throw new Error('could not locate amount word');
  const amountOff = probeIdx + 64;
  console.log(`field offsets: borrower=${borrowerOff} loanId=${loanIdOff} amount=${amountOff}`);

  const tamperTo = (word, val) => '0x' + hex.slice(0, word) + val + hex.slice(word + 64);
  const fakeBorrower = '000000000000000000000000deaddeaddeaddeaddeaddeaddeaddeaddeaddead';
  const fakeLoanId = loanIdWord.slice(0, -1) + 'b';      // 0x...2a -> 0x...2b
  const fakeAmount = amountWord.slice(0, -1) + '1';      // ...3b8b87c0 -> ...3b8b87c1

  const prover = new blockProver.PrecompileBlockProver(cc);

  async function verifyResponse(txBytes, proofArgs = d) {
    try {
      const v = await prover.verifySingle(chainKey, proofArgs.headerNumber, txBytes, proofArgs.merkleProof, proofArgs.continuityProof);
      return { ok: true, response: String(v) };
    } catch (e) {
      return { ok: false, response: e.shortMessage ?? e.message, data: (e.data ?? '').slice(0, 140) };
    }
  }

  async function executeRejection(consumer, txBytes, proofArgs = d) {
    try {
      const r = await consumer.execute.staticCall(
        chainKey, proofArgs.headerNumber, txBytes, proofArgs.merkleProof.root,
        proofArgs.merkleProof.siblings, proofArgs.continuityProof.lowerEndpointDigest,
        proofArgs.continuityProof.roots
      );
      return { reverted: false, response: String(r) };
    } catch (e) {
      return { reverted: true, response: e.shortMessage ?? e.message, data: (e.data ?? '').slice(0, 140) };
    }
  }

  async function tamperedFields(txBytes) {
    try {
      const r = await decoder.decodeReceiptFields(txBytes);
      const l = r.receiptLogs[0];
      return { topics1: l.topics[1], topics2: l.topics[2], data: l.data };
    } catch (e) {
      return { decodeError: e.shortMessage ?? e.message };
    }
  }

  // ===== BASELINE: valid submission =====
  const t0 = Date.now();
  const tx = await consumerMain.execute(
    chainKey, d.headerNumber, d.txBytes, d.merkleProof.root, d.merkleProof.siblings,
    d.continuityProof.lowerEndpointDigest, d.continuityProof.roots, { gasLimit: 3000000 }
  );
  const receipt = await tx.wait();
  const queryId = keccak256(
    '0x' + chainKey.toString(16).padStart(64, '0') +
    d.headerNumber.toString(16).padStart(16, '0') +
    d.txIndex.toString(16).padStart(16, '0') +
    '00'.repeat(24)
  );
  record('BASELINE valid submission', {
    tx: tx.hash,
    block: receipt.blockNumber,
    status: receipt.status,
    queryId,
    elapsed_s: ((Date.now() - t0) / 1000).toFixed(1),
  });

  // ===== TEST 3: replayed query =====
  const replay = await executeRejection(consumerMain, d.txBytes);
  record('TEST 3 replayed query (same proof resubmitted)', replay);

  // ===== TEST 1: fake borrower =====
  const tamperedBorrower = tamperTo(borrowerOff, fakeBorrower);
  const fb = await tamperedFields(tamperedBorrower);
  const vB = await verifyResponse(tamperedBorrower);
  const eB = await executeRejection(consumerFresh, tamperedBorrower);
  record('TEST 1 fake borrower (log topic[1] -> dead...dead)', {
    tampered_topics1: fb.topics1 ?? fb.decodeError,
    verifier: vB.response,
    consumer_execute: eB.response,
  });

  // ===== TEST 2: tampered amount =====
  const tamperedAmount = tamperTo(amountOff, fakeAmount);
  const fa = await tamperedFields(tamperedAmount);
  const vA = await verifyResponse(tamperedAmount);
  const eA = await executeRejection(consumerFresh, tamperedAmount);
  record('TEST 2 tampered amount (999000000 -> 999000001)', {
    tampered_data: fa.data ?? fa.decodeError,
    verifier: vA.response,
    consumer_execute: eA.response,
  });

  // ===== TEST 5: wrong loan ID =====
  const tamperedLoanId = tamperTo(loanIdOff, fakeLoanId);
  const fl = await tamperedFields(tamperedLoanId);
  const vL = await verifyResponse(tamperedLoanId);
  const eL = await executeRejection(consumerFresh, tamperedLoanId);
  record('TEST 5 wrong loan ID (42 -> 43)', {
    tampered_topics2: fl.topics2 ?? fl.decodeError,
    verifier: vL.response,
    consumer_execute: eL.response,
  });

  // ===== TEST 4a: nonexistent transaction =====
  const fakeHash = '0x' + 'f'.repeat(64);
  let fakeOut;
  try {
    const r = await proofBuilder.getProof(fakeHash);
    fakeOut = { returned_success: r.success, error: r.error, data: r.data ? { headerNumber: r.data.headerNumber, txIndex: r.data.txIndex } : undefined };
  } catch (e) {
    fakeOut = { threw: e.shortMessage ?? e.message };
  }
  record('TEST 4a nonexistent txHash (proof builder)', fakeOut);

  // ===== TEST 4b: real attested tx, wrong event (no Repayment log) =====
  const blockRaw = await source.send('eth_getBlockByNumber', ['0x' + srcTx.blockNumber.toString(16), false]);
  const otherHash = blockRaw.transactions.find((h) => h.toLowerCase() !== SOURCE_TX.toLowerCase());
  const otherProof = await proofBuilder.getProof(otherHash);
  if (otherProof.success) {
    const od = otherProof.data;
    await proofBuilder.waitUntilHeightAttested(chainKey, od.headerNumber);
    const eO = await executeRejection(consumerFresh, od.txBytes, od);
record('TEST 4b valid proof of non-repayment tx (txIndex ' + od.txIndex + ' in block ' + od.headerNumber + ')', {
      other_tx: otherHash,
      verifier: (await verifyResponse(od.txBytes, od)).response,
      consumer_execute: eO.response,
    });
  } else {
    record('TEST 4b valid proof of non-repayment tx', { other_tx: otherTx.hash, note: 'proof builder failed: ' + JSON.stringify(otherProof.error) });
  }

  // ===== replay on-chain state check =====
  const [count, borrower, loanId, amount] = await Promise.all([
    consumerMain.verifiedCount(), consumerMain.lastBorrower(), consumerMain.lastLoanId(), consumerMain.lastAmount(),
  ]);
  record('FINAL on-chain state', {
    verifiedCount: count.toString(),
    lastBorrower: borrower,
    lastLoanId: loanId.toString(),
    lastAmount: amount.toString(),
  });

  const outPath = path.resolve(__dirname, '../../docs/security-tests-raw.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log('\nraw results written to', outPath);
}

run().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});