# Phase 5 — Security Hardening

Build-order step 5: verify/implement the security properties of the real wired
pipeline (SourceLoanMarket → worker → TRUUniversalContract → TRUCreditRegistry)
and classify each as enforced **by construction** (no violating code path
exists) or **by explicit check** (a check rejects the attempt).

## Classification summary

| Property | Enforcement | Where | Evidence |
| --- | --- | --- | --- |
| 1. Replay protection | by explicit check | `TRUUniversalContract.processedQueries`, `TRUCreditRegistry.processedRepayments` | E2E resubmission reverted |
| 2. Borrower binding | by construction (+ explicit `onlyUniversalContract`) | no borrower input in `execute`; derived from verified tx; registry callable only by UC | P1 ABI trace, P2 tamper, direct-call |
| 3. Loan binding | by explicit check (emitter) + by construction at source | `log.address_ == sourceLoanMarket`; `SourceLoanMarket.repayLoan` requires active + owner | P3 emitter match, P2 tamper |
| 4. Amount integrity | by construction | no amount input in `execute`; derived from verified tx | P1 ABI trace, P4 tamper |
| 5. Duplicate protection | by explicit check | `TRUCreditRegistry.countedLoans[borrower][loanId]` | Forge tests |

## Hardening added in this phase

- `TRUUniversalContract.sol`
  - `address public sourceLoanMarket` (constructor param + owner-only `setSourceLoanMarket`).
  - `require(log.address_ == sourceLoanMarket, "Not SourceLoanMarket emitter")` in the
    event-decoding path, so only a verified `LoanRepaid` emitted by the configured
    SourceLoanMarket is accepted.
  - Public view `decodeRepayment(bytes)` for introspection/testing (returns
    `borrower, loanId, amount` only if the emitter check passes).
- `TRUCreditRegistry.sol`
  - `mapping(address => mapping(uint256 => bool)) countedLoans` +
    `require(!countedLoans[borrower][loanId], "Loan already credited")`, independent of
    the queryId replay guard.
- Foundry tests extended to **21 passing** (7 SourceLoanMarket + 9 registry +
  5 UC): UC accepts a source-emitter event, rejects a foreign emitter, rejects a
  non-matching signature, rejects a failed tx, `setSourceLoanMarket` is
  owner-only; registry rejects crediting the same loanId twice via different
  queryIds, allows the same loanId under different borrowers, accumulates
  distinct loans.

## Live-test evidence (real wired pipeline)

Contracts under test (post-hardening redeploy):

- SourceLoanMarket (Sepolia): `0x3f6379b59213FeE0D628Cc687dAdb6e70eAA4389`
- TRUUniversalContract (CC3): `0x7b6b57dD18fD79174419574152bd1Bd26894aCB5`
- TRUCreditRegistry (CC3): `0xbD8f54c97ba81e5719708dfF49b72E66cA5ADCFE`

Repayment used: `0xc8cec9bdc43f977afab3f2a50e1997fd95b720cd3ea518e4e9fb1d6834457ea4`
(Sepolia block 11503090, loanId 2, amount 987654321, borrower
`0x2b374aDd4b86Ab1bf6196D1f698Eeb77156aA0F0`). Raw output:
`docs/phase-5-raw.json`.

### P1 — borrower/amount/loanId by construction

`execute` ABI: `uint64, uint64, bytes, bytes32, tuple[], bytes32, bytes32[]`.
No borrower/amount/loanId inputs exist — `has_borrower_input: false`,
`has_amount_input: false`, `has_loanId_input: false`. Only proof bytes are
forwarded; the three fields are derived on-chain from the USC-verified
transaction.

### P3 — loan binding (emitter check)

`uc.decodeRepayment(txBytes)` returned borrower `0x2b374aDd...`, loanId `2`,
amount `987654321` with `emitter_matches_SourceLoanMarket: true`. The view only
returns if the verified log's `address_` equals the configured
`sourceLoanMarket`. At the source, `SourceLoanMarket.repayLoan` only emits
`LoanRepaid` for active loans owned by the caller, so the loanId is bound to a
real loan of the borrower (Creditcoin cannot read Sepolia state directly; this
is the binding mechanism).

### P1/P3/P4 — valid submission through the real pipeline

Submit `0x95f635f8...` (CC3 block 5321385, status 1) → registry
repayments 2 → 3 (delta +1), totalRepaid 2962962963. queryId
`0xfc5bcadef84099cd0d689426e2454738dede81476a22f31e820888edd92db30c` parsed from
the `RepaymentRecorded` event.

### P1 — replay protection (explicit check)

Resubmitting the same proof reverted; exact reason captured via `staticCall`:
**"Query already processed"**. Final state confirms
`uc.processedQueries[queryId] = true` and
`registry.processedRepayments[queryId] = true`, and the profile was not
incremented twice.

### P2 — borrower binding (tampered borrower topic)

Flipping the borrower topic to `0xdeaddead...` (same txBytes, tampered) →
verifier rejects with **"Merkle proof validation failed"**, and a fresh
deployment of the real TRUUniversalContract artifact rejects with the same
error via `staticCall`. (Tamper tests run on a fresh UC instance so the replay
guard cannot pre-empt the verification rejection.)

### P4 — amount integrity (tampered amount word)

Flipping the amount word to `...3ade68b2` (987654322) → verifier rejects with
**"Merkle proof validation failed"**; fresh UC instance rejects identically.

### P2 — direct registry call (bypass UC)

`TRUCreditRegistry.recordVerifiedRepayment` called directly from a non-UC
address reverted with **"Only TRUUniversalContract"**.

### P5 — duplicate protection

Unreachable via the real pipeline (a loanId repays once at the source), so it
is proven by the explicit `countedLoans` check in the Foundry tests: crediting
the same loanId twice via different queryIds reverts with **"Loan already
credited"**; distinct loans accumulate.

## Notes / judgment calls

- `deploy-production.mjs` redeploys SourceLoanMarket on every run; the phase-5
  SourceLoanMarket is a fresh contract (`0x3f6379...`, loanId counter restarted)
  that supersedes the phase-4 address. Deployment JSONs
  (`contracts/deployments/*`) hold the current addresses and are the single
  source of truth for worker/driver.
- The old phase-4 repayment would now be rejected by the emitter check (it came
  from the superseded SourceLoanMarket).
- Replay keys are per-transaction (`queryId = keccak(chainKey, blockHeight,
  txIndex)`), i.e. conservative: a tx containing several repayment events is
  credited once.
- No credit logic was added (that is step 6).