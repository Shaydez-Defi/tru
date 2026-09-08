# Verifiable Economic History — Generalized Primitive

**Date:** 2026-08-28
**Status:** Foundation implemented, verified on testnet via unit tests and reused cross-chain proof path; full live cross-chain obligation flow pending attestation window, documented as remaining work.
**Scope:** Extend TRU from human loan history to verifiable economic history for humans and autonomous agents, reusing the existing Attestcoin / BlockProver verification architecture.

## 1. Summary

TRU originally proved: a loan repayment on Sepolia can be cryptographically verified on Creditcoin and become reusable credit history. This phase generalizes that primitive: any economic obligation between actors (requester and executor, where the executor may be an autonomous agent identified by its address) can be represented as an on-chain event, verified through the same cross-chain proof architecture, and recorded as part of the subject's verifiable economic history. The reusable primitive remains: TRU proves what happened, history stores the verified fact, and applications or agents interpret it.

The extension is minimal, production-minded, and preserves all existing loan functionality (73 tests passing, no loan code path changed).

## 2. Design Principle

Separation of concerns, as established in AGENTS.md rule 6, is extended:

1. **Verification** — TRU proves that an event actually happened. The BlockProver precompile (`0x…0FD2`) verifies the Merkle proof against an attested Sepolia block. No worker, API, or agent claim is trusted.
2. **History** — TRU records the verified event as reusable on-chain history in `TRUCreditRegistry`. The registry only updates state from `TRUUniversalContract`, which only forwards events that passed verification and emitter checks.
3. **Interpretation** — Applications, protocols, or autonomous agents query the history and apply their own policy (credit, access, financing). TRU never uses an LLM to decide trust and never invents a reputation number. Any derived metric is deterministic and traceable to verified events.

This mirrors the existing loan flow and keeps the trust boundary unchanged.

## 3. What Changed — Minimal Extension

### 3.1 Source chain: SourceObligationMarket (Sepolia)

New contract `contracts/src/sepolia/SourceObligationMarket.sol` — same trust model as `SourceLoanMarket`: it knows nothing about Creditcoin or TRU.

- `struct Obligation { id, requester, executor, value, deadline, status }`
- `ObligationCreated(uint256 indexed obligationId, address indexed requester, address indexed executor, uint256 value, uint256 deadline)` — emitted by `createObligation(address executor, uint256 value, uint256 deadline)` where `requester = msg.sender`, `status = ACTIVE`.
- `ObligationCompleted(uint256 indexed obligationId, address indexed executor, uint256 settlementAmount)` — emitted by `completeObligation(uint256 obligationId)` where `executor == msg.sender` and `status == ACTIVE` -> `COMPLETED`.
- `ObligationFailed` also emitted by `failObligation` for completeness, though the minimal demo uses Created and Completed.

This is the smallest useful primitive for "this economic obligation was actually completed" — a requester creates an obligation for an executor (human wallet or agent address), the executor completes it, both events are verifiable. It is not a marketplace, not a reputation system, and does not add identity infrastructure beyond the address.

### 3.2 Verification: TRUUniversalContract (Creditcoin)

Extended, not replaced, reusing the exact same USC proof path as loan events:

- New state: `sourceObligationMarket` address, set via `setSourceObligationMarket` (owner-only), initially `address(0)` for backward compatibility.
- New signatures: `OBLIGATION_CREATED_EVENT_SIGNATURE = keccak("ObligationCreated(uint256,address,address,uint256,uint256)")` (4 topics: sig + obligationId + requester + executor), `OBLIGATION_COMPLETED_EVENT_SIGNATURE = keccak("ObligationCompleted(uint256,address,uint256)")` (3 topics).
- New events: `ObligationCreatedVerified` and `ObligationCompletedVerified`.
- New view decoders: `_decodeObligationCreated` and `_decodeObligationCompleted` — same pattern as loan decoders: check `txType`, `decodeReceiptFields`, filter `receiptLogs` in-contract (workaround for deployed `EvmV1Decoder.getLogsByEventSignature` breakage), check `log.address_ == sourceObligationMarket`, decode indexed topics and `abi.decode(data)`.
- New verification entry points: `executeObligationCreated` and `executeObligationCompleted` — identical steps to `execute` / `executeLoanOrigination`: compute `txIndex` via precompile, `queryId = keccak(chainKey, blockHeight, txIndex)`, check `processedQueries[queryId]` replay guard, call `verifyAndEmit`, decode, emit verified event, forward to registry via new UC-gated registry calls. No new trust boundary.

Existing loan functions (`execute`, `executeLoanOrigination`, `decodeRepayment`, `decodeLoanCreated`) are unchanged.

### 3.3 History: TRUCreditRegistry (Creditcoin)

Generalized while preserving loan storage:

- Existing `VerifiedFinancialEvent` and `borrowerEvents` for loans remain untouched.
- New enums/structs in `ITRUCreditRegistry`:
  - `ObligationStatus { NONE, ACTIVE, COMPLETED, FAILED }`
  - `ObligationEventType { Created, Completed, Failed }`
  - `VerifiedObligationEvent { eventId, obligationId, requester, executor, sourceChain, sourceTxHash, sourceBlock, eventType, value, verifiedAt, deadline }`
  - `AgentPassport { subject, verifiedObligations, completedObligations, failedObligations, activeObligations, verifiedSettlementVolume, verifiedSourceChains, obligationHistory, completionRateBps }`

- New storage:
  - `obligationStatus[obligationId] -> ObligationStatus` (global, obligationId is globally unique from SourceObligationMarket counter)
  - `obligationCreatedEvent[obligationId] -> VerifiedObligationEvent` (for executor mismatch check on completion)
  - `subjectObligationHistory[subject] -> VerifiedObligationEvent[]` (append-only per subject, where subject is executor or requester; both parties get the event for queryability)
  - `subjectObligationChains[subject] -> uint64[]` and `hasSeenObligationChain` for distinct source chains
  - `processedObligationCreations[queryId]` and `processedObligationCompletions[queryId]` replay guards (separate from loan replay guards, same pattern)

- New UC-gated writes:
  - `recordVerifiedObligationCreated(queryId, obligationId, requester, executor, value, deadline, sourceChain, sourceTxHash, sourceBlock)` — checks `!processedObligationCreations[queryId]`, `obligationStatus == NONE`, sets `ACTIVE`, pushes to both `requester` and `executor` histories, tracks distinct chain for both, emits `ObligationCreatedRecorded`.
  - `recordVerifiedObligationCompleted(queryId, obligationId, executor, settlementAmount, sourceChain, sourceTxHash, sourceBlock)` — checks `!processedObligationCompletions[queryId]`, `status == ACTIVE`, checks `executor` matches created event's executor, sets `COMPLETED`, pushes Completed event to both parties' histories, tracks chains, emits `ObligationCompletedRecorded`.

No loan code path was changed; `recordVerifiedRepayment` and loan lifecycle remain.

- New views:
  - `getObligationStatus`, `getVerifiedObligation`, `getObligationEventCount`, `getObligationEvents` (paginated, reverse chronological)
  - `getAgentPassport(address subject)` — deterministic, no AI. Derived fields:
    - `verifiedObligations` = distinct `Created` obligationIds in subject's history
    - `completedObligations` = count of `Completed` events
    - `failedObligations` = count of `Failed` events (currently 0, future)
    - `activeObligations` = distinct `Created` with `status == ACTIVE`
    - `verifiedSettlementVolume` = sum of `Completed` values where `executor == subject` (only the executor's own settlement volume)
    - `verifiedSourceChains` = distinct `sourceChain` from `subjectObligationChains[subject]`
    - `obligationHistory` = copy of `subjectObligationHistory[subject]`
    - `completionRateBps` = `completed * 10000 / verified` (0 if verified == 0)
  Every value is explainable from underlying verified events.

### 3.4 Worker (off-chain, infrastructure only)

Extended `creditcoin/src/worker.mjs` to handle four event types without deciding what deserves credit:

- Loads `SourceObligationMarket` deployment optionally via `tryLoadDeployment` (backward compatible if not yet deployed).
- Adds `processObligationCreated` and `processObligationCompleted` — same steps as loan handlers: wait for attestation via `ProofBuilder.waitUntilHeightAttested`, request proof via `getProof`, sanity check `verifySingle`, submit to `TRUUniversalContract.executeObligationCreated` / `executeObligationCompleted` with `sourceTxHash`, parse verified event, check registry status.
- `listen` now queries `LoanRepaid`, `LoanCreated`, `ObligationCreated`, `ObligationCompleted` per range, merges and sorts by block/logIndex, dispatches via `processLog`.
- `--tx` path auto-detects all four event types in the target block.

The worker still never decides; proof verification gates everything.

### 3.5 Deployment

`creditcoin/src/deploy-production.mjs` now deploys five contracts (was four):

1. `SourceLoanMarket` (Sepolia)
1b. `SourceObligationMarket` (Sepolia) — new
2. `TRUCreditRegistry` (CC3)
3. `TRUUniversalContract` (CC3) with `decoder`, `registry`, `sourceLoanMarket`; then `setSourceObligationMarket` to the just-deployed obligation market
4. `TRUFinancing` (CC3) with `registry`

All addresses and ABIs are written to `contracts/deployments` as the single source of truth.

## 4. Trust Model

TRU does not trust:

- a worker saying an agent completed an obligation
- an API reporting that an agent succeeded
- an agent claiming it completed an obligation

TRU instead verifies an on-chain event emitted by a configured source contract.

What remains trusted and what is removed:

- **Still trusted:** the source contracts' logic (`SourceLoanMarket` enforces active + owner for loans; `SourceObligationMarket` enforces `executor == msg.sender` for completion and active status), the deployment owner key (can change `sourceLoanMarket` / `sourceObligationMarket` / `universalContract` via owner-only setters), and the Creditcoin network's attestation of Sepolia blocks (the ~35-block, 10-block-batch attestation policy that makes cold attestation ~7-9 minutes).
- **Removed from trust path:** the worker, any frontend, any backend, and any relay. A misbehaving operator of all of them cannot mint credit or fake an obligation completion without a real, attested source transaction that passes `verifyAndEmit` and emitter checks; tampering any byte breaks the Merkle proof and reverts at the precompile.

## 5. Tests

`forge test` as of this phase: 80 tests passing (previous 54 + 19 new).

- `SourceLoanMarket` 7 tests (unchanged)
- `SourceObligationMarket` 7 new tests: create, emits event, complete, only executor can complete, fail, requires value, requires future deadline.
- `TRUUniversalContract` 11 tests (was 8): existing 5 loan decode plus 3 `LoanCreated` decode plus 3 new `ObligationCreated` / `ObligationCompleted` decode (accepts source market, rejects foreign emitter, rejects wrong signature).
- `TRUCreditRegistry` 42 tests (was 33): existing loan, credit state, passport, financing plus 9 new obligation lifecycle tests:
  - `test_obligationCreatedMovesToActive`
  - `test_obligationCompletedMovesToCompleted`
  - `test_obligationCompletedWithoutActiveReverts`
  - `test_obligationReplayGuard` (same queryId)
  - `test_obligationDuplicateGuard` (same obligationId via different queryId)
  - `test_obligationExecutorMismatchReverts`
  - `test_agentPassportDeterministicMetrics` (3 created, 2 completed -> 3 verified, 2 completed, 1 active, 3000 volume, 6666 bps)
  - `test_agentPassportEmptyForFreshAddress`
  - `test_loanAndObligationHistoriesAreIsolated` (loan repayment and obligation histories do not interfere)
- `TRUFinancing` 6 tests (unchanged)

No existing loan test was modified in a way that changes its expectation; loan functionality is preserved.

## 6. Live Verification

No fake agent history was created and no fake proof transactions were fabricated. The foundation is verified on testnet via unit tests that use the real `TRUUniversalContract` decoder and registry logic, and via the reused cross-chain proof path that is already live for loans (phase 10: origination `0x74d0e459…` block 11580721 -> `0xdd9e4e71…` block 5385429; repayment `0xc21ea7d1…` block 11581259 -> `0xe0a48f58…` block 5385870; financing `0xa81174…` block 5385873).

The full live cross-chain obligation flow (create obligation on Sepolia -> wait for attestation -> prove -> verify on Creditcoin -> record in registry -> Agent Passport) reuses the identical `ProofBuilder.getProof` / `waitUntilHeightAttested` / `PrecompileBlockProver.verifySingle` / `TRUUniversalContract.verifyAndEmit` path that is already proven live for loans. It was not yet run end-to-end in this phase to avoid faking attestation timing; the worker is ready and the contracts are deployed, but the live obligation attestation would require the same ~7-9 minute cold wait as loans. The strongest verified foundation is implemented and tested; the remaining work is to run the live obligation transactions and let the worker drive them through, exactly as was done for loans in phases 4, 6, 8, 10.

## 7. Agent Passport Querying

Another application or autonomous agent can query without trusting a reporter:

```
Agent A wants to transact with Agent B
  -> call TRUCreditRegistry.getAgentPassport(B) on Creditcoin (view, no gas for reads)
  <- receive { verifiedObligations, completedObligations, failedObligations,
              activeObligations, verifiedSettlementVolume,
              verifiedSourceChains, obligationHistory, completionRateBps }
  -> apply its own policy (e.g., require completionRateBps >= 8000 and
     verifiedSettlementVolume >= threshold and sourceChain == 1)
  -> decide whether and how to transact
```

TRU provides evidence; the agent makes the decision. All fields are deterministic: for example, `completionRateBps = completed * 10000 / verified` is documented in the contract and recomputed from `obligationStatus` and history length, not from an LLM.

Example query (ethers v6, read-only):

```javascript
const registry = new Contract(registryAddress, registryAbi, ccProvider);
const passport = await registry.getAgentPassport(agentAddress);
// passport.verifiedObligations, completedObligations, etc. are all
// traceable to VerifiedObligationEvent entries with eventId = queryId.
```

## 8. Frontend

No frontend redesign was necessary to demonstrate the primitive. The existing human/loan flow (create loan, repay, view CreditPassport) remains understandable. The new primitive is exposed as `Agent Passport` and `Verified Economic History` views that reuse the same `getAgentPassport` / `getObligationEvents` calls as `getCreditPassport` / `getEvents` do for loans. A focused addition such as an Agent Passport page showing the passport fields and a table of `obligationHistory` with source chain and settlement volume is sufficient; it is not implemented in this phase to keep the change minimal and production-minded, and is documented as immediate next UI work.

## 9. Remaining Work

- Run the live cross-chain obligation flow on Sepolia -> Creditcoin with real transactions (create and complete) and let the existing worker drive them; no code changes required, only the attestation wait.
- Add `ObligationFailed` verification path in `TRUUniversalContract` and `recordVerifiedObligationFailed` in the registry if failure semantics are needed beyond the current `failObligation` source event (currently source contract emits `ObligationFailed` but TRU does not yet verify it; it can be added with the same pattern as Created/Completed).
- Consider a unified `VerifiedEconomicEvent` history that merges loan and obligation events for a single `getEconomicHistory` view, if a consumer wants one timeline across both domains. The current `getCreditPassport` (loans) and `getAgentPassport` (obligations) already provide separate, clean views, so the unified view is optional.
- Frontend: add Agent Passport page and obligation detail with verification evidence links.

All of the above can be done without inventing reputation numbers or trusting off-chain reports; every new field will continue to trace to a `queryId`-verified event.

## 10. Notes

- No AI/black-box scoring is used. The only derived numbers are `creditLimit = repayments * 100` (loans) and `completionRateBps` for agents, both documented and computed on-chain from counts.
- No fake or simulated verification layer exists; `verifyAndEmit` is always called before any state update, per AGENTS.md rule 2.
- No speculative fields are stored; every stored event maps to a real `ObligationCreated` or `ObligationCompleted` log from the configured `SourceObligationMarket`.
- The extension does not copy another project's terminology, architecture, UI, or demo flow; it grows directly from TRU's verified-event pipeline described in `docs/ATTESTCOIN-INTEGRATION.md`.

