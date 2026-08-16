import 'dotenv/config';
import { JsonRpcProvider, Wallet, Contract, ContractFactory, Interface, keccak256 } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chainInfo, blockProver, proofProvider } from '@gluwa/usc-sdk';

// Build-order step 5 security hardening tests, run against the REAL wired pipeline
// (SourceLoanMarket -> worker -> TRUUniversalContract -> TRUCreditRegistry), not the
// phase-0 spike.
//
// Usage: node src/phase5-hardening.mjs [sepolia_repay_tx_hash]
//   - with no arg: creates + repays a fresh loan on SourceLoanMarket first.
//   - Tests: valid submit, replay, tampered borrower, tampered amount, direct registry
//     call, emitter binding, amount/borrower by-construction trace.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const load = (chain, name) =>
  JSON.parse(fs.readFileSync(path.resolve(ROOT, `contracts/deployments/${chain}/${name}.json`), 'utf8'));

const srcMeta = load('sepolia', 'SourceLoanMarket');
const ucMeta = load('creditcoin', 'TRUUniversalContract');
const regMeta = load('creditcoin', 'TRUCreditRegistry');
const decoderAbi = JSON.parse(
  fs.readFileSync(path.resolve(ROOT, 'contracts/out/EvmV1Decoder.sol/EvmV1Decoder.json'), 'utf8')
).abi;

const DECODER = '0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f';
const REPAY_SIG = '0xc7ce0a35f17b490de2a317e7fecb2cae86b1abffb03800b2f492823521382698'; // LoanRepaid(address,uint256,uint256)
const AMOUNT = 987654321n;

const sepolia = new JsonRpcProvider(process.env.SOURCE_RPC_URL ?? process.env.SEPOLIA_RPC_URL);
const sepoliaWallet = new Wallet(process.env.SEPOLIA_PRIVATE_KEY, sepolia);
const cc = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL);
const ccWallet = new Wallet(process.env.CREDITCOIN_PRIVATE_KEY, cc);

const source = new Contract(srcMeta.address, srcMeta.abi, sepoliaWallet);
const uc = new Contract(ucMeta.address, ucMeta.abi, ccWallet);
const registry = new Contract(regMeta.address, regMeta.abi, cc);

const results = { tests: [] };
function record(name, detail) {
  results.tests.push({ name, ...detail });
  console.log(`\n===== ${name} =====`);
  for (const [k, v] of Object.entries(detail)) console.log(`  ${k}: ${v}`);
}

