# TRU x Attestcoin Protocol Integration

This document explains how TRU uses the Attestcoin Protocol (also known as
Creditcoin USC / Universal Smart Contracts) to turn verified on-chain loan
repayments into credit history. It is written for a judge who has not read any
of the project's phase reports.

## 1. What TRU is, and why Attestcoin is load-bearing

TRU lets a person repay a loan on Ethereum Sepolia and have that repayment
become part of a credit profile stored on Creditcoin. The credit profile is not
a copy of anything the borrower, a frontend, or a backend says. It is written
only after a Creditcoin smart contract cryptographically verifies, through the
native Attestcoin protocol, that a specific repayment actually happened on
Sepolia.

The "remove Attestcoin, does it still work?" test: **no, it does not.** A smart
contract on Creditcoin cannot see the Ethereum chain. Without the Attestcoin
protocol there is no mechanism by which the Creditcoin-side contract could know
a repayment happened. The only alternatives would be (a) someone tells it (the
frontend, a backend API, or manual input), which is forgeable and rejected by
the project's rules, or (b) an oracle that relays the event, which turns the
credit history's integrity into trust in the relay. Attestcoin removes both
alternatives: the contract itself checks a Merkle proof that the repayment's
transaction was included in an attested Sepolia block. The fact arrives
self-certifying, not reported.

## 2. Architecture

```
Ethereum Sepolia                          Creditcoin CC3 Testnet
─────────────────────                     ─────────────────────────────
SourceLoanMarket
  repayLoan() emits
  LoanRepaid(borrower,loanId,amount)          BlockProver precompile (0x…0FD2)
        │                                         ▲  verifyAndEmit(proof)
        │  tx hash                                │  "Merkle proof validation
        ▼                                         │   failed" on any tamper
   worker (off-chain, infrastructure only)       │
        │  polls /api/v1/attested-height/1        │
        │  waits ~35 blocks of Sepolia            │
        │  ProofBuilder.getProof(txHash)          │
        │  ────────── USC proof ───────────────►  │
        │                              ┌──────────┴──────────┐
        │         TRUUniversalContract │  replay guard on     │
        │         (0xb634…0a0d7)       │  keccak(chainKey,     │
        │         verifies proof,      │  height, txIndex)     │
        │         decodes LoanRepaid   │  checks emitter ==    │
        │         from the verified    │  SourceLoanMarket     │
        │         transaction bytes    └──────────┬──────────┘
        │                             emits RepaymentVerified
        │                                         ▼
        │                     TRUCreditRegistry (0x9119…1D1E)
        │                     recordVerifiedRepayment(queryId,
        │                     borrower, loanId, amount)
        │                     replay + duplicate guards, then:
        │                     repayments += 1
        │                     totalRepaid += amount
        │                     creditLimit = BASE_LIMIT + repayments × INCREMENT
        │                                         ▼
        │                            CreditProfile stored on Creditcoin
        ▼                            readable via profiles(borrower)
```

The worker builds and submits proofs. It never decides what gets credited. The
only inputs `TRUUniversalContract.execute` accepts are proof bytes (chainKey,
blockHeight, encodedTransaction, merkle proof, continuity proof). The borrower,
loanId, and amount are derived inside the contract from the verified
transaction after proof verification succeeds. There is no field the worker,
frontend, or an attacker could stuff with a different borrower or amount.

## 3. Exact technical specifics (from the live system)

Current deployments, from `contracts/deployments/*` (the single source of truth
loaded by the worker; SourceLoanMarket is redeployed fresh on each
`deploy-production.mjs` run, so the Sepolia address below is the latest):

Addresses below reflect the current deployment as of 2026-08-16, which supersedes
the addresses cited in earlier phase reports (phase-4/5/6), since the contracts
were redeployed after the activeLoans cleanup.

| Component | Chain | Address |
| --- | --- | --- |
| SourceLoanMarket | Ethereum Sepolia | `0x37dC748456dAd7c7172bD560E286BD09523Be093` |
| TRUUniversalContract | Creditcoin CC3 Testnet | `0xb634e1a30f29cb5F3b9274B7b62D48c9E30cA0d7` |
| TRUCreditRegistry | Creditcoin CC3 Testnet | `0x91193a9762083FB7A8382bef0835270021881D1E` |
| EvmV1Decoder (deployed decoder library) | Creditcoin CC3 Testnet | `0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f` |
| BlockProver precompile | Creditcoin CC3 Testnet | `0x0000000000000000000000000000000000000FD2` |
| ChainInfo precompile | Creditcoin CC3 Testnet | `0x0000000000000000000000000000000000000fd3` |

USC SDK: **`@gluwa/usc-sdk` 0.18.0** (ethers v6 peer dependency). The functions
actually used:

- `proofProvider.service.ProofBuilder(chainKey, url).getProof(txHash)` — returns
  `{headerNumber, txIndex, txBytes, merkleProof, continuityProof, cached}`.
  Backed by `POST /api/v1/proof-by-tx/{chainKey}/{txHash}` on
  `https://prover.cc3-testnet.creditcoin.network`.
- `proofProvider.service.ProofBuilder(...).waitUntilHeightAttested(chainKey, height)`
  — polls `/api/v1/attested-height/{chainKey}` until the target Sepolia block is
  attested.
- On-chain: `VERIFIER.verifyAndEmit(...)` (state-changing, reverts on failure)
  and `VERIFIER.calculateTxIndex(merkleProof)` (precompile calls from the
  contract); `verifySingle` is used as an eth_call sanity check by the worker
  before submitting.

**chainKey vs chainId.** `chainKey` is the Attestcoin protocol identifier for a
source chain, assigned per environment. On CC3 Testnet, `chainKey 1 = Sepolia`
(whose EVM chainId is 11155111) and `chainKey 3 = Ethereum mainnet` (chainId 1).
They are different numbers and must not be confused. chainKey matters twice
here: the proof-builder and the precompile both take it, and the contract's
replay key is `keccak(chainKey, blockHeight, transactionIndex)`, so the replay
guard is scoped to a specific source chain. The code queries
`getSupportedChains()` rather than hardcoding the mapping.

**Attestation timing: real measurement, not API calls.** The Creditcoin network
attests Sepolia blocks, and the proof-builder reports the same height the
on-chain chain-info precompile reports (no ingestion lag). The attested height
tracks the Sepolia head at a **standing lag of roughly 35 blocks**, advancing in
exactly +10-block batches every ~120-140 s, which matches Sepolia's ~12 s block
time. The measured consequence: a repayment processed promptly after mining
waits **~7-9 minutes** for cold attestation (five end-to-end runs: 340, 451,
464, 500, 549 s). This is predictable in advance, because the remaining wait is
approximately `(targetHeight - attestedHeight) × 12 s` and the current attested
height is readable anytime. It is not reducible from our side: the lag is the
network's attestation policy, not our polling interval. An already-attested
block is instant (~2-10 s), which is why earlier phases looked fast: those
transactions were old, not fast-attested. A frontend must present the
post-repayment state as a ~8-minute pending-verification state with a live
countdown derived from the attested-height gap.

## 4. Security properties

Each property is classified as enforced **by construction** (no violating code
path exists) or **by explicit check** (a check rejects the attempt). Evidence
is drawn from the live end-to-end security test in `docs/phase-5-security.md`.

| Property | Enforcement | Evidence |
| --- | --- | --- |
| Replay protection (same event never credited twice) | by explicit check | `processedQueries` in TRUUniversalContract and `processedRepayments` in TRUCreditRegistry, both keyed on `keccak(chainKey, blockHeight, txIndex)`; resubmitting the same proof reverted with `"Query already processed"` and the profile was not incremented |
| Borrower binding (borrower is whoever actually repaid) | by construction (+ `onlyUniversalContract` on the registry) | `execute` takes no borrower input; the borrower is decoded from the verified transaction after proof verification. A tampered borrower topic reverted with `"Merkle proof validation failed"`. A direct call to the registry from a non-TRU address reverted with `"Only TRUUniversalContract"` |
| Loan binding (loanId belongs to the borrower's loan) | by explicit check (emitter) + by construction at source | `TRUUniversalContract` requires the verified log's emitter to equal the configured SourceLoanMarket (`"Not SourceLoanMarket emitter"`); `SourceLoanMarket.repayLoan` only emits `LoanRepaid` for active loans owned by the caller |
| Amount integrity (credited amount is the paid amount) | by construction | no amount input in `execute`; amount is decoded from the verified transaction. A tampered amount word reverted with `"Merkle proof validation failed"` |
| Duplicate protection (one loan credited once) | by explicit check | `countedLoans[borrower][loanId]` in the registry; crediting the same loanId twice via different queryIds reverts with `"Loan already credited"` (Forge tests) |

A note on the tamper evidence: changing any byte of the submitted transaction
changes its hash, which then no longer matches the Merkle proof, so the
precompile itself rejects it. The tamper tests were run against a fresh
TRUUniversalContract instance so the replay guard could not pre-empt the
verification rejection, proving both layers independently.

## 5. Adversarial walkthrough: tampered amount

The strongest single attack is to take a genuine repayment and change the
amount in it, hoping the Creditcoin-side contract credits more than was paid.

**Before (the legitimate event).** A real repayment on Sepolia:
`repayLoan(2)` with value 987654321 wei, tx
`0xc8cec9bd…` (Sepolia block 11503090), emitting `LoanRepaid(borrower,
loanId=2, amount=987654321)`. The worker builds a valid proof and submits it;
verification passes, the emitter check passes, and the registry increments.

**The attack.** An attacker takes the same encoded transaction bytes and flips
the amount word from 987654321 to 987654322 (the word becomes `0x…3ade68b2`,
confirmed by re-decoding the tampered bytes). Everything else, including the
proof, is unchanged.

**What happened.** The submission reverts with
`"Merkle proof validation failed"`. The revert reason comes from the BlockProver
precompile itself: any byte change alters the transaction hash, and the tampered
bytes no longer match the Merkle proof committed to the attested Sepolia block.

**State after.** Unchanged. No `RepaymentVerified` event, no registry write,
`repayments` and `totalRepaid` identical to before. The same holds for a
tampered borrower topic and for the derived loanId: there is no parameter in
`execute` that accepts a borrower, loanId, or amount at all, so the only way to
inject a wrong value is to break the proof, which the precompile rejects. The
walkthrough is covered live in `docs/phase-5-security.md` (P2/P4) and the spike
tests in `docs/phase-0-security-tests.md`.

## 6. Why not just an oracle or a centralized API

A centralized API or oracle can deliver the same event data, but it delivers it
as a report: the consumer must decide whether to believe the reporter, its
transport, and its operator. What TRU eliminates is that belief step. The
repayment fact is not relayed; it is derived on-chain from transaction bytes
that a Creditcoin precompile has cryptographically verified against an attested
Sepolia block. Nobody in the loop can change the amount, borrower, or loanId and
have it accepted, because such a change breaks the proof.

This is not "zero trust." Three things are still trusted: the SourceLoanMarket
contract's own logic (that its `repayLoan` emits truthful events), the key that
deployed and owns the contracts, and the Creditcoin network's attestation of
Sepolia blocks. What is eliminated is trust in the data delivery path: the
worker, the frontend, any backend, and any relay. A misbehaving operator of all
of them cannot mint credit for a repayment that did not happen or change the
amount of one that did.

## 7. Honest limitations

- **Testnet only.** Everything runs on Ethereum Sepolia and Creditcoin CC3
  Testnet. No mainnet credit state exists yet.
- **`activeLoans` removed, not faked.** The original `CreditProfile` struct
  declared an `activeLoans` field that was never written to (an unimplemented
  stub that would have read as 0). Rather than ship a field that looks like real
  data, it was deleted from the struct, the ABI, the worker log, and the tests,
  and the contracts were redeployed. `profiles(borrower)` now returns exactly
  `(repayments, totalRepaid, creditLimit)`, all of which are actually written.
- **No production frontend.** At the time of writing the credit logic, registry,
  and pipeline are complete and evidenced, but there is no user-facing frontend
  or demo UI. The attestation-timing finding in section 3 exists precisely to
  inform how such a frontend should present the ~8-minute verification window.
- **Inherited infrastructure quirks.** The deployed EvmV1Decoder's
  `getLogsByEventSignature` reverts on valid input on CC3 Testnet; the contract
  filters the decoded receipt logs in-contract instead, which has identical
  security properties (verified in the phase-0 spike). This is documented in the
  contract source and re-checked on each testnet.