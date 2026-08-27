# Phase 9 — Credit Passport (Loan Lifecycle)

Closes the Outstanding Obligations gap (backend upgrade brief section 6) by
verifying loan origination through the same USC pipeline as repayment, per
AGENTS.md rules 1-3. Every outstanding obligation traces to a verified on-chain
fact, exactly like every other field in the system. This is new scope, not a
stub.

Section 4 (evidence exposure) required no new code — `getEvents` +
`getCreditEvidence` from phases 7 and 8 already answer "why did state change"
— so it is not re-implemented here. This phase builds directly on that
foundation and adds lifecycle state and the CreditPassport view.

## Changes

### SourceLoanMarket.sol — check

`createLoan()` already emits
`LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 due)`.
No change needed; the contract remains unaware of Creditcoin/TRU (AGENTS.md
rule 6). Verified by inspection of `contracts/src/sepolia/SourceLoanMarket.sol`.

### TRUUniversalContract.sol

- Added `LOAN_CREATED_EVENT_SIGNATURE` (`keccak("LoanCreated(uint256,address,uint256,uint256)")`
  = `0x3373919ad665425d2cddb4072830e5935b6ee308440fa99b23383648da473bc0`) and
  `LoanOriginationVerified` event.
- Added `_decodeLoanCreated` / `decodeLoanCreated` view, mirroring
  `_decodeRepayment`: validates tx type, receipt status, searches
  `receiptLogs` in-contract for the LoanCreated signature (same workaround
  for the broken `EvmV1Decoder.getLogsByEventSignature` on CC3 testnet),
  checks emitter == `sourceLoanMarket`, decodes `loanId = topics[1]`,
  `borrower = topics[2]`, `principal, dueTimestamp = abi.decode(data)`.
- Added `executeLoanOrigination(chainKey, blockHeight, encodedTransaction,
  sourceTxHash, merkleRoot, siblings, lowerEndpointDigest, continuityRoots)`:
  same USC proof path as `execute` — computes `txIndex` via precompile,
  `queryId = keccak(chainKey, height, txIndex)`, checks
  `processedQueries[queryId]` replay guard, calls `verifyAndEmit`, decodes
  LoanCreated, emits `LoanOriginationVerified`, forwards to
  `registry.recordVerifiedLoanOrigination`. No new trust boundary; same
  emitter check, same replay guard, new UC-gated entry point.

### ITRUCreditRegistry.sol

- Extended `EventType` with `Origination` (keeps `Repayment = 0` for backward
  compatibility; `Origination = 1` for future origination events stored as
  `VerifiedFinancialEvent` if needed).
- Added `LoanStatus { NONE, ACTIVE, REPAID }` and
  `CreditPassport { CreditEvidence evidence; VerifiedFinancialEvent[] loanHistory;
  uint256 outstandingObligations; uint64[] verifiedSourceChains; }`.
- Added `recordVerifiedLoanOrigination`, `getLoanStatus`, `getOutstandingObligations`,
  `getCreditPassport`.

### TRUCreditRegistry.sol

- New storage:
  - `loanStatus[borrower][loanId] -> LoanStatus` (NONE → ACTIVE → REPAID)
  - `outstandingObligations[borrower] -> uint256` (count of ACTIVE)
  - `processedOriginations[queryId] -> bool` (replay for originations)
- `recordVerifiedLoanOrigination(queryId, borrower, loanId, principal,
  dueTimestamp, sourceChain, sourceTxHash, sourceBlock)` — `onlyUniversalContract`,
  checks `!processedOriginations[queryId]` ("Loan origination already recorded"),
  checks `loanStatus == NONE` ("Loan already originated"), sets ACTIVE,
  increments `outstandingObligations`, emits `LoanOriginationRecorded`. Origination
  verified facts are lifecycle state (Active count); `borrowerEvents` remains
  repayment history for `loanHistory` reuse. Principal/due are emitted for audit.
- `recordVerifiedRepayment` extended with lifecycle transition:
  - if status ACTIVE → REPAID and `outstandingObligations--` (safe decrement)
  - if status NONE → REPAID with outstanding unchanged. Edge case documented
    in code: a repayment for a loanId with no verified origination on record
    is still allowed and recorded as REPAID, but outstanding is not decremented
    because no Active obligation was counted. This preserves backward
    compatibility with phase 5/6 tests and live flows that verified repayments
    without prior origination verification, and ensures outstanding only
    reflects verified Active loans. Requiring prior origination would be stricter
    but would break existing verified repayment flows.
  - REPAID case is unreachable due to `countedLoans` duplicate guard, but
    handled defensively.
- `getCreditEvidence`, `getCreditState` unchanged (creditLimit formula remains
  `0 + repayments*100`).
- Added `getLoanStatus`, `getOutstandingObligations`, `getCreditPassport` view
  that wraps `getCreditEvidence` with `loanHistory` (copy of `borrowerEvents`,
  repayment history), `outstandingObligations`, and `verifiedSourceChains`
  (distinct `sourceChain` values from `borrowerEvents`; currently `[1]` for
  Sepolia, trivial until a second chain exists).

### worker.mjs

- Generalized to handle both event types. Added `processLoanCreated` (mirrors
  `processLoanRepaid` but calls `uc.executeLoanOrigination` and parses
  `LoanOriginationVerified`).
- `listen` now queries both `LoanRepaid` and `LoanCreated` filters per range,
  merges and sorts by block/logIndex, dispatches via `processLog(log, name)`.
- `--tx` path auto-detects event type by querying both filters for the block
  and selecting the matching log.

## Forge Tests (47 passing: 7 SourceLoanMarket + 8 UC + 32 registry)

Eight new registry tests plus three new UC decode tests:

- `test_loanOriginationMovesToActive` — origination query marks status ACTIVE
  and outstanding 1.
- `test_repaymentMovesToRepaidAndDecrementsOutstanding` — origination then
  repayment moves status REPAID and outstanding 0.
- `test_repaymentWithoutPriorOriginationStillAllowed` — documents edge case:
  repayment with status NONE is still allowed, becomes REPAID, outstanding
  stays 0, repayments still counted. Comment in test and in
  `recordVerifiedRepayment` explains the decision.
- `test_originationReplayGuard` — same origination queryId replay reverts
  "Loan origination already recorded", outstanding unchanged.
- `test_originationDuplicateGuard` — same loanId origination via different
  queryId reverts "Loan already originated".
- `test_repaymentReplayGuardStillHoldsWithLifecycle` — repayment replay still
  reverts "Repayment already recorded".
- `test_outstandingObligationsMultiple` — three originations → 3, two
  repayments → 1 remaining.
- `test_creditPassportAfterOriginationAndRepayment` — passport before any
  state (0/0/0), after origination (outstanding 1, loanHistory 0, chains 0),
  after repayment (outstanding 0, history 1, chains [1]).
- `test_verifiedSourceChainsDistinct` — two repayments on same chain → chains
  `[1]`, history 2.

UC decoder tests (MockDecoder):

- `test_decodeLoanCreatedAcceptsSourceLoanMarketEmitter`
- `test_decodeLoanCreatedRejectsForeignEmitter`
- `test_decodeLoanCreatedRejectsNonCreatedSignature`

All 23 earlier registry tests still pass (including repayment without prior
origination, credit state boundaries, distinctLoansRepaid, etc.).

## Live End-to-End Test

Contracts deployed for this run:

- SourceLoanMarket (Sepolia): `0x28B98e270Cc464B9Ec2F8876d33d22A4DEdaeF38`
- TRUCreditRegistry (CC3): `0xdd808b032599bCdF1f5038e50192513b8BfF2EB9`
- TRUUniversalContract (CC3): `0xfcf7360Ba7Ae155Cf9399ea55508Da112BE78dd1`

Flow:

1. Driver created loan 0 on Sepolia (tx `0xc567f0609a7a62a5c477ca9442e9ea399a395fa8a78bc00f52aa45563923e53a`,
   block 11578456, `LoanCreated(loanId=0, borrower=0x2b374aDd…, principal=1000000,
   due=1790433278)`).

2. Worker --tx for that hash waited for attestation (463.5s cold), built proof
   (header 11578456, txIndex 153, cached=true, 0.4s), `verifySingle` true,
   submitted via `executeLoanOrigination` (tx
   `0xbed9746427615697943ebb12b894fab05ca34fe183117d8989f4e29bd891384f`,
   CC3 block 5383561, gas 374150), `LoanOriginationVerified` matched source
   YES. Registry: `loanStatus[borrower][0]=ACTIVE (1)`,
   `outstandingObligations=1`, passport `evidence.repayments=0,
   loanHistory=0, verifiedSourceChains=[]` (no repayment yet).

3. Driver repaid loan 0 (tx `0x8f6a259e7d0e3863b3dc1fc82ab13581bd6e3489082f4bd0cbea08a15375cc95`,
   block 11578500, `LoanRepaid(loanId=0, amount=123456789)`).

4. Worker --tx for that hash waited 433.2s, proof header 11578500 txIndex 109,
   `verifySingle` true, `execute` (tx `0xbf9b5bec5aa8540c39d436c29c59ad45f16109780a7cf74a072f7609d7904f63`,
   CC3 block 5383594, gas 394366), `RepaymentVerified` YES. Registry:
   `repayments=1, totalRepaid=123456789, creditLimit=100`.

5. Loan lifecycle after repayment:
   `loanStatus[borrower][0]=REPAID (2)`, `outstandingObligations=0`,
   `getCreditPassport`:
   ```
   evidence.creditState=BUILDING (1), repayments=1, totalRepaid=123456789,
   creditLimit=100, distinctLoansRepaid=1, failedOrRejectedEvents=0
   outstandingObligations=0
   loanHistory=[{eventId=0xba096…, borrower=0x2b374aDd…, sourceChain=1,
     sourceTxHash=0x8f6a259e…, sourceBlock=11578500, loanId=0,
     eventType=Repayment, amount=123456789, verifiedAt=1787842275}]
   verifiedSourceChains=[1]
   ```

Replay checks: resubmitting either proof is rejected by `processedQueries`
("Query already processed"); distinct origination for same loanId rejected by
"Loan already originated".

## Evidence Exposure — No New Code

`getEvents` (paginated, reverse chronological) and `getCreditEvidence`
already answer "why did state change" with verified facts. `getCreditPassport`
reuses that data plus the new lifecycle count, so section 4 required no
re-implementation.

## Notes

- No fake verification: both origination and repayment use the real USC
  verifier (`verifyAndEmit`); tampered/fake proofs still revert with
  "Merkle proof validation failed" as in phases 0 and 5.
- No speculative fields: `outstandingObligations` counts only USC-verified
  Active loans; `failedOrRejectedEvents` remains definitionally 0.
- Emitter binding preserved for both paths; foreign emitter still reverted
  ("Not SourceLoanMarket emitter").
- Deployment gas for `TRUCreditRegistry` grew to ~1.23M (vs 798k phase 8) due
  to new lifecycle mappings; runtime gas per origination ~374k, per repayment
  ~394k (includes event log and status updates).