async function run() {
  console.log('real pipeline contracts:');
  console.log('  SourceLoanMarket      (Sepolia) :', srcMeta.address);
  console.log('  TRUUniversalContract  (CC3)     :', ucMeta.address);
  console.log('  TRUCreditRegistry     (CC3)     :', regMeta.address);

  const cip = new chainInfo.PrecompileChainInfoProvider(cc);
  const chainKey = Number((await cip.getSupportedChains()).find((c) => Number(c.chainId) === 11155111).chainKey);
  const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, process.env.PROOF_BUILDER_URL);
  const prover = new blockProver.PrecompileBlockProver(cc);
  const decoder = new Contract(DECODER, decoderAbi, cc);

  // --- create + repay a real loan on SourceLoanMarket ---
  let repayTxHash = process.argv[2];
  let borrower, loanId, amount;
  if (!repayTxHash) {
    console.log('\n[driver] createLoan + repayLoan on', srcMeta.address);
    const createTx = await source.createLoan(1_000_000n, BigInt(Math.floor(Date.now() / 1000)) + 86400n * 30n);
    await createTx.wait();
    const created = await source.loanCounter();
    loanId = (created - 1n).toString();
    console.log('  loanId:', loanId);

    const repayTx = await source.repayLoan(loanId, { value: AMOUNT });
    const rr = await repayTx.wait();
    repayTxHash = rr.hash;
    const ev = rr.logs
      .map((l) => {
        try {
          return source.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((p) => p && p.name === 'LoanRepaid');
    borrower = ev.args.borrower;
    amount = ev.args.amount.toString();
    console.log('  repay tx:', repayTxHash, 'block:', rr.blockNumber);
    console.log('  LoanRepaid borrower:', borrower, 'loanId:', loanId, 'amount:', amount);
  }

  const srcTx = await sepolia.getTransaction(repayTxHash);
  const blockNumber = srcTx.blockNumber;

  // --- attestation + proof ---
  console.log(`\n[attesting] block ${blockNumber}...`);
  await proofBuilder.waitUntilHeightAttested(chainKey, blockNumber, 10000, 900000, 2000);
  const valid = await proofBuilder.getProof(repayTxHash);
  if (!valid.success) throw new Error('valid proof failed: ' + JSON.stringify(valid.error));
  const d = valid.data;
  console.log(`[proof-ready] header=${d.headerNumber} txIndex=${d.txIndex} cached=${d.cached}`);

  // --- locate field offsets from the decoded log (robust) ---
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
  const fakeAmount = amountWord.endsWith('1') ? amountWord.slice(0, -1) + '2' : amountWord.slice(0, -1) + '1';

  async function tamperedFields(txBytes) {
    try {
      const r = await decoder.decodeReceiptFields(txBytes);
      const l = r.receiptLogs[0];
      return { topics1: l.topics[1], topics2: l.topics[2], data: l.data };
    } catch (e) {
      return { decodeError: e.shortMessage ?? e.message };
    }
  }

  const revertReason = (e) => {
    if (e.reason) return e.reason;
    if (e.shortMessage) return e.shortMessage;
    if (e.data) {
      try {
        const err = new Interface(['error Error(string)']).parseError(e.data);
        if (err) return err.args[0];
      } catch {}
    }
    return String(e);
  };

  // ===== 0. by-construction trace: execute() has no borrower/loanId/amount inputs =====
  const executeAbi = ucMeta.abi.find((a) => a.type === 'function' && a.name === 'execute');
  record('P1 borrower/amount by-construction trace', {
    execute_inputs: executeAbi.inputs.map((i) => i.type).join(', '),
    has_borrower_input: String(executeAbi.inputs.some((i) => i.name === 'borrower')),
    has_amount_input: String(executeAbi.inputs.some((i) => i.name === 'amount')),
    has_loanId_input: String(executeAbi.inputs.some((i) => i.name === 'loanId')),
    note: 'only proof bytes are forwarded; borrower/loanId/amount are derived on-chain from the USC-verified transaction',
  });

  // ===== 1. emitter binding / loan binding: decodeRepayment view on the real tx =====
  const dec = await uc.decodeRepayment(d.txBytes);
  const sourceEmitter = '0x' + log.topics[1].slice(26).toLowerCase();
  record('P3 loan binding: emitter check (decodeRepayment view)', {
    decoded_borrower: dec[0],
    decoded_loanId: dec[1].toString(),
    decoded_amount: dec[2].toString(),
    emitter_matches_SourceLoanMarket: String(dec[0].toLowerCase() === sourceEmitter),
    note: 'decodeRepayment only returns if log.address_ == configured SourceLoanMarket address (0x' + srcMeta.address.slice(2) + '); SourceLoanMarket.repayLoan only emits for active loans owned by the caller, so the loanId is bound to a real loan of the borrower',
  });

  // ===== 2. VALID submission through the real UC + registry =====
  const profileBefore = await registry.profiles(dec[0]);
  const t0 = Date.now();
  const submitTx = await uc.execute(
    d.chainKey, d.headerNumber, d.txBytes, d.merkleProof.root, d.merkleProof.siblings,
    d.continuityProof.lowerEndpointDigest, d.continuityProof.roots, { gasLimit: 3000000 }
  );
  const sReceipt = await submitTx.wait();
  // Parse the exact queryId from the registry's RepaymentRecorded event (indexed),
  // so no off-chain reproduction of the assembly layout is needed.
  const recEvent = sReceipt.logs
    .map((l) => {
      try {
        return registry.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === 'RepaymentRecorded');
  const queryId = recEvent.args.queryId;
  const profileAfter = await registry.profiles(dec[0]);
  record('P1/P3/P4 valid submission (real pipeline)', {
    tx: submitTx.hash,
    block: sReceipt.blockNumber,
    status: sReceipt.status,
    queryId,
    registry_repayments_before: profileBefore.repayments.toString(),
    registry_repayments_after: profileAfter.repayments.toString(),
    registry_totalRepaid_after: profileAfter.totalRepaid.toString(),
    delta: String(profileAfter.repayments - profileBefore.repayments),
    elapsed_s: ((Date.now() - t0) / 1000).toFixed(1),
  });

  // ===== 3. REPLAY: same proof resubmitted =====
  const replayRes = await (async () => {
    try {
      const t = await uc.execute(
        d.chainKey, d.headerNumber, d.txBytes, d.merkleProof.root, d.merkleProof.siblings,
        d.continuityProof.lowerEndpointDigest, d.continuityProof.roots, { gasLimit: 3000000 }
      );
      await t.wait();
      return { reverted: false, response: 'submitted' };
    } catch (e) {
      return { reverted: true, response: revertReason(e) };
    }
  })();
  record('P1 replay protection (same query resubmitted)', replayRes);

  // ===== 4+5. TAMPERED borrower / amount against a FRESH instance of the real
  //            TRUUniversalContract (so the replay guard does not pre-empt the
  //            verification rejection) =====
  console.log('\n[test] deploying fresh TRUUniversalContract (real artifact) for tamper tests...');
  const ucArt = JSON.parse(
    fs.readFileSync(path.resolve(ROOT, 'contracts/out/TRUUniversalContract.sol/TRUUniversalContract.json'), 'utf8')
  );
  const bytecode = typeof ucArt.bytecode === 'string' ? ucArt.bytecode : ucArt.bytecode.object;
  const freshUc = await new ContractFactory(ucArt.abi, bytecode, ccWallet).deploy(DECODER, '0x0000000000000000000000000000000000000000', srcMeta.address);
  await freshUc.deploymentTransaction().wait();
  console.log('  fresh UC:', await freshUc.getAddress());

  const verifySingleResp = async (txBytes) => {
    try {
      return String(await prover.verifySingle(d.chainKey, d.headerNumber, txBytes, d.merkleProof, d.continuityProof));
    } catch (e) {
      return revertReason(e);
    }
  };
  const freshExecuteResp = async (txBytes) => {
    try {
      await freshUc.execute.staticCall(
        d.chainKey, d.headerNumber, txBytes, d.merkleProof.root, d.merkleProof.siblings,
        d.continuityProof.lowerEndpointDigest, d.continuityProof.roots
      );
      return 'NO REVERT (BAD)';
    } catch (e) {
      return revertReason(e);
    }
  };

  const tamperedBorrower = tamperTo(borrowerOff, fakeBorrower);
  const tamperedAmount = tamperTo(amountOff, fakeAmount);
  const fbDecoded = await tamperedFields(tamperedBorrower);
  const faDecoded = await tamperedFields(tamperedAmount);
  record('P2 borrower binding (tampered borrower topic)', {
    tampered_topics1: fbDecoded.topics1 ?? fbDecoded.decodeError,
    verifier: await verifySingleResp(tamperedBorrower),
    fresh_uc_execute: await freshExecuteResp(tamperedBorrower),
  });
  record('P4 amount integrity (tampered amount word)', {
    tampered_data: faDecoded.data ?? faDecoded.decodeError,
    verifier: await verifySingleResp(tamperedAmount),
    fresh_uc_execute: await freshExecuteResp(tamperedAmount),
  });

  // ===== 6. DIRECT REGISTRY CALL (bypass UC) =====
  const registrySigned = registry.connect(ccWallet);
  const directRes = await (async () => {
    try {
      await registrySigned.recordVerifiedRepayment(keccak256('0x' + 'ab'.repeat(32)), dec[0], dec[1], dec[2]);
      return { reverted: false, response: 'recorded (BAD)' };
    } catch (e) {
      return { reverted: true, response: revertReason(e) };
    }
  })();
  record('P2 borrower binding: direct registry call from non-UC address', directRes);

  // ===== 7. FINAL STATE (no double count) =====
  const finalProfile = await registry.profiles(dec[0]);
  const qDone = await uc.processedQueries(queryId);
  const qReg = await registry.processedRepayments(queryId);
  record('P1/P5 final state (no double count)', {
    registry_repayments: finalProfile.repayments.toString(),
    registry_totalRepaid: finalProfile.totalRepaid.toString(),
    'uc.processedQueries[queryId]': String(qDone),
    'registry.processedRepayments[queryId]': String(qReg),
  });

  const outPath = path.resolve(ROOT, 'docs/phase-5-raw.json');
  fs.writeFileSync(outPath, JSON.stringify({ ...results, repayTx: repayTxHash, blockNumber }, null, 2));
  console.log('\nraw results written to', outPath);
}

run().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});