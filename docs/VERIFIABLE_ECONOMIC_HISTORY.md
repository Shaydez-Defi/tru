# Verifiable Economic History: Generalized Primitive

**Date:** 2026-09-08
**Status:** Implemented and verified live on testnet: a real obligation creation and completion on Sepolia were verified through the live Attestcoin proof path and recorded on Creditcoin, with deterministic Agent Passport derived.
**Scope:** Extend TRU from human loan history to verifiable economic history for humans and autonomous agents, reusing the existing Attestcoin / BlockProver verification architecture.

## 1. Summary

TRU originally proved: a loan repayment on Sepolia can be cryptographically verified on Creditcoin and become reusable credit history. This phase generalizes that primitive: any economic obligation between actors (requester and executor, where the executor may be an autonomous agent identified by its address) can be represented as an on-chain event, verified through the same cross-chain proof architecture, and recorded as part of the subject's verifiable economic history. The reusable primitive remains: TRU proves what happened, history stores the verified fact, and applications or agents interpret it.

The extension is minimal, production-minded, and preserves all existing loan functionality (73 tests passing, no loan code path changed).

## 2. Design Principle

Separation of concerns, as established in AGENTS.md rule 6, is extended:

1. **Verification**, TRU proves that an event actually happened. The BlockProver precompile (`0x…0FD2`) verifies the Merkle proof against an attested Sepolia block. No worker, API, or agent claim is trusted.
2. **History**, TRU records the verified event as reusable on-chain history in `TRUCreditRegistry`. The registry only updates state from `TRUUniversalContract`, which only forwards events that passed verification and emitter checks.
3. **Interpretation**, Applications, protocols, or autonomous agents query the history and apply their own policy (credit, access, financing). TRU never uses an LLM to decide trust and never invents a reputation number. Any derived metric is deterministic and traceable to verified events.

This mirrors the existing loan flow and keeps the trust boundary unchanged.

## 3. What Changed: Minimal Extension

### 3.1 Source chain: SourceObligationMarket (Sepolia)

New contract `contracts/src/sepolia/SourceObligationMarket.sol`, same trust model as `SourceLoanMarket`: it knows nothing about Creditcoin or TRU.

- `struct Obligation { id, requester, executor, value, deadline, status }`
- `ObligationCreated(uint256 indexed obligationId, address indexed requester, address indexed executor, uint256 value, uint256 deadline)`, emitted by `createObligation(address executor, uint256 value, uint256 deadline)` where `requester = msg.sender`, `status = ACTIVE`.
- `ObligationCompleted(uint256 indexed obligationId, address indexed executor, uint256 settlementAmount)`, emitted by `completeObligation(uint256 obligationId)` where `executor == msg.sender` and `status == ACTIVE` -> `COMPLETED`.
- `ObligationFailed` also emitted by `failObligation` for completeness, though the minimal demo uses Created and Completed.

This is the smallest useful primitive for "this economic obligation was actually completed", a requester creates an obligation for an executor (human wallet or agent address), the executor completes it, both events are verifiable. It is not a marketplace, not a reputation system, and does not add identity infrastructure beyond the address.

### 3.2 Verification: TRUUniversalContract (Creditcoin)

Extended, not replaced, reusing the exact same USC proof path as loan events:

- New state: `sourceObligationMarket` address, set via `setSourceObligationMarket` (owner-only), initially `address(0)` for backward compatibility.
- New signatures: `OBLIGATION_CREATED_EVENT_SIGNATURE = keccak("ObligationCreated(uint256,address,address,uint256,uint256)")` (4 topics: sig + obligationId + requester + executor), `OBLIGATION_COMPLETED_EVENT_SIGNATURE = keccak("ObligationCompleted(uint256,address,uint256)")` (3 topics).
- New events: `ObligationCreatedVerified` and `ObligationCompletedVerified`.
- New view decoders: `_decodeObligationCreated` and `_decodeObligationCompleted`, same pattern as loan decoders: check `txType`, `decodeReceiptFields`, filter `receiptLogs` in-contract (workaround for deployed `EvmV1Decoder.getLogsByEventSignature` breakage), check `log.address_ == sourceObligationMarket`, decode indexed topics and `abi.decode(data)`.
- New verification entry points: `executeObligationCreated` and `executeObligationCompleted`, identical steps to `execute` / `executeLoanOrigination`: compute `txIndex` via precompile, `queryId = keccak(chainKey, blockHeight, txIndex)`, check `processedQueries[queryId]` replay guard, call `verifyAndEmit`, decode, emit verified event, forward to registry via new UC-gated registry calls. No new trust boundary.

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
  - `recordVerifiedObligationCreated(queryId, obligationId, requester, executor, value, deadline, sourceChain, sourceTxHash, sourceBlock)`, checks `!processedObligationCreations[queryId]`, `obligationStatus == NONE`, sets `ACTIVE`, pushes to both `requester` and `executor` histories, tracks distinct chain for both, emits `ObligationCreatedRecorded`.
  - `recordVerifiedObligationCompleted(queryId, obligationId, executor, settlementAmount, sourceChain, sourceTxHash, sourceBlock)`, checks `!processedObligationCompletions[queryId]`, `status == ACTIVE`, checks `executor` matches created event's executor, sets `COMPLETED`, pushes Completed event to both parties' histories, tracks chains, emits `ObligationCompletedRecorded`.

No loan code path was changed; `recordVerifiedRepayment` and loan lifecycle remain.

- New views:
  - `getObligationStatus`, `getVerifiedObligation`, `getObligationEventCount`, `getObligationEvents` (paginated, reverse chronological)
  - `getAgentPassport(address subject)`, deterministic, no AI. Derived fields:
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
- Adds `processObligationCreated` and `processObligationCompleted`, same steps as loan handlers: wait for attestation via `ProofBuilder.waitUntilHeightAttested`, request proof via `getProof`, sanity check `verifySingle`, submit to `TRUUniversalContract.executeObligationCreated` / `executeObligationCompleted` with `sourceTxHash`, parse verified event, check registry status.
- `listen` now queries `LoanRepaid`, `LoanCreated`, `ObligationCreated`, `ObligationCompleted` per range, merges and sorts by block/logIndex, dispatches via `processLog`.
- `--tx` path auto-detects all four event types in the target block.

The worker still never decides; proof verification gates everything.

### 3.5 Deployment

`creditcoin/src/deploy-production.mjs` now deploys five contracts (was four):

1. `SourceLoanMarket` (Sepolia)
1b. `SourceObligationMarket` (Sepolia), new
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

The full live cross-chain obligation flow was executed for real on the current deployment (`SourceObligationMarket 0x133A8Fe8408066B95034Ed638f5C7083Be94d14F`, `TRUCreditRegistry 0x0D2707D258A87b971fd4cd78232304a672CA43c0`, `TRUUniversalContract 0xa33fd898502de87aA52C5992483b74f471613Ef0`):

**Implemented and verified live:**

* Self-obligation (executor == requester == `0x2b374aDd4b86Ab1bf6196D1f698Eeb77156aA0F0`, value `8000`):
  - Create `0x5a2757cdc55494c2f591b517c253f3543e8b736e9f6ab6124a26495f0a049771` block `11663734` -> worker waited `371.1s`, proof header `11663734` txIndex `54` cached true, `verifySingle` true, submitted via `executeObligationCreated` `0x720a42a950e42fa0e54ab443638ffbce07ec6b1f964fb6c3fc2586bf014f3ff1` block `5454297` -> `ObligationCreatedVerified` matched, `obligationStatus 0xACTIVE`.
  - Complete `0x9eb3725ae6e58db7b0926af5174e911396b8dd1a6765d6ff08508f355efb3707` block `11663735` -> worker `2.3s` (already attested), proof header `11663735` txIndex `81`, `verifySingle` true, `executeObligationCompleted` `0xf342b72c36413471674122fe318cc5b0afbf8be13d75d29613830cc6b576ce2c` block `5454298` -> `ObligationCompletedVerified` matched, `obligationStatus COMPLETED`. Agent Passport for `0x2b37…`: `verified 1, completed 1, active 0, settlement 8000, rate 10000`, history `2` (`Created` + `Completed`), `chains [1]`.

* Autonomous agent obligation (requester `0x2b374aDd…`, executor `0x8FC1b779592De32B507014103ebBEbbE91566FB1`, a wallet representing an autonomous agent, value `9000`, deadline `1788992128`):
  - Create `0x9591e6219585e73fc1c3e10421e5a818347b50254d6e9cf99e2cdfdd71677617` block `11663848` -> worker `464.0s`, header `11663848` txIndex `73`, `verifySingle` true, `executeObligationCreated` `0xe7961a54e83e2b57a47fd02189fd37ae503f50421798c53cadc2751f208dd5a1` block `5454388` -> `ACTIVE`.
  - Complete `0x3aa9af68306d2e646d491b48de3878ebc5d093f05414e88dac7e949bf491a40c` block `11663849` -> worker `2.3s`, header `11663849` txIndex `70`, `verifySingle` true, `executeObligationCompleted` `0xc19bc7df91805a135d5b4a3a1191c53488cc76ee6f3050b3f56f7bb35d0226b8` block `5454391` -> `COMPLETED`. Agent Passport for `0x8FC1…`: `verified 1, completed 1, active 0, settlement 9000, rate 10000`, history `2`, `chains [1]`.

**What this proves:** TRU verified that the configured `SourceObligationMarket` emitted the corresponding `ObligationCreated` and `ObligationCompleted` events in attested Sepolia blocks, with the exact `obligationId`, `requester`, `executor`, `value`, and `deadline`/`settlementAmount` as logged. The registry only updated after `verifyAndEmit` succeeded and the emitter check passed.

**What it does NOT prove:** that the real-world task behind the obligation was satisfactory, that the agent behaved honestly off-chain, or that the agent deserves a particular reputation score. Completion proves the on-chain event, not the quality of the work.

**Implemented but not yet run live in this phase:** `ObligationFailed` source event exists in `SourceObligationMarket` but TRU does not yet verify it (can be added with the same pattern as Created/Completed). A unified `VerifiedEconomicEvent` timeline merging loan and obligation histories is future, though `getCreditPassport` and `getAgentPassport` already provide clean separate views.

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

**Implemented and verified:** `ObligationCreated` and `ObligationCompleted` creation, verification, history, and `AgentPassport` are live and tested (73 tests, two live agents verified). `ObligationFailed` source event exists in `SourceObligationMarket` but TRU does not yet verify it, it can be added with the identical `decode`/`execute`/`recordVerified` pattern as the other two, no new trust boundary.

**Implemented but not yet run live in this deployment:** A unified `VerifiedEconomicEvent` timeline that merges loan `borrowerEvents` and obligation `subjectObligationHistory` into a single `getEconomicHistory` view. The current `getCreditPassport` (loans) and `getAgentPassport` (obligations) already provide clean, separate histories, so the unified view is optional and was not faked.

**Future work:** Frontend, add `Agent Passport` page and obligation detail with verification evidence links (source tx hash, proof header, Creditcoin verification tx, and `AgentPassport` fields). No new cryptography is needed; it is a read-only view over `getAgentPassport` / `getObligationEvents`.

All of the above can be done without inventing reputation numbers or trusting off-chain reports; every new field will continue to trace to a `queryId`-verified event.

## 10. Notes

- No AI/black-box scoring is used. The only derived numbers are `creditLimit = repayments * 100` (loans) and `completionRateBps` for agents, both documented and computed on-chain from counts.
- No fake or simulated verification layer exists; `verifyAndEmit` is always called before any state update, per AGENTS.md rule 2.
- No speculative fields are stored; every stored event maps to a real `ObligationCreated` or `ObligationCompleted` log from the configured `SourceObligationMarket`.
- The extension does not copy another project's terminology, architecture, UI, or demo flow; it grows directly from TRU's verified-event pipeline described in `docs/ATTESTCOIN-INTEGRATION.md`.

