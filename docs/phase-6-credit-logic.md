# Phase 6 — Deterministic Credit Logic

Build-order step 6: implement the deterministic credit rule in
`TRUCreditRegistry`, wired into the existing USC-verified repayment recording
path. This is the last core backend step in AGENTS.md; nothing frontend-related
was started.

## The rule

```
creditLimit = BASE_LIMIT + (repayments * INCREMENT_PER_REPAYMENT)
```

with `BASE_LIMIT = 0` and `INCREMENT_PER_REPAYMENT = 100`, both exposed as
`public constant` so the formula is readable on-chain
(`registry.BASE_LIMIT() == 0`, `registry.INCREMENT_PER_REPAYMENT() == 100`).

### Units — confirmed, no silent change

`creditLimit` uses the same unit as `totalRepaid`: the base unit (wei) of the
verified `LoanRepaid.amount`, which is `msg.value` at `SourceLoanMarket.repayLoan`
(Sepolia). Phase-5 amounts in the registry were already in this unit
(e.g. `987654321`), so `INCREMENT_PER_REPAYMENT = 100` is 100 base units per
verified repayment — not a new or scaled unit. No deviation from the requested
formula was needed.

## Implementation

Only `TRUCreditRegistry.sol` changed. No separate entry point was added — the
update happens inside the existing `recordVerifiedRepayment`:

```solidity
profile.repayments += 1;
profile.totalRepaid += amount;
profile.creditLimit = BASE_LIMIT + profile.repayments * INCREMENT_PER_REPAYMENT;
```

The full guard stack still runs before it: `onlyUniversalContract` →
`processedRepayments[queryId]` (replay) → `countedLoans[borrower][loanId]`
(duplicate). Credit logic never runs unless the repayment is a USC-verified
event delivered by TRUUniversalContract, and never runs on a replayed or
duplicate one. `TRUUniversalContract` is untouched (still no credit logic, per
AGENTS.md rule 6).

## Forge tests (23 passing: 7 SourceLoanMarket + 5 UC + 11 registry)

New/updated registry tests:

- `test_verifiedRepaymentUpdatesProfile` — first verified repayment moves
  `creditLimit` from **0 → 100** (and asserts it equals the formula result).
- `test_thirdVerifiedRepaymentSetsCreditLimitTo300` — three distinct verified
  repayments (distinct loans + queryIds) bring it to **300**, then 400 and 500
  on the fourth/fifth.
- `test_creditLimitHasNoExternalSetter` — reads the compiled ABI artifact and
  asserts no setter-style function exists (`setCreditLimit`, `updateCreditLimit`,
  `setProfile`, `updateProfile`, `setCreditProfile`, `setBaseLimit`,
  `setIncrementPerRepayment`). `creditLimit` is read-only from outside; the only
  writer is the UC-gated `recordVerifiedRepayment`.
- Phase-5 protections still hold with credit logic in the update path:
  `test_sameRepaymentCannotBeRecordedTwice` ("Repayment already recorded"),
  `test_sameLoanIdCannotBeCreditedTwiceViaDifferentQueries` ("Loan already
  credited"), `test_randomAddressCallReverts` / `test_unconfiguredContractCannotRecord`
  ("Only TRUUniversalContract"), plus the UC emitter-binding suite.

## Live pipeline test (real contracts, real repayment)

Redeployed all three contracts (`deploy-production.mjs`):

- SourceLoanMarket (Sepolia): `0x3e1FF41C2fBb3f6D8Cb787A7f4EF9891ABaBfe84`
- TRUUniversalContract (CC3): `0x80eCf7F95F3ECbBDdA29C2260342D9B77124BF0a`
- TRUCreditRegistry (CC3): `0x52B7eAd2769B3449Fa213B9fb40f94B4f17915bA`

A real repayment was driven through the full pipeline:
`driver` created loan 0 and repaid 123456789 wei
(tx `0x9f4ec67de8d67ef5dbfa8c68855a821fd8830ac769f3a9591887d102a3bd2457`,
Sepolia block 11503185) → `worker --tx` waited for attestation (463.4s cold),
proof cached 0.2s, precompile `verifySingle` true, submitted to
TRUUniversalContract (tx `0xea7808a47c2f4f296134ab514fbc20fd76d581dd8ebd2480b604fbb78a6b403e`,
CC3 block 5321469) → `RepaymentVerified` matched the source event (YES) →
registry profile read back:

```
repayments=1  totalRepaid=123456789  activeLoans=0  creditLimit=100
```

`creditLimit` moved **0 → 100** on-chain through the real pipeline, not just in
unit tests. Replaying the same proof was rejected: **"Query already processed"**,
and the profile was unchanged (repayments still 1, creditLimit still 100) —
replay/duplicate protections hold with credit logic live.

## One-sentence explanation (pitch-deck / judge Q&A)

> "Every time we cryptographically verify on a real blockchain that you repaid a
> loan, your credit limit grows by a fixed 100 — starting from zero — so the
> more verified repayments you make, the more you're trusted with."

## Notes

- `deploy-production.mjs` redeploys SourceLoanMarket each run (fresh
  `0x3e1FF41C...`, loanId counter restarted); deployment JSONs in
  `contracts/deployments/*` are the single source of truth.
- Fixed a latent worker bug on the way: the `--tx` CLI path called
  `SEPSource.getReceipt`, which does not exist in ethers v6 — replaced with
  `getTransactionReceipt` (`creditcoin/src/worker.mjs`).
- `activeLoans` remains an unfilled stub (not part of this step).