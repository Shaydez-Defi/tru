import 'dotenv/config';
import { JsonRpcProvider, Wallet, Contract } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chainInfo, blockProver, proofProvider } from '@gluwa/usc-sdk';

// Diagnostic: measure attestation timing through the REAL wired pipeline and sample
// the attestation trajectory so we can explain WHY cold attestation takes as long
// as it does (proof-builder cache vs on-chain precompile vs Sepolia head).
//
// Usage: node src/attestation-timing.mjs [sepolia_repay_tx_hash] [--no-drive]
//   - no arg: creates + repays a fresh loan first, then measures it
//   - --no-drive: use an existing tx hash without driving a new loan
//
// Does NOT modify any contracts.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const load = (chain, name) =>
  JSON.parse(fs.readFileSync(path.resolve(ROOT, `contracts/deployments/${chain}/${name}.json`), 'utf8'));

const srcMeta = load('sepolia', 'SourceLoanMarket');
const ucMeta = load('creditcoin', 'TRUUniversalContract');
const regMeta = load('creditcoin', 'TRUCreditRegistry');

const sepolia = new JsonRpcProvider(process.env.SOURCE_RPC_URL ?? process.env.SEPOLIA_RPC_URL);
const sepoliaWallet = new Wallet(process.env.SEPOLIA_PRIVATE_KEY, sepolia);
const cc = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL);
const ccWallet = new Wallet(process.env.CREDITCOIN_PRIVATE_KEY, cc);

const source = new Contract(srcMeta.address, srcMeta.abi, sepoliaWallet);
const uc = new Contract(ucMeta.address, ucMeta.abi, ccWallet);
const registry = new Contract(regMeta.address, regMeta.abi, cc);

const AMOUNT = 123_456_789n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;
const ts = () => new Date().toISOString().slice(11, 23);

const cip = new chainInfo.PrecompileChainInfoProvider(cc);
const chains = await cip.getSupportedChains();
const chainKey = Number(chains.find((c) => Number(c.chainId) === 11155111).chainKey);
const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, process.env.PROOF_BUILDER_URL);
const prover = new blockProver.PrecompileBlockProver(cc);

async function drive() {
  const createTx = await source.createLoan(1_000_000n, BigInt(Math.floor(Date.now() / 1000)) + 86400n * 30n);
  await createTx.wait();
  const created = await source.loanCounter();
  const loanId = (created - 1n).toString();
  const repayTx = await source.repayLoan(loanId, { value: AMOUNT });
  const rr = await repayTx.wait();
  const ev = rr.logs
    .map((l) => {
      try {
        return source.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === 'LoanRepaid');
  console.log(`[drive] loanId=${loanId} repayTx=${rr.hash} block=${rr.blockNumber} amount=${ev.args.amount.toString()}`);
  return { txHash: rr.hash, blockNumber: rr.blockNumber, borrower: ev.args.borrower, loanId: ev.args.loanId.toString() };
}

async function main() {
  const args = process.argv.slice(2);
  const txHashArg = args.find((a) => a.startsWith('0x'));
  const noDrive = args.includes('--no-drive');

  let repayTxHash, targetHeight, borrower;
  if (!txHashArg && !noDrive) {
    ({ txHash: repayTxHash, blockNumber: targetHeight, borrower } = await drive());
  } else {
    repayTxHash = txHashArg;
    const tx = await sepolia.getTransaction(repayTxHash);
    targetHeight = tx.blockNumber;
    const receipt = await sepolia.getTransactionReceipt(repayTxHash);
    const log = receipt.logs
      .map((l) => {
        try {
          return source.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((p) => p && p.name === 'LoanRepaid');
    borrower = log.args.borrower;
  }

  const t0 = Date.now();
  const tRepay = t0; // t0 anchored at measurement start (tx already mined for --no-drive)

  // ---- baseline at start ----
  const [pbStart, onChainStart, sepHeadStart] = await Promise.all([
    proofBuilder.client.queryAttestedHeight(chainKey).catch(() => undefined),
    cip.getLatestAttestedHeightAndHash(chainKey).catch(() => undefined),
    sepolia.getBlockNumber(),
  ]);
  console.log(`[baseline] ${ts()}`);
  console.log(`  targetHeight       : ${targetHeight}`);
  console.log(`  sepolia head       : ${sepHeadStart} (target behind head: ${sepHeadStart - targetHeight})`);
  console.log(`  pb cache attested  : ${pbStart ?? '?'} (gap to target: ${pbStart == null ? '?' : targetHeight - pbStart})`);
  console.log(`  on-chain attested  : ${onChainStart?.exists ? onChainStart.height : 'N/A'} (gap to target: ${onChainStart?.exists ? targetHeight - onChainStart.height : '?'})`);

  // ---- sample the trajectory every ~4s during the wait ----
  const samples = [];
  const sampler = (async () => {
    while (Date.now() - t0 < 20 * 60 * 1000) {
      const t = Date.now() - t0;
      try {
        const [pb, oc, sepHead] = await Promise.all([
          proofBuilder.client.queryAttestedHeight(chainKey).catch(() => undefined),
          cip.getLatestAttestedHeightAndHash(chainKey).catch(() => undefined),
          sepolia.getBlockNumber(),
        ]);
        samples.push({ t, pb, oc: oc?.exists ? oc.height : undefined, sepHead });
        if (pb != null && pb >= targetHeight) return;
      } catch {}
      await sleep(4000);
    }
  })();
  await sampler;

  // ---- attestation available ----
  const tAttested = Date.now() - t0;
  const last = samples[samples.length - 1] ?? {};
  console.log(`[attested] ${ts()} pb cache reached target after ${fmt(tAttested)}`);
  console.log(`  last sample: pb=${last.pb} on-chain=${last.oc} sepHead=${last.sepHead}`);

  // ---- proof ----
  const p0 = Date.now();
  const result = await proofBuilder.getProof(repayTxHash);
  const tProof = Date.now() - p0;
  if (!result.success || !result.data) throw new Error(`proof failed: ${result.error}`);
  const d = result.data;
  console.log(`[proof] header=${d.headerNumber} txIndex=${d.txIndex} cached=${d.cached} ${fmt(tProof)}`);

  // ---- on-chain sanity + submit ----
  const verified = await prover.verifySingle(d.chainKey, d.headerNumber, d.txBytes, d.merkleProof, d.continuityProof);
  console.log(`[verify] precompile eth_call: ${verified}`);
  const s0 = Date.now();
  const submitTx = await uc.execute(
    d.chainKey, d.headerNumber, d.txBytes, d.merkleProof.root, d.merkleProof.siblings,
    d.continuityProof.lowerEndpointDigest, d.continuityProof.roots, { gasLimit: 3000000 }
  );
  const sReceipt = await submitTx.wait();
  const tSubmit = Date.now() - s0;
  console.log(`[submit] tx=${submitTx.hash} block=${sReceipt.blockNumber} status=${sReceipt.status} ${fmt(tSubmit)}`);

  // ---- registry ----
  const profile = await registry.profiles(borrower);
  console.log(`[registry] repayments=${profile.repayments} totalRepaid=${profile.totalRepaid} creditLimit=${profile.creditLimit}`);

  // ---- report ----
  const total = Date.now() - t0;
  console.log('\n===== timing report =====');
  console.log(`  repayTx            : ${repayTxHash}`);
  console.log(`  targetHeight       : ${targetHeight}`);
  console.log(`  attestation wait   : ${fmt(tAttested)}   (repay -> pb cache ready)`);
  console.log(`  proof generation   : ${fmt(tProof)}   (pb cache ready -> proof returned)`);
  console.log(`  submit -> mined    : ${fmt(tSubmit)}   (proof -> CC3 tx confirmed)`);
  console.log(`  TOTAL end-to-end   : ${fmt(total)}`);

  console.log('\n===== attestation trajectory (t_s, pbCache, onChain, sepHead) =====');
  for (const s of samples) {
    console.log(`  ${(s.t / 1000).toFixed(0).padStart(4)}s  pb=${String(s.pb ?? '-').padStart(7)}  onchain=${String(s.oc ?? '-').padStart(7)}  sepHead=${String(s.sepHead ?? '-').padStart(7)}  pbGap=${s.pb == null ? '?' : targetHeight - s.pb}`);
  }

  // analysis
  const firstPb = samples.find((s) => s.pb != null);
  if (firstPb) {
    const gapAtStart = targetHeight - firstPb.pb;
    const gapAtEnd = targetHeight - (last.pb ?? firstPb.pb);
    const pbSamples = samples.filter((s) => s.pb != null);
    const dt = (pbSamples[pbSamples.length - 1].t - pbSamples[0].t) / 1000;
    const dH = pbSamples[pbSamples.length - 1].pb - pbSamples[0].pb;
    console.log('\n===== attestation catch-up analysis =====');
    console.log(`  attestation gap to target at start : ${gapAtStart} blocks`);
    console.log(`  attestation gap to target at end   : ${gapAtEnd} blocks`);
    console.log(`  pb cache advanced ${dH} blocks in ${dt.toFixed(0)}s (${dt > 0 ? (dH / dt).toFixed(2) : '?'} blocks/s avg)`);
    if (dH === 0 && dt > 0) console.log('  -> pb cache did NOT advance during the wait (wait dominated by poll interval / external ingestion)');
  }
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});