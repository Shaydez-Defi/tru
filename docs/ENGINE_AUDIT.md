# Engine Audit — Verifiable Economic History Primitive

**Date:** 2026-09-09
**Scope:** Backend/protocol/engine only. No frontend, README, submission copy,
or UI changes. No AI, LLMs, NFTs, tokens, new chains, oracles, or trust scores
introduced. Existing loan repayment flow and live obligation-completion flow
preserved intact.
**Result:** Primitive confirmed sound. Both flows genuinely share one
verification primitive. Three documentation-only fixes applied; no logic,
storage, or ABI changes. 81/81 Forge tests pass.

## 1. The Generalized TRU Verification Primitive

Every state-changing verification in the system — `execute` (repayment),
`executeLoanOrigination`, `executeObligationCreated`,
`executeObligationCompleted` — runs the identical five-step sequence in
`TRUUniversalContract`:

1. `transactionIndex = VERIFIER.calculateTxIndex(merkleProof)`
2. `queryId = keccak(chainKey, blockHeight, txIndex)` via shared
   `_computeQueryId`; `require(!processedQueries[queryId])`
3. `verified = VERIFIER.verifyAndEmit(...)`; `require(verified)`
4. Decode the expected event from the verified receipt (`_decodeRepayment`,
   `_decodeLoanCreated`, `_decodeObligationCreated`,
   `_decodeObligationCompleted`), each enforcing receipt `status == 1` and an
   emitter check against the configured source market
5. Emit the `*Verified` event and forward to the single UC-gated registry entry

The four execute functions are structurally identical; only the decode branch
and the registry call differ. This is genuine reuse of one primitive, not
duplicated special-case logic. The repetition across the four functions is
intentional explicitness (each path independently readable and live-proven)
and was deliberately not refactored — collapsing them would touch all four
live paths for zero behavior change.

## 2. How Loan and Obligation Events Use It

- **Human:** `SourceLoanMarket.createLoan` → `LoanCreated`, `repayLoan` →
  `LoanRepaid` → proof → `executeLoanOrigination` / `execute` →
  `recordVerifiedLoanOrigination` / `recordVerifiedRepayment`.
- **Agent:** `SourceObligationMarket.createObligation` →
  `ObligationCreated`, `completeObligation` → `ObligationCompleted` → proof →
  `executeObligationCreated` / `executeObligationCompleted` →
  `recordVerifiedObligationCreated` / `recordVerifiedObligationCompleted`.
- Emitter binding is per-domain: loan decoders require
  `log.address_ == sourceLoanMarket`; obligation decoders additionally require
  `sourceObligationMarket != address(0)` (fail-closed when unset) and equality
  with it. A proof from an arbitrary contract is rejected at decode time even
  though the Merkle proof itself is valid — verification and authorization are
  separate, consecutive gates.
- `queryId` replays are guarded once, globally, in `processedQueries`, so one
  source transaction credits at most once even if it carried several events.
  Per-domain registry guards (`processedRepayments`, `processedOriginations`,
  `processedObligationCreations`, `processedObligationCompletions`,
  `countedLoans`, `loanStatus`, `obligationStatus`) add the second layer.

## 3. How Verified History Is Stored

- Loans: `borrowerEvents[borrower]` append-only `VerifiedFinancialEvent[]`;
  `profiles[borrower]` aggregates (`repayments`, `totalRepaid`, `creditLimit =
  0 + repayments*100`, unchanged).
- Obligations: `subjectObligationHistory[subject]` append-only
  `VerifiedObligationEvent[]` for both requester and executor (single push
  when they coincide); `obligationStatus[obligationId]` lifecycle
  (`NONE → ACTIVE → COMPLETED`); `obligationCreatedEvent` for the
  executor-mismatch check on completion.
- The two histories are fully isolated (covered by
  `test_loanAndObligationHistoriesAreIsolated`); loan accounting never reads
  obligation storage and vice versa.
- `sourceTxHash` remains the one relay-provided (not proof-bound) field,
  documented in `ITRUCreditRegistry` NatSpec since the security audit; no
  credit or lifecycle logic depends on it.

## 4. How AgentPassport Data Is Derived

`getAgentPassport` recomputes every field live from storage on each call, so
the view can never go stale:

- `verifiedObligations`: distinct `Created` obligationIds in the subject's history
- `completedObligations` / `failedObligations`: distinct `Completed` / `Failed`
  obligationIds (dedup loops; `Failed` is 0 today — no verified failure path
  exists by design, see §6)
- `activeObligations`: distinct `Created` whose global status is still `ACTIVE`
- `verifiedSettlementVolume`: sum of `Completed` values where
  `executor == subject` only (a pure requester accrues history but zero volume)
- `verifiedSourceChains`: the subject's distinct chain set
- `completionRateBps`: `completed * 10000 / verified`, `0` when `verified == 0`
  (no division by zero)
- Self-obligations (`requester == executor`) are stored once per event and
  counted once (live-verified, regression-tested).

## 5. Security / Replay Protections

Re-audited end to end; all hold as documented in `docs/SECURITY_AUDIT.md`:
UC-gated writes only (`onlyUniversalContract` on all four record functions),
proof-before-decode ordering with state rollback on revert, emitter checks per
domain, global queryId replay guard plus per-domain replay maps, duplicate
guards (`countedLoans`, `loanStatus`, `obligationStatus`), executor-mismatch
rejection on completion, zero-address rejection on creation, owner-only admin
setters with zero-address rejection on `setRegistry` / `setUniversalContract`.
`TRUFinancing` remains a read-only consumer (immutable registry, no
disbursement). Worker remains a relay: it supplies proof bytes plus
`chainKey`/`blockHeight` (both proof-bound) and `sourceTxHash` (index only).

## 6. Remaining Limitations

- `ObligationFailedVerified` event and `OBLIGATION_FAILED_EVENT_SIGNATURE`
  are declared but have no execute/record path; `failedObligations` is
  deterministically `0`. Reserved for a future failure path using the same
  pattern — not wired because failure semantics are not load-bearing today.
- Single-market ID namespaces: `loanId`/`obligationId` are globally unique
  per registry only while one market of each type is configured.
- No deadline enforcement on completion (source-market trust, documented).
- Self-loan gap persists for loans (known, documented, out of scope).
- `O(n²)` view loops are correct at current scale; future high-volume
  subjects want pagination or off-chain indexing.
- Owner key remains fully trusted (can re-point markets/registry); testnet
  operator key currently equals owner key — separate before production.

## 7. Tests and Verification Results

- `forge build`: clean (only pre-existing `block.timestamp`/typecast lint notes).
- `forge test`: **81 passed, 0 failed, 0 skipped** across 5 suites
  (7 SourceLoanMarket, 7 SourceObligationMarket, 13 TRUUniversalContract, 47
  TRUCreditRegistry, 7 TRUFinancing) — identical count to pre-audit baseline;
  no test needed changes because this audit made comment-only edits.
- Fixes in this audit (all NatSpec-only, no logic/storage/ABI change):
  1. `getCreditPassport`: documented `loanHistory` chronological
     (oldest-first) order vs `getEvents` most-recent-first paging.
  2. `getAgentPassport`: documented `obligationHistory` chronological order
     and that all counters recompute live (never stale).
  3. `getVerifiedObligation`: documented zero-struct return for unknown IDs
     (callers must check status/eventId).
- Live flows untouched and intact: loan chain (phase 10) and obligation chain
  (`0x9591e621…` → `0xe7961a54…`, `0x3aa9af68…` → `0xc19bc7df…`,
  `AgentPassport 1/1/0/9000/10000`) remain the current on-chain evidence;
  no redeploy performed.
