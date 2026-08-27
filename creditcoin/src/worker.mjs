import 'dotenv/config';
import { JsonRpcProvider, Wallet, Contract } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chainInfo, blockProver, proofProvider } from '@gluwa/usc-sdk';

// TRU pipeline worker (AGENTS.md build-order step 4).
// Infrastructure only — no decision-making. It:
//   [detected]   listens for LoanCreated / LoanRepaid events on SourceLoanMarket (Sepolia)
//   [attesting]  waits for Creditcoin attestation of the source block
//   [proof-ready] requests an inclusion proof from the proof builder
//   [verified]   sanity-checks the proof against the on-chain precompile (eth_call)
//   [submitted]  submits the proof to TRUUniversalContract (verifyAndEmit + decode)
//   [registry]   reads the borrower's TRUCreditRegistry profile to confirm the credit
//
// CLI:
//   node src/worker.mjs --listen [--from-block N] [--process-count N] [--until-tx HASH]
//   node src/worker.mjs --tx HASH      (process a single specific tx — auto-detects LoanCreated or LoanRepaid)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function loadDeployment(chain, name) {
  return JSON.parse(fs.readFileSync(path.resolve(ROOT, `contracts/deployments/${chain}/${name}.json`), 'utf8'));
}

const sourceMeta = loadDeployment('sepolia', 'SourceLoanMarket');
const ucMeta = loadDeployment('creditcoin', 'TRUUniversalContract');
const registryMeta = loadDeployment('creditcoin', 'TRUCreditRegistry');

const SEPSource = new JsonRpcProvider(process.env.SOURCE_RPC_URL ?? process.env.SEPOLIA_RPC_URL);
const ccProvider = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL);
const ccWallet = new Wallet(process.env.CREDITCOIN_PRIVATE_KEY, ccProvider);
const proofBuilderUrl = process.env.PROOF_BUILDER_URL;

const source = new Contract(sourceMeta.address, sourceMeta.abi, SEPSource);
const uc = new Contract(ucMeta.address, ucMeta.abi, ccWallet);
const registry = new Contract(registryMeta.address, registryMeta.abi, ccProvider);

const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(ccProvider);
const chains = await chainInfoProvider.getSupportedChains();
const sepolia = chains.find((c) => Number(c.chainId) === 11155111);
if (!sepolia) {
  console.error('Sepolia not in supported chains:', chains);
  process.exit(1);
}
const chainKey = Number(sepolia.chainKey);

const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, proofBuilderUrl);
const prover = new blockProver.PrecompileBlockProver(ccProvider);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString();
const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;

async function processLog(log, eventName) {
  if (eventName === 'LoanCreated') return processLoanCreated(log);
  return processLoanRepaid(log);
}

async function processLoanCreated(log) {
  const t0 = Date.now();
  const timings = {};

  console.log(`\n[detected] LoanCreated event @ ${ts()}`);
  console.log(`  tx       : ${log.transactionHash}`);
  console.log(`  block    : ${log.blockNumber}`);
  console.log(`  logIndex : ${log.index}`);
  console.log(`  borrower : ${log.args.borrower}`);
  console.log(`  loanId   : ${log.args.loanId.toString()}`);
  console.log(`  principal: ${log.args.principal.toString()}`);
  console.log(`  due      : ${log.args.due.toString()}`);

  console.log(`[attesting] waiting for Creditcoin attestation of Sepolia block ${log.blockNumber} @ ${ts()}...`);
  const a0 = Date.now();
  await proofBuilder.waitUntilHeightAttested(chainKey, log.blockNumber, 10000, 900000, 2000);
  timings.attesting = Date.now() - a0;
  console.log(`[attesting] block ${log.blockNumber} attested @ ${ts()} (waited ${fmt(timings.attesting)})`);

  console.log(`[proof-ready] requesting proof for ${log.transactionHash} @ ${ts()}...`);
  const p0 = Date.now();
  const result = await proofBuilder.getProof(log.transactionHash);
  timings.proof = Date.now() - p0;
  if (!result.success || !result.data) {
    throw new Error(`proof generation failed: ${result.error}`);
  }
  const d = result.data;
  console.log(
    `[proof-ready] header=${d.headerNumber} txIndex=${d.txIndex} cached=${d.cached} @ ${ts()} (${fmt(timings.proof)})`
  );

  const verified = await prover.verifySingle(d.chainKey, d.headerNumber, d.txBytes, d.merkleProof, d.continuityProof);
  console.log(`[verified] precompile verifySingle (eth_call): ${verified}`);
  if (!verified) throw new Error('on-chain verification FAILED');

  console.log(`[submitted] submitting LoanCreated proof to TRUUniversalContract @ ${ts()}...`);
  const s0 = Date.now();
  let submitTx;
  try {
    submitTx = await uc.executeLoanOrigination(
      d.chainKey,
      d.headerNumber,
      d.txBytes,
      log.transactionHash,
      d.merkleProof.root,
      d.merkleProof.siblings,
      d.continuityProof.lowerEndpointDigest,
      d.continuityProof.roots
    );
  } catch (e) {
    const reason = e.reason ?? e.shortMessage ?? String(e);
    if (/Query already processed/.test(reason) || /already recorded|already originated/.test(reason)) {
      timings.submit = Date.now() - s0;
      console.log(`[replay-rejected] TRUUniversalContract rejected resubmission: "${reason}"`);
      return { status: 'replay-rejected', timings };
    }
    throw new Error(`TRUUniversalContract.executeLoanOrigination failed: ${reason}`);
  }
  const receipt = await submitTx.wait();
  timings.submit = Date.now() - s0;
  console.log(
    `[submitted] tx=${receipt.hash} block=${receipt.blockNumber} gasUsed=${receipt.gasUsed} @ ${ts()} (${fmt(timings.submit)})`
  );

  const parsedLogs = [];
  for (const l of receipt.logs) {
    try {
      const parsed = uc.interface.parseLog(l);
      if (parsed) parsedLogs.push(parsed);
    } catch {}
  }
  const ev = parsedLogs.find((p) => p.name === 'LoanOriginationVerified');
  if (ev) {
    const match =
      ev.args.borrower.toLowerCase() === log.args.borrower.toLowerCase() &&
      ev.args.loanId.toString() === log.args.loanId.toString() &&
      ev.args.principal.toString() === log.args.principal.toString();
    console.log(`[verified] LoanOriginationVerified emitted:`);
    console.log(`  chainKey=${ev.args.chainKey} blockHeight=${ev.args.blockHeight} txIndex=${ev.args.transactionIndex}`);
    console.log(`  borrower=${ev.args.borrower} loanId=${ev.args.loanId} principal=${ev.args.principal} due=${ev.args.dueTimestamp}`);
    console.log(`  matches source LoanCreated event: ${match ? 'YES' : 'NO'}`);
  } else {
    console.log('[warn] no LoanOriginationVerified event parsed in receipt');
  }

  const r0 = Date.now();
  const status = await registry.loanStatus(log.args.borrower, log.args.loanId);
  const out = await registry.outstandingObligations(log.args.borrower);
  timings.registry = Date.now() - r0;
  console.log(`[registry] loan ${log.args.loanId} status=${status} outstanding=${out} @ ${ts()}`);

  timings.total = Date.now() - t0;
  return { status: 'verified', timings };
}

async function processLoanRepaid(log) {
  const t0 = Date.now();
  const timings = {};

  console.log(`\n[detected] LoanRepaid event @ ${ts()}`);
  console.log(`  tx       : ${log.transactionHash}`);
  console.log(`  block    : ${log.blockNumber}`);
  console.log(`  logIndex : ${log.index}`);
  console.log(`  borrower : ${log.args.borrower}`);
  console.log(`  loanId   : ${log.args.loanId.toString()}`);
  console.log(`  amount   : ${log.args.amount.toString()}`);

  // --- attestation ---
  console.log(`[attesting] waiting for Creditcoin attestation of Sepolia block ${log.blockNumber} @ ${ts()}...`);
  const a0 = Date.now();
  await proofBuilder.waitUntilHeightAttested(chainKey, log.blockNumber, 10000, 900000, 2000);
  timings.attesting = Date.now() - a0;
  console.log(`[attesting] block ${log.blockNumber} attested @ ${ts()} (waited ${fmt(timings.attesting)})`);

  // --- proof ---
  console.log(`[proof-ready] requesting proof for ${log.transactionHash} @ ${ts()}...`);
  const p0 = Date.now();
  const result = await proofBuilder.getProof(log.transactionHash);
  timings.proof = Date.now() - p0;
  if (!result.success || !result.data) {
    throw new Error(`proof generation failed: ${result.error}`);
  }
  const d = result.data;
  console.log(
    `[proof-ready] header=${d.headerNumber} txIndex=${d.txIndex} cached=${d.cached} @ ${ts()} (${fmt(timings.proof)})`
  );

  // --- on-chain sanity check (eth_call, no gas) ---
  const verified = await prover.verifySingle(d.chainKey, d.headerNumber, d.txBytes, d.merkleProof, d.continuityProof);
  console.log(`[verified] precompile verifySingle (eth_call): ${verified}`);
  if (!verified) {
    throw new Error('on-chain verification FAILED');
  }

  // --- submit to TRUUniversalContract ---
  console.log(`[submitted] submitting proof to TRUUniversalContract @ ${ts()}...`);
  const s0 = Date.now();
  let submitTx;
  try {
    submitTx = await uc.execute(
      d.chainKey,
      d.headerNumber,
      d.txBytes,
      log.transactionHash,  // sourceTxHash for event record
      d.merkleProof.root,
      d.merkleProof.siblings,
      d.continuityProof.lowerEndpointDigest,
      d.continuityProof.roots
    );
  } catch (e) {
    const reason = e.reason ?? e.shortMessage ?? String(e);
    if (/Query already processed/.test(reason)) {
      timings.submit = Date.now() - s0;
      console.log(`[replay-rejected] TRUUniversalContract rejected resubmission: "${reason}"`);
      console.log(`[replay-rejected] no registry write was attempted for this resubmission`);
      return { status: 'replay-rejected', timings };
    }
    throw new Error(`TRUUniversalContract.execute failed: ${reason}`);
  }
  const receipt = await submitTx.wait();
  timings.submit = Date.now() - s0;
  console.log(
    `[submitted] tx=${receipt.hash} block=${receipt.blockNumber} gasUsed=${receipt.gasUsed} @ ${ts()} (${fmt(timings.submit)})`
  );

  // --- parse RepaymentVerified ---
  const parsedLogs = [];
  for (const l of receipt.logs) {
    try {
      const parsed = uc.interface.parseLog(l);
      if (parsed) parsedLogs.push(parsed);
    } catch {
      /* not our event */
    }
  }
  const ev = parsedLogs.find((p) => p.name === 'RepaymentVerified');
  if (ev) {
    const match =
      ev.args.borrower.toLowerCase() === log.args.borrower.toLowerCase() &&
      ev.args.loanId.toString() === log.args.loanId.toString() &&
      ev.args.amount.toString() === log.args.amount.toString();
    console.log(`[verified] RepaymentVerified emitted by TRUUniversalContract:`);
    console.log(`  chainKey=${ev.args.chainKey} blockHeight=${ev.args.blockHeight} txIndex=${ev.args.transactionIndex}`);
    console.log(`  borrower=${ev.args.borrower} loanId=${ev.args.loanId} amount=${ev.args.amount}`);
    console.log(`  matches source LoanRepaid event: ${match ? 'YES' : 'NO'}`);
  } else {
    console.log('[warn] no RepaymentVerified event parsed in receipt');
  }

  // --- registry check ---
  const r0 = Date.now();
  const profile = await registry.profiles(log.args.borrower);
  timings.registry = Date.now() - r0;
  console.log(`[registry] profile for ${log.args.borrower} @ ${ts()}:`);
  console.log(
    `  repayments=${profile.repayments} totalRepaid=${profile.totalRepaid} creditLimit=${profile.creditLimit}`
  );

  timings.total = Date.now() - t0;
  return { status: 'verified', timings };
}

async function listen({ fromBlock, untilTx, processCount }) {
  let start = fromBlock ?? (await SEPSource.getBlockNumber());
  let processed = 0;
  const seen = new Set();
  const results = [];

  console.log(`listening for LoanCreated/LoanRepaid on SourceLoanMarket ${sourceMeta.address} (chainKey=${chainKey})`);
  console.log(`fromBlock=${start} processCount=${processCount} untilTx=${untilTx ?? '-'}`);

  while (processed < processCount) {
    const latest = await SEPSource.getBlockNumber();
    if (latest < start) {
      await sleep(6000);
      continue;
    }
    const [repaidLogs, createdLogs] = await Promise.all([
      source.queryFilter(source.filters.LoanRepaid(), start, latest),
      source.queryFilter(source.filters.LoanCreated(), start, latest),
    ]);
    const logs = [...repaidLogs, ...createdLogs]
      .map((l) => ({ log: l, name: l.fragment?.name ?? (l.args?.principal !== undefined ? 'LoanCreated' : 'LoanRepaid') }))
      .sort((a, b) => a.log.blockNumber !== b.log.blockNumber ? a.log.blockNumber - b.log.blockNumber : a.log.index - b.log.index);
    for (const { log, name } of logs) {
      const key = `${log.transactionHash}:${log.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const res = await processLog(log, name);
        results.push({ tx: log.transactionHash, event: name, ...res });
      } catch (e) {
        console.error(`[error] processing ${key}: ${e.message}`);
        results.push({ tx: log.transactionHash, status: 'error', error: e.message, timings: {} });
      }
      processed += 1;
      if (processed >= processCount) break;
      if (untilTx && log.transactionHash.toLowerCase() === untilTx.toLowerCase()) break;
    }
    start = latest + 1;
    if (processed < processCount) await sleep(6000);
  }
  return results;
}

function printSummary(results) {
  console.log('\n=== pipeline summary ===');
  for (const r of results) {
    console.log(`\n  tx        : ${r.tx}`);
    console.log(`  status    : ${r.status}`);
    if (r.status === 'error') {
      console.log(`  error     : ${r.error}`);
      continue;
    }
    const t = r.timings;
    console.log(`  detected->attested : ${t.attesting ? fmt(t.attesting) : '-'}`);
    console.log(`  proof ready        : ${t.proof ? fmt(t.proof) : '-'}`);
    console.log(`  submit->mined      : ${t.submit ? fmt(t.submit) : '-'}`);
    console.log(`  registry check     : ${t.registry ? fmt(t.registry) : '-'}`);
    console.log(`  TOTAL (in-worker)  : ${t.total ? fmt(t.total) : '-'}`);
  }
}

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (flag) => args.includes(flag);

if (has('--tx')) {
  const txHash = get('--tx');
  console.log(`processing specific tx ${txHash}`);
  const receipt = await SEPSource.getTransactionReceipt(txHash);
  if (!receipt) {
    console.error(`tx not found on Sepolia: ${txHash}`);
    process.exit(1);
  }
  const [repaidLogs, createdLogs] = await Promise.all([
    source.queryFilter(source.filters.LoanRepaid(), receipt.blockNumber, receipt.blockNumber),
    source.queryFilter(source.filters.LoanCreated(), receipt.blockNumber, receipt.blockNumber),
  ]);
  const all = [
    ...repaidLogs.map((l) => ({ log: l, name: 'LoanRepaid' })),
    ...createdLogs.map((l) => ({ log: l, name: 'LoanCreated' })),
  ];
  const found = all.find((x) => x.log.transactionHash.toLowerCase() === txHash.toLowerCase());
  if (!found) {
    console.error(`no LoanCreated/LoanRepaid event in tx ${txHash}`);
    process.exit(1);
  }
  const res = await processLog(found.log, found.name);
  printSummary([{ tx: txHash, event: found.name, ...res }]);
  process.exit(res.status === 'verified' ? 0 : 2);
} else {
  const fromBlock = has('--from-block') ? parseInt(get('--from-block'), 10) : undefined;
  const untilTx = get('--until-tx');
  const processCount = has('--process-count') ? parseInt(get('--process-count'), 10) : Number.POSITIVE_INFINITY;
  const results = await listen({ fromBlock, untilTx, processCount });
  printSummary(results);
}