# Audit: Implementation Map and Gap Checklist vs. Acceptance Criteria

Audit task (no code changes). Assesses the current TRU implementation — every
component, every acceptance-criterion — against what is actually live/testnet,
what is simulated/mocked, and what is inherited USC infrastructure. Nothing is
described as live unless it is.

Sources read: AGENTS.md, docs/usc-research.md, docs/phase-0-report.md,
docs/phase-0-security-tests.md, docs/phase-4-e2e.md, docs/phase-5-security.md,
docs/phase-6-credit-logic.md, docs/attestation-timing.md, docs/phase-5-raw.json,
deployment JSONs, `contracts/src/**`, `contracts/test/**`,
`creditcoin/src/**`. On-chain addresses verified from
`contracts/deployments/**` at audit time.

---

## 1. Implementation map

| Component | Address | What it does | Status |
| --- | --- | --- | --- |
| SourceLoanMarket | `0x3e1FF41C2fBb3f6D8Cb787A7f4EF9891ABaBfe84` (Sepolia) | Creates loans (`loanCounter`), emits `LoanCreated`/`LoanRepaid`. `repayLoan` requires active + owner + `msg.value>0`; amount = `msg.value`. Knows nothing about Creditcoin/TRU. | **Live on testnet** (Sepolia testnet). Fresh deployment each `deploy-production.mjs` run (phase-4 `0x74d2BFEa…`, phase-5 `0x3f6379b5…`, phase-6+ `0x3e1FF41C…`). |
| USC query mechanism | — | Worker (`creditcoin/src/worker.mjs`) calls `proofProvider.service.ProofBuilder(chainKey, PROOF_BUILDER_URL).getProof(txHash)`; SDK hits `POST /api/v1/proof-by-tx/{chainKey}/{txHash}` on `https://prover.cc3-testnet.creditcoin.network`. `waitUntilHeightAttested` polls `/api/v1/attested-height/1`. | **Live USC infrastructure** (official Gluwa proof-builder service for CC3 testnet) — inherited, not ours, not mocked. |
| Attestation | — | Creditcoin network block-height attestation of Sepolia blocks; surfaced via proof-builder cache and on-chain chain-info precompile. Cold wait ~7–9 min (structural ~35-block lag); already-attested blocks instant. | **Live on testnet** (real CC3-testnet attestation; timing measured in `docs/attestation-timing.md`). Not simulated. |
| Creditcoin verifier | BlockProver precompile `0x…0FD2` (CC3) | Native USC precompile `verify`/`verifyAndEmit`; called by TRUUniversalContract and (eth_call) by worker. | **Live on testnet** — inherited USC infrastructure, not mocked. |
| TRUUniversalContract | `0x80eCf7F95F3ECbBDdA29C2260342D9B77124BF0a` (CC3) | `execute(...)` = replay guard (`processedQueries` on `keccak(chainKey,height,txIndex)`), calls BlockProver `verifyAndEmit`, decodes `LoanRepaid` from verified receipt via EvmV1Decoder `0x731c345d…` (in-contract log filter — deployed decoder's `getLogsByEventSignature` is broken), requires emitter == configured `sourceLoanMarket` (`Not SourceLoanMarket emitter`), emits `RepaymentVerified`, forwards verified `(borrower, loanId, amount)` to registry. No credit logic. | **Live on testnet** (CC3 testnet). |
| TRUCreditRegistry | `0x52B7eAd2769B3449Fa213B9fb40f94B4f17915bA` (CC3) | `recordVerifiedRepayment` (only-UC) = replay guard (`processedRepayments[queryId]`) + duplicate guard (`countedLoans[borrower][loanId]`) + updates `CreditProfile`: `repayments += 1`, `totalRepaid += amount`, `creditLimit = 0 + repayments*100`. Emits `RepaymentRecorded`. | **Live on testnet** (CC3 testnet). |
| Credit-state transition | — | Trigger: `TRUUniversalContract.execute` → BlockProver `verifyAndEmit` (status 1 required) → decoder extracts `LoanRepaid` → emitter check → `TRUCreditRegistry.recordVerifiedRepayment`. Formula: `creditLimit = BASE_LIMIT(0) + repayments × INCREMENT_PER_REPAYMENT(100)`, same base unit (wei) as `totalRepaid`. | **Live on testnet**; deterministic, explainable, no AI/black-box. |

**Nothing in the final path is mocked or simulated.** Every component is either a
live CC3-testnet/Sepolia-testnet deployment or live inherited USC infrastructure.
The only non-live artifacts are throwaway *spike* contracts (`SpikeConsumer`,
`TestRepayment`, phase-0 probes) which are explicitly out of the production path
(rule: no spike code in production).

---

## 2. Acceptance-criteria checklist

Legend: **SATISFIED** = implemented + evidenced (doc/test/on-chain) ·
**GAP** = not implemented or not evidenced.

### Attestcoin/USC

| Criterion | Status | Evidence |
| --- | --- | --- |
| Real external event | SATISFIED | Real `LoanRepaid` on real Sepolia testnet; live E2E txs in `docs/phase-4-e2e.md`, `docs/phase-6-credit-logic.md`, `docs/attestation-timing.md`. |
| Real attestation | SATISFIED | `docs/attestation-timing.md` — real CC3-testnet attestation measured (pb cache == on-chain attested height exactly). |
| Real proof | SATISFIED | `docs/phase-4-e2e.md` (proof header/txIndex/cached), `docs/attestation-timing.md` (cached proofs). Real proof-builder service. |
| Real Creditcoin verification | SATISFIED | Precompile `verifySingle` eth_call `true` + in-contract `verifyAndEmit` status 1 (phase 4/5/6 reports). |
| No mocked proof in final path | SATISFIED | Final path uses real proofs end-to-end; spike/probes confined to `src/spike/` + throwaway deployments, never called by worker/driver. |

### TRU (the three contracts)

| Criterion | Status | Evidence |
| --- | --- | --- |
| Receives verified source data | SATISFIED | `execute` forwards only proof bytes; data derived on-chain after `verifyAndEmit`. `docs/phase-5-security.md` P1 (ABI trace: no borrower/amount/loanId inputs). |
| Validates authorized source | SATISFIED | Emitter check `log.address_ == sourceLoanMarket` (`Not SourceLoanMarket emitter`). Forge `test_decodeRejectsForeignEmitter`; `docs/phase-5-security.md` P3. |
| Validates expected event | SATISFIED | In-contract decode requires `LoanRepaid` sig `0xc7ce0a35…` and status 1. Forge `test_decodeRejectsNonRepaymentSignature`, `test_decodeRejectsFailedTx`; phase-0 test 4b (wrong-event gate). |
| Extracts borrower | SATISFIED | `decodeRepayment` view + `RepaymentVerified` borrower matches source (phase-4 "matches: YES"). |
| Extracts loanId | SATISFIED | Same evidence as borrower. |
| Extracts amount | SATISFIED | Same evidence; amount = `msg.value` from verified event. |
| Prevents replay | SATISFIED | UC `processedQueries[queryId]` + registry `processedRepayments[queryId]`; E2E replay reverted `"Query already processed"` (`docs/phase-4-e2e.md`, `docs/phase-5-security.md`, phase-6). On-chain keys verified. |
| Prevents duplicate processing | SATISFIED | Registry `countedLoans[borrower][loanId]` (`"Loan already credited"`); Forge `test_sameLoanIdCannotBeCreditedTwiceViaDifferentQueries`; `docs/phase-5-security.md` P5. |
| Rejects invalid events | SATISFIED | Tampered borrower/amount → `"Merkle proof validation failed"` at verifier + fresh-UC; wrong event → rejected (`docs/phase-0-security-tests.md`, `docs/phase-5-security.md` P2/P4). |
| Deterministic credit-state transitions | SATISFIED | `creditLimit = 0 + repayments*100` (public constants), single entry point; Forge 1st→100 / 3rd→300; live registry updated exactly +1 per run (`docs/phase-6-credit-logic.md`, `docs/attestation-timing.md`). |

### Creditcoin

| Criterion | Status | Evidence |
| --- | --- | --- |
| Credit state exists on Creditcoin | SATISFIED | `CreditProfile` stored in CC3-testnet `TRUCreditRegistry`; readable via `profiles(address)`. |
| State transition occurs on Creditcoin | SATISFIED | `recordVerifiedRepayment` (CC3) updates `repayments/totalRepaid/creditLimit`; state-change tx mined on CC3 (e.g. `0xea7808a4…`, block 5321469). |
| Transaction/state transition publicly demonstrable | SATISFIED | CC3 txs + `RepaymentRecorded` events on CC3 testnet blockscout; worker logs + reports cite tx hashes/blocks. (Public *on mainnet* is a GAP below — testnet-only today.) |

### Security

| Criterion | Status | Evidence |
| --- | --- | --- |
| Valid repayment succeeds | SATISFIED | Live E2E, each run +1 credit (`docs/phase-4-e2e.md`, `docs/phase-6-credit-logic.md`, `docs/attestation-timing.md`). |
| Fake repayment fails | SATISFIED | Fake borrower → `"Merkle proof validation failed"`; no field injection possible (by construction). `docs/phase-0-security-tests.md` T1, `docs/phase-5-security.md` P2. |
| Tampered repayment fails | SATISFIED | Tampered amount/borrower → verifier + fresh-UC revert. `docs/phase-0-security-tests.md` T2, `docs/phase-5-security.md` P4. |
| Unauthorized source fails | SATISFIED | Foreign emitter rejected (Forge `test_decodeRejectsForeignEmitter`; emitter check in UC). |
| Replay fails | SATISFIED | E2E resubmission reverted `"Query already processed"`; no double count. |
| Invalid proof fails | SATISFIED | Nonexistent tx → proof builder 404; tampered bytes → `"Merkle proof validation failed"`. `docs/phase-0-security-tests.md` T4a, P2/P4. |
| Rejected events never mutate state | SATISFIED | After replay reject, profile unchanged (phase-4 run 2); verifiedCount stays 1 in spike tests; registry guards precede any write. |

---

## 3. Flag: `activeLoans`

**Confirmed: `activeLoans` is still an unfilled stub.**

- Declared in `CreditProfile` (`contracts/src/creditcoin/TRUCreditRegistry.sol:18`)
  but **never written** anywhere — `recordVerifiedRepayment` updates only
  `repayments`, `totalRepaid`, `creditLimit`. No setter exists.
- It **is exposed through the public `profiles(address)` getter** (the struct
  returns a 4-tuple including `activeLoans`; confirmed in the deployed ABI at
  `contracts/deployments/creditcoin/TRUCreditRegistry.json`), so any caller of
  `profiles()` reads `activeLoans = 0` always.
- The worker logs it as `activeLoans=0` in its registry check
  (`creditcoin/src/worker.mjs:156`) — display-only, derived from the stub field.
- Forge tests explicitly assert it stays `0` and label it a stub
  (`contracts/test/TRUCreditRegistry.t.sol:33` `// stub, build-order step 6`).

**Exposure risk assessment (as requested):** it is *nominally* exposed via the
`profiles` getter tuple and echoed in worker logs, always as `0` — but it is
**not exposed as if it were real data**: no frontend exists yet, no code
computes or assigns it, and no report presents it as a live metric. The residual
risk is that a future frontend might read `profiles().activeLoans` and display
`0` as if meaningful. **Recommendation (fix deferred per instructions):** either
implement active-loan accounting (needs a loan-creation/maturity feed, beyond
step 6 scope) or remove the field from the struct and stop echoing it in the
worker.

---

## Overall verdict

All acceptance criteria that can be demonstrated on testnets are **SATISFIED**
with explicit on-chain + Forge + live-E2E evidence. The pipeline is real (no
mocked verification). **Gaps for honest reporting:**

1. **Everything runs on testnets** (Sepolia, CC3 testnet). "Live mainnet"
   credit state / transitions / public demonstrability on mainnet is a **GAP** by
   definition at this stage of the project.
2. **`activeLoans` is an unfilled stub** surfaced (as `0`) through the public
   `profiles` getter and worker log (see section 3).
3. **No production frontend/demo exists** yet (build order step 7 is undefined);
   attestation UX implications are documented in `docs/attestation-timing.md`.
4. The deployed `EvmV1Decoder.getLogsByEventSignature` on CC3 testnet is broken;
   the contracts correctly avoid it (in-contract filtering) — worth re-checking
   on future releases/testnets.

No gaps were fixed in this audit.