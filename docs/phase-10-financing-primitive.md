# Phase 10 — Financing Primitive

Two tasks. Task 1 fixes a small gap in `TRUCreditRegistry.getCreditPassport`
where `verifiedSourceChains` missed chains that only had a verified origination.
Task 2 is backend upgrade brief section 7, the last piece before README/pitch
work: a minimal credit-gated financing primitive that reads verified state and
records a request.

## Task 1 — verifiedSourceChains gap

### Problem

`getCreditPassport` derived `verifiedSourceChains` only from `borrowerEvents`
(repayment history). A borrower who had only a verified `LoanCreated` — no
`LoanRepaid` yet — would report `verifiedSourceChains = []` even though a
chain had a verified fact.

### Fix

- New storage in `TRUCreditRegistry.sol`:
  - `borrowerOriginationChains[borrower] -> uint64[]` (distinct list)
  - `hasSeenOriginationChain[borrower][chainKey] -> bool` (dedup set)
- `recordVerifiedLoanOrigination` now, after marking `ACTIVE` and bumping
  `outstandingObligations`, inserts `sourceChain` into that set if not already
  present.
- `getCreditPassport` now builds `verifiedSourceChains` from **both** sources:
  `borrowerEvents` (repayments) and `borrowerOriginationChains` (originations),
  deduplicated into a single distinct array. Currently this is still `[1]` for
  Sepolia, but the gap is closed for any future chain.

### Forge tests

Updated `test_creditPassportAfterOriginationAndRepayment` to expect
`verifiedSourceChains = [1]` immediately after origination (was `[]` before the
fix). Added:

- `test_verifiedSourceChainsWithOnlyOrigination` — verifies only an origination
  (no repayment) for a borrower and asserts `verifiedSourceChains == [CHAIN_KEY]`,
  `loanHistory == 0`, `outstandingObligations == 1`.

`test_verifiedSourceChainsDistinct` still asserts two repayments on the same
chain dedup to `[1]`.

## Task 2 — TRUFinancing.sol

New, separate contract on Creditcoin CC3. It reads verified credit state, it
does not verify anything itself, and it does not disburse funds. The trust
boundary stays where it is: `TRUFinancing` trusts `TRUCreditRegistry`'s
already-verified state, nothing more.

### Design

- Constructor takes `TRUCreditRegistry` address.
- `requestFinancing(uint256 amount) external`:
  - Reads `registry.getCreditEvidence(msg.sender)`.
  - **Threshold choice documented** (same style as phase 8 tier comments):
    `creditState >= BUILDING` is required. `NEW` (0 verified repayments, zero
    history) is not financeable. `BUILDING (1-2)`, `ESTABLISHED (3-5)`,
    `VERIFIED (6+)` are eligible. This is deterministic and explainable.
  - Requires `amount > 0` and `amount <= evidence.creditLimit`.
  - On success stores `FinancingRequest { borrower, amount, timestamp,
    creditStateAtRequest, status }` with `status = APPROVED`. Decision and
    documentation: **eligibility alone constitutes approval** for this minimal
    primitive; `PENDING` is defined for future extension where a separate
    approver step might exist, but is not used here. This keeps the choice
    explicit and not ambiguous, matching how phase 9 documented its edge case.
  - Emits `FinancingRequested(borrower, requestId, amount, creditStateAtRequest,
    status)`.
  - Explicitly does not transfer tokens, mint, or disburse — recorded,
    credit-gated request only.
- Read methods: `getFinancingRequests(address)` and `getFinancingRequestCount(address)`.
- Storage: `mapping(address => FinancingRequest[])`.

### Forge tests (6 new)

All in `contracts/test/TRUFinancing.t.sol` using a real `TRUCreditRegistry`
deployed in `setUp`:

- `test_requestSucceedsWithinBounds` — one verified repayment (BUILDING, limit
  100) then `requestFinancing(50)` succeeds, stored with `APPROVED` and
  snapshot `BUILDING`.
- `test_requestRevertsForNewState` — fresh borrower (0 repayments, NEW) reverts
  "Insufficient credit state".
- `test_requestRevertsForAmountExceedingCreditLimit` — limit 100, request 101
  reverts "Amount exceeds credit limit", 100 succeeds.
- `test_multipleRequestsRecorded` — two requests 10 and 20 both stored, count 2.
- `test_creditStateAtRequestSnapshot` — request at BUILDING, add two more
  repayments to reach ESTABLISHED, second request snapshots ESTABLISHED while
  first remains BUILDING (does not retroactively change).
- `test_requestDoesNotDisburseFunds` — balances unchanged, financing contract
  holds no funds.

## Deployments (current)

- SourceLoanMarket (Sepolia): `0x9013c573Ca23450456E7091d369E79BC7803E72A`
- TRUCreditRegistry (CC3): `0x0Eed154cf8c024d7f16D1c5856EC71E34aCebc5b`
- TRUUniversalContract (CC3): `0x8BF244FEf53060e262de699D099C649cF3Bf14D9`
- TRUFinancing (CC3): `0xf5180eD8244a8B25F6F100EA0ccD5e1a727354a6` (registry
  `0x0Eed...`, tx `0x3725187fb016cf1ef58fd9f323fe504fc4a0b8aad6f4e83a68ed08c3f11d5fe4`,
  gas 403014)

Previous phase addresses (`0x28B98e…`, `0xdd808b…`, `0xfcf73…`) are superseded by
the redeploy that included the Task 1 fix.

## Live test

Used the phase 9 live borrower `0x2b374aDd4b86Ab1bf6196D1f698Eeb77156aA0F0`
(Sepolia wallet, same address on CC3, funded with 1 CTC from
`0x493A…` on CC3 for gas: `0x1f44d6d4…`).

Flow after the fresh redeploy:

1. Create loan 0 on Sepolia (tx `0x74d0e459379fb89894db4d2b7903f15cb18ec27e90669c0f8743380f9749ac8a`,
   block 11580721, principal 1000000) → worker `executeLoanOrigination`
   (tx `0xdd9e4e7183c816776aab9b69b45f5578406035555181fee24ee5bc09bccfaf3c`,
   CC3 block 5385429) → `loanStatus ACTIVE`, `outstanding 1`,
   `verifiedSourceChains [1]` (now visible even before repayment, via origination
   tracking).

2. Repay loan 0 (tx `0xc21ea7d1505fcbbc10ff1ebbf1e5774e3608296652cb0bca17787bd35a34db8e`,
   block 11581259, amount 123456789) → worker `execute`
   (tx `0xe0a48f58639dcb7aab0d1f84ffe6eeade1df7076eaf9040fb815ee660d5f2b4d`,
   CC3 block 5385870) → `repayments 1, creditLimit 100, status BUILDING`,
   `loanStatus REPAID`, `outstanding 0`, `loanHistory 1`, `verifiedSourceChains [1]`.

3. Financing — as `0x2b374a…` on CC3:
   - `getCreditEvidence` before: `BUILDING, 1, 100, 1, 0`.
   - `requestFinancing(50)` (tx `0xa8117461a266471e2b67ebccc8d5d7f302d3e6484f31d2698872f0613525b097`,
     block 5385873, gas 150544) succeeded.
   - `getFinancingRequests(borrower)` → 1 request:
     `borrower 0x2b374a…, amount 50, timestamp 1787876505, creditStateAtRequest
     BUILDING (1), status APPROVED (1)`.
   - `requestFinancing(200)` correctly reverted "Amount exceeds credit limit".
   - Fresh random wallet (0 repayments, NEW) correctly reverted "Insufficient
     credit state".

A second origination (loan 1, tx `0x51304901243829d2c954a8800a062d3d7eb4d5286e4bbbddae74a1eb721c7fd9`,
block 11581301 → `executeLoanOrigination` `0xd0a6d85f…` block 5385914) moved
`outstanding` back to 1 and kept `verifiedSourceChains [1]`, confirming the
origination-only chain tracking live.

## Full test count

`forge test`: 54 passing (7 SourceLoanMarket, 8 TRUUniversalContract, 33
TRUCreditRegistry, 6 TRUFinancing). Task 1's new origination-only chain test and
Task 2's financing suite are included; all earlier phase tests still pass.

## Notes

- `TRUFinancing` never calls the USC verifier and never writes to
  `TRUCreditRegistry`; it is a pure consumer of already-verified state.
- No funds disbursed — financing is a recorded eligibility check, not a transfer.
- Credit-state threshold `BUILDING` and `APPROVED` status are documented in
  contract comments so the choice is not left implicit.
