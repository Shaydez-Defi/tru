import 'dotenv/config';
import { JsonRpcProvider, Wallet, Contract } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// TRU E2E driver (AGENTS.md build-order step 4).
// Drives the source-chain side of the pipeline on SourceLoanMarket (Sepolia):
//   node src/driver.mjs --create                    -> creates a loan, prints loanId
//   node src/driver.mjs --repay <loanId> [amount]   -> repays, prints the repay tx info
//   node src/driver.mjs                             -> create + repay in one go

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const meta = JSON.parse(
  fs.readFileSync(path.resolve(ROOT, 'contracts/deployments/sepolia/SourceLoanMarket.json'), 'utf8')
);

const provider = new JsonRpcProvider(process.env.SOURCE_RPC_URL ?? process.env.SEPOLIA_RPC_URL);
const wallet = new Wallet(process.env.SEPOLIA_PRIVATE_KEY, provider);
const source = new Contract(meta.address, meta.abi, wallet);

const DUE_DAYS = 30;
const PRINCIPAL = 1_000_000n;
const AMOUNT = 123_456_789n;

const ts = () => new Date().toISOString();

async function createLoan() {
  console.log(`[driver] createLoan principal=${PRINCIPAL} dueIn=${DUE_DAYS}d from ${wallet.address}`);
  const tx = await source.createLoan(PRINCIPAL, BigInt(Math.floor(Date.now() / 1000)) + BigInt(DUE_DAYS * 86400));
  const receipt = await tx.wait();
  console.log(`[driver] createLoan mined tx=${receipt.hash} block=${receipt.blockNumber}`);
  const ev = receipt.logs
    .map((l) => {
      try {
        return source.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === 'LoanCreated');
  const loanId = ev ? ev.args.loanId.toString() : '?';
  console.log(`[driver] loanId=${loanId} borrower=${ev ? ev.args.borrower : '?'}`);
  return loanId;
}

async function repayLoan(loanId, amount) {
  console.log(`[driver] repayLoan loanId=${loanId} amount=${amount} @ ${ts()}`);
  const tx = await source.repayLoan(BigInt(loanId), { value: amount });
  const receipt = await tx.wait();
  const ev = receipt.logs
    .map((l) => {
      try {
        return source.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === 'LoanRepaid');
  console.log(`[driver] repayLoan mined tx=${receipt.hash} block=${receipt.blockNumber} @ ${ts()}`);
  console.log(`[driver] LoanRepaid borrower=${ev ? ev.args.borrower : '?'} loanId=${ev ? ev.args.loanId.toString() : '?'} amount=${ev ? ev.args.amount.toString() : '?'}`);
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, ev };
}

const args = process.argv.slice(2);
if (args.includes('--create')) {
  const loanId = await createLoan();
  console.log(`RESULT loanId=${loanId}`);
} else if (args.includes('--repay')) {
  const loanId = args[args.indexOf('--repay') + 1];
  const amount = args[args.indexOf('--repay') + 2] ? BigInt(args[args.indexOf('--repay') + 2]) : AMOUNT;
  const { txHash, blockNumber, ev } = await repayLoan(loanId, amount);
  console.log(
    `RESULT repayTx=${txHash} repayBlock=${blockNumber} borrower=${ev.args.borrower} loanId=${ev.args.loanId} amount=${ev.args.amount}`
  );
} else {
  const loanId = await createLoan();
  const { txHash, blockNumber, ev } = await repayLoan(loanId, AMOUNT);
  console.log(
    `RESULT loanId=${loanId} repayTx=${txHash} repayBlock=${blockNumber} borrower=${ev.args.borrower} loanId2=${ev.args.loanId} amount=${ev.args.amount}`
  );
}