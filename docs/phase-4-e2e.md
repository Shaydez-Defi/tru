# Phase 4 — Wired Pipeline E2E Report

**Date**: 2026-08-16
**Status**: ✅ PASS — real `SourceLoanMarket` repayment verified through the real
`TRUUniversalContract` and credited in the real `TRUCreditRegistry`. Replay of the
same repayment is rejected end-to-end; no double credit.

## Components (build-order step 3 deployments, no spike code)

| Component | Chain | Address |
|---|---|---|
| `SourceLoanMarket` | Sepolia | `0x74d2BFEa0ae7c714e190d7CFb5FA636752677daE` |
| `TRUUniversalContract` | Creditcoin CC3 | `0xdE49A97119650F6A24c13df6729e8870aEe782B7` |
| `TRUCreditRegistry` | Creditcoin CC3 | `0x341D9609d92873D04D41f1C1A232b2e1dF01dA77` |

Worker: `creditcoin/src/worker.mjs` (event listener + proof submitter, infrastructure
only). Driver: `creditcoin/src/driver.mjs` (creates + repays a loan on Sepolia). Both
load ABIs from the deployment JSONs — no hand-written ABI, no ABI mismatch possible.

Worker pipeline stages (each logged with an ISO timestamp):
`[detected]` → `[attesting]` → `[proof-ready]` → `[verified] (eth_call sanity)` →
`[submitted]` → `[verified] (RepaymentVerified)` → `[registry]`.

## Run 1 — live end-to-end repayment

Driver actions on Sepolia (borrower `0x2b374aDd4b86Ab1bf6196D1f698Eeb77156aA0F0`):

- `createLoan(1000000, now+30d)` → tx `0x60e6e5c80a79e0cc049a5bbcac8aa1365fb57800d66891ee68591eaf35abe9d8`, block `11498016`, loanId `0`
- `repayLoan(0)` value `123456789` → tx **`0x98c2040ddf64d59c08fe9fac57a09af1ae01f33568c92d454de0471198b0a2fc`**, block **`11498018`**, emitted `LoanRepaid(borrower, loanId=0, amount=123456789)`

Worker processing of that event:

| Stage | Time | Wall clock (UTC) |
|---|---|---|
| detected (LoanRepaid event found) | — | 01:43:01.054 |
| attesting (Sepolia block 11498018 attested + in proof-builder cache) | **340.5s** | 01:48:41.564 |
| proof-ready (`getProof`, header=11498018, txIndex=96, cached=true) | 0.2s | 01:48:41.745 |
| verified (precompile `verifySingle` eth_call) | `true` | — |
| submitted → mined (`TRUUniversalContract.execute`) | 4.9s | 01:48:46.932 |
| verified (`RepaymentVerified` emitted, **matches source event: YES**) | — | — |
| registry check | 0.1s | 01:48:47.024 |
| **TOTAL (in-worker)** | **346.0s** | — |

Key on-chain artifacts:
- Worker submit tx (CC3): `0xd55830a2d38fb8871c82fbda450a42746ee9ee466f863f4c4e76dae1b46b4bb6`, block `5317198`, status 1, gasUsed 280000.
- `RepaymentVerified`: chainKey=1, blockHeight=11498018, txIndex=96, borrower=`0x2b374a…`, loanId=0, amount=123456789.
- `TRUCreditRegistry.profiles(borrower)` after: **repayments=1, totalRepaid=123456789**, activeLoans=0, creditLimit=0 (stubs, step 6).

End-to-end total (repay mined 01:40:39.538 → registry confirmed 01:48:47.024):
**~487s**, of which ~151s was operator gap (worker started after the repay mined) and
**340.5s was cold Creditcoin attestation** of a fresh Sepolia block — a protocol
property, not worker latency. The worker's own measured pipeline time is **346.0s**
(detected → registry), dominated by that same cold attestation. On already-attested
blocks the attestation stage is ~2s (see run 2).

## Run 2 — replay of the same repayment tx

Same worker invocation over the same tx `0x98c2040d…`:

| Stage | Time |
|---|---|
| detected | — |
| attesting (already attested/cached) | **2.3s** |
| proof-ready | 0.1s |
| verified (eth_call) | `true` |
| submitted | → `TRUUniversalContract` reverted: **`execution reverted: "Query already processed"`** |

After the rejected resubmission, `TRUCreditRegistry.profiles(borrower)` is unchanged:
**repayments=1, totalRepaid=123456789** — the rejected submit never reached the registry.

On-chain replay-key evidence (queryId = `keccak(chainKey, blockHeight, txIndex)`
packed exactly as the contract does, chainKey=1, height=11498018, txIndex=96):

```
queryId = 0x6fbfe8b7a3af1b3e349399c41f5cb6a8b8207b6e4f2ba9473801ade095884ce5
uc.processedQueries[queryId]        = true
registry.processedRepayments[queryId] = true
```

Both the verification-side and registry-side replay guards fired exactly once.

## Integration-boundary issues found (not silently papered over)

1. **Non-monotonic `latest` from the public Sepolia RPC.** The first listener run
   crashed with an exact JSON-RPC error from `eth_getLogs`:
   `-32602 "invalid block range params"` with `fromBlock: 0xaf721f, toBlock: 0xaf721e`
   — the public node behind a load balancer briefly reported a lower head height than
   the previous poll, so `start (= prev latest + 1) > latest`. Fix: the listener now
   checks `if (latest < start)` and waits a poll cycle instead of issuing the invalid
   range. This is listener robustness only; it does not touch proof verification,
   decoding, or registry logic.
2. **Cold attestation latency (~340s).** First-ever proof for a fresh Sepolia block
   waits for the Creditcoin chain to attest and the proof builder to ingest it
   (`waitUntilHeightAttested`, 15-min timeout). Subsequent runs are ~2s (cached).
3. **Off-chain queryId reproduction pitfall** (my verification script, not the
   pipeline): the contract's assembly layout places `transactionIndex` in the low
   bytes of the 32-byte word at offset 40 (i.e. buffer offset 64 of 72), not offset
   40. After correcting the reproduction, the on-chain replay keys confirmed as shown
   above. No contract bug.

## Conclusion

The full production pipeline works end-to-end with the real step-3 contracts:
event → worker → attestation → proof → USC verification → event extraction →
registry credit. The same repayment submitted twice is credited exactly once, with
the second submission rejected by `TRUUniversalContract` before any registry write.
Per build order, stopping here — no security hardening (step 5) or credit logic
(step 6) started.