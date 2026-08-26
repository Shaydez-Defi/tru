# Phase 8 — Credit Model Upgrade

Built on the event history from phase 7. Adds a deterministic state and
evidence layer on top of the existing creditLimit formula. No AI, no invented
precision, every output traces to a verified fact.

## Changes

### TRUCreditRegistry.sol

- Added `CreditState` enum with documented thresholds above the definition.
  The comment is the single source of truth and must be updated with any
  threshold change and the corresponding Forge boundary tests:

  ```
  // CreditState thresholds (deterministic, documented):
  //   NEW         = 0 repayments
  //   BUILDING    = 1-2 repayments
  //   ESTABLISHED = 3-5 repayments
  //   VERIFIED    = 6+ repayments
  ```

  Values correspond to `0=NEW, 1=BUILDING, 2=ESTABLISHED, 3=VERIFIED`.

- Did not change the existing creditLimit formula. The write path remains:

  ```solidity
  profile.creditLimit = BASE_LIMIT + profile.repayments * INCREMENT_PER_REPAYMENT;
  ```

  with `BASE_LIMIT = 0` and `INCREMENT_PER_REPAYMENT = 100`, both public
  constants. This step adds a read layer, not replacement arithmetic.

- Added `getCreditEvidence(address borrower) → CreditEvidence` view:

  ```solidity
  struct CreditEvidence {
      CreditState creditState;
      uint256 repayments;
      uint256 totalRepaid;
      uint256 creditLimit;
      uint256 distinctLoansRepaid;
      uint256 failedOrRejectedEvents;
  }
  ```

  Field derivation, each traceable to a verified fact:

  - `creditState`: derived from `profile.repayments` via the thresholds above.
  - `repayments`, `totalRepaid`, `creditLimit`: read directly from the
    existing `profiles[borrower]` struct written only inside the UC-gated
    `recordVerifiedRepayment`.
  - `distinctLoansRepaid`: computed from the phase-7 `borrowerEvents[borrower]`
    array. Iterates the stored `VerifiedFinancialEvent` records and counts
    unique `loanId` values. No new storage is added for this; it is a view
    over existing verified data. Due to the duplicate guard
    `countedLoans[borrower][loanId]`, this equals `borrowerEvents.length` in
    practice, but the deduplication loop makes the derivation explicit.
  - `failedOrRejectedEvents`: always `0`, with an in-code comment explaining
    why it is definitionally true: only USC-verified events ever reach storage
    (AGENTS.md rules 1-3). Rejected proofs never write state, so nothing
    recorded here was ever a failed or rejected attempt. The field exists so
    callers can answer "were any attempts rejected" without fabricating a
    counter that could imply otherwise.

  Also added a pure helper `getCreditState(uint256 repayments) → CreditState`
  for threshold logic reuse and testing.

### ITRUCreditRegistry.sol

- Added `CreditState` enum (with the same documented thresholds), the
  `CreditEvidence` struct, and the `getCreditEvidence` declaration. As with
  phase 7, shared types are defined in the interface for ABI compatibility
  and the contract inherits them.

## Forge Tests (35 passing: 7 SourceLoanMarket + 5 UC + 23 registry)

Six new registry tests (phase 8), all deterministic and tracing to verified
facts:

- `test_creditStateBoundaries` — exercises the tier at each boundary in a
  single borrower progression: 0→NEW, 1→BUILDING, 2→BUILDING, 3→ESTABLISHED,
  5→ESTABLISHED (upper boundary), 6→VERIFIED. Uses successive
  `recordVerifiedRepayment` calls with distinct loanIds and queryIds.

- `test_creditStatePureHelper` — directly asserts the pure `getCreditState`
  helper at 0,1,2,3,5,6,100 (covers far beyond threshold without state setup).

- `test_getCreditEvidenceReturnsCorrectValues` — two verified repayments;
  asserts `repayments=2, totalRepaid=800, creditLimit=200, distinctLoansRepaid=2,
  failedOrRejectedEvents=0, creditState=BUILDING`.

- `test_distinctLoansRepaidAcrossMultipleLoans` — three distinct loanIds;
  asserts `distinctLoansRepaid=3` and that it equals `repayments` (each loan
  credited once).

- `test_creditLimitFormulaUnchanged` — asserts `BASE_LIMIT==0`,
  `INCREMENT_PER_REPAYMENT==100`, then checks `getCreditEvidence` at 0,1,2
  repayments that `creditLimit` equals `BASE_LIMIT + repayments*100` byte-for-byte
  and also equals the direct `profiles(borrower)` value.

- `test_failedOrRejectedEventsAlwaysZero` — asserts `failedOrRejectedEvents==0`
  after one repayment, after two, and for a fresh borrower with no history.

All 17 earlier registry tests still pass unchanged (creditLimit setters,
replay/duplicate guards, borrower binding, event history and pagination).

## Live End-to-End Test

Contracts deployed for this run (phase 8 logic):

- SourceLoanMarket (Sepolia): `0xC9f748b7674CfE8cb8E463b759fde8272411c673`
- TRUCreditRegistry (CC3): `0x5bC66B68Fc353616036C560b535D7ccfDb3d7688`
- TRUUniversalContract (CC3): `0x215Aee9Bc5810F6D3Ba2c0c07e192E9DC8b380C9`

Test flow:

1. Driver created loan 0 on Sepolia (tx `0x27f9a611…`, block 11571790).
2. Driver repaid loan 0 with 123456789 wei (tx
   `0x0548a0fbac925a46d894bf17fd8d07bb8bf6dc0e465aa5a2241418d512fec270`, block
   11571791, `LoanRepaid(borrower=0x2b374aDd…, loanId=0, amount=123456789)`).
3. Worker waited for attestation (565.8s cold), built proof
   (header 11571791, txIndex 134, cached=true, 0.1s), precompile
   `verifySingle` returned true, submitted to TRUUniversalContract
   (tx `0x6909b55e…`, CC3 block 5378068, gas 388938).
4. `RepaymentVerified` emitted and matched the source event YES.
5. Registry profile: `repayments=1, totalRepaid=123456789, creditLimit=100`.
6. Event history: `getEventCount=1`, `getEvents` returned `eventId=
   0x0166bfaddb2b88e7d342e9d6e2ceaa56258c59fc4ef4c18c854725800be0b085`,
   `sourceChain=1, sourceTxHash=0x0548…270, sourceBlock=11571791, loanId=0,
   eventType=Repayment, amount=123456789`.
7. Credit evidence on-chain (`getCreditEvidence(borrower)`):

   ```
   creditState = 1 (BUILDING)
   repayments = 1
   totalRepaid = 123456789
   creditLimit = 100
   distinctLoansRepaid = 1
   failedOrRejectedEvents = 0
   ```

   Values match the verified repayment count and the unchanged formula
   `0 + 1*100`. The state `BUILDING` is the expected tier for one verified
   repayment.

No new entry point was added; the evidence read is a pure view over the
existing verified event log and profile. The answer to "why does this user
have this credit state" is now fully traceable to verified facts.
