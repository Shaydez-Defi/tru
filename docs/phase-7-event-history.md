# Phase 7 — Verified Financial Event History

Build-order step 7 (after credit logic): implement a per-borrower append-only log
of every USC-verified source-chain event. This is the foundation for the credit
model upgrade, evidence exposure, and Credit Passport that follow.

## Changes

### TRUCreditRegistry.sol

- Added `EventType` enum (extensible; `Repayment` is the only value today).
- Added `VerifiedFinancialEvent` struct with fields:
  - `eventId` (bytes32) — derived from the existing `queryId` (keccak of
    chainKey, blockHeight, txIndex).
  - `borrower` (address)
  - `sourceChain` (uint64) — chainKey (e.g., 1 = Sepolia on CC3 testnet).
  - `sourceTxHash` (bytes32) — the source-chain transaction hash.
  - `sourceBlock` (uint64) — the source-chain block number.
  - `loanId` (uint256)
  - `eventType` (EventType)
  - `amount` (uint256)
  - `verifiedAt` (uint256) — `block.timestamp` at registry write.
- Added `borrowerEvents` mapping: `address => VerifiedFinancialEvent[]`
  (append-only per borrower).
- Modified `recordVerifiedRepayment` to accept three new parameters
  (`sourceChain`, `sourceTxHash`, `sourceBlock`) and append a
  `VerifiedFinancialEvent` for every successfully recorded repayment.
- Added public read methods:
  - `getEventCount(address borrower) → uint256`
  - `getEvents(address borrower, uint256 offset, uint256 limit) → VerifiedFinancialEvent[]`
    (reverse chronological; most recent first).

### ITRUCreditRegistry.sol

- Updated interface with new `recordVerifiedRepayment` signature and the two
  read methods.
- Moved `EventType` enum and `VerifiedFinancialEvent` struct to the interface
  so callers can decode the return data.

### TRUUniversalContract.sol

- Updated `execute` to accept `sourceTxHash` as a new parameter (position 4,
  after `encodedTransaction`).
- Passes `chainKey`, `sourceTxHash`, and `blockHeight` to the registry call.

### worker.mjs

- Updated `uc.execute` call to pass `log.transactionHash` as the new
  `sourceTxHash` parameter.

## Forge Tests (29 passing: 7 + 5 + 17)

New tests in `TRUCreditRegistryTest`:

- `test_verifiedRepaymentCreatesEventRecord` — single repayment creates
  exactly one event with all fields correct.
- `test_multipleRepaymentsCreateMultipleEventRecords` — multiple repayments
  append multiple events; order is reverse chronological (most recent first).
- `test_eventHistoryPagination` — pagination with offset/limit works
  correctly; offset beyond length returns empty; limit larger than remaining
  returns remaining.
- `test_replayGuardStillWorksWithEventHistory` — replay of same queryId
  reverts and does not create a duplicate event.
- `test_duplicateLoanGuardStillWorksWithEventHistory` — same loanId via
  different queryId reverts and does not create a duplicate event.
- `test_differentBorrowersHaveSeparateEventHistories` — each borrower has
  isolated event history.

All existing phase 5/6 tests still pass (replay, duplicate, borrower binding,
amount integrity, credit limit formula).

## Live End-to-End Test

**Contracts deployed:**
- SourceLoanMarket (Sepolia): `0x77DB02F5c51989517b1727c4338A8a5f50E89910`
- TRUUniversalContract (CC3): `0xe7CcCc48bDcC5eD546AD367E32a2dae7f0D79a49`
- TRUCreditRegistry (CC3): `0xFd7BF70EDCC4E1739957D50d67Aa8E1AB3038E40`

**Test flow:**
1. Driver created loan 0 on Sepolia (tx `0x015e9ada…`, block 11567315).
2. Driver repaid loan 0 with 123456789 wei (tx `0x0f3876ff…`, block 11567316).
3. Worker waited for attestation (~484s cold wait), built proof, submitted to
   TRUUniversalContract (tx `0xf223348a…`, CC3 block 5374232).
4. `RepaymentVerified` emitted and matched source event: YES.
5. Registry profile updated: `repayments=1, totalRepaid=123456789, creditLimit=100`.
6. **Event history verified on-chain:**
   - `getEventCount(borrower) = 1`
   - `getEvents(borrower, 0, 10)` returns one event with:
     - `eventId = 0x76288b14115461ec00a96ae6c436a34cf4966536e9789ce7ada4b6e15598b5a0`
       (matches queryId)
     - `borrower = 0x2b374aDd4b86Ab1bf6196D1f698Eeb77156aA0F0`
     - `sourceChain = 1`
     - `sourceTxHash = 0x0f3876ff75233fdaa64c01e68467e2697a45eff166d0057900dcbc989543c8ca`
       (matches repay tx)
     - `sourceBlock = 11567316`
     - `loanId = 0`
     - `eventType = 0` (Repayment)
     - `amount = 123456789`
     - `verifiedAt = 1787701680` (block timestamp of registry write)

**Replay test:**
- Resubmitting the same proof was rejected by TRUUniversalContract with
  `"Query already processed"`.
- Registry `getEventCount` remained 1 — no duplicate event created.

## Security Properties Maintained

| Property | Status |
| --- | --- |
| Replay protection | ✅ — `processedQueries` in UC + `processedRepayments` in registry |
| Borrower binding | ✅ — no borrower input; derived from verified tx |
| Loan binding | ✅ — emitter check + source contract logic |
| Amount integrity | ✅ — no amount input; derived from verified tx |
| Duplicate protection | ✅ — `countedLoans[borrower][loanId]` |

All enforced exactly as in phase 5/6; the new event storage is appended only
after all guards pass.

## Notes

- No second entry point added — event creation happens inside the existing
  UC-gated `recordVerifiedRepayment`, per AGENTS.md rule 6.
- No speculative/derived fields stored — only raw data tied to an actual
  USC-verified event.
- `EventType` enum and `VerifiedFinancialEvent` struct are defined in the
  interface for ABI compatibility; the contract inherits them (no duplicate
  definitions).
- Pagination is reverse-chronological (most recent first) to match typical
  frontend needs.
- Gas cost of `recordVerifiedRepayment` increased modestly due to the array
  push (~683k gas for deployment vs ~330k before; runtime cost per call is
  similar to before plus the SSTORE for the event array).