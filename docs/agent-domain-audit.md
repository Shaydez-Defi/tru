# Agent Domain Audit

Audit of the obligation / Agent Passport domain. Every claim below is
sourced from the contract source, test output, deployment files, or
checked docs. Nothing is invented.

---

## 1. SourceObligationMarket

**Contract:** `contracts/src/sepolia/SourceObligationMarket.sol` (87 lines)

### Obligation struct fields

```solidity
struct Obligation {
    uint256 id;
    address requester;
    address executor;
    uint256 value;
    uint256 deadline;
    uint8 status; // 0=NONE, 1=ACTIVE, 2=COMPLETED, 3=FAILED
}
```

**Confirmed:** Six fields: `id`, `requester`, `executor`, `value`, `deadline`, `status`.

### Events emitted

```solidity
event ObligationCreated(uint256 indexed obligationId, address indexed requester, address indexed executor, uint256 value, uint256 deadline);
event ObligationCompleted(uint256 indexed obligationId, address indexed executor, uint256 settlementAmount);
event ObligationFailed(uint256 indexed obligationId, address indexed executor);
```

**Confirmed:** Three events: `ObligationCreated`, `ObligationCompleted`, `ObligationFailed`.

### Lifecycle

| Transition | Function | Guard |
|---|---|---|
| NONE → ACTIVE | `createObligation(executor, value, deadline)` | `value > 0`, `deadline > block.timestamp`, `executor != address(0)` |
| ACTIVE → COMPLETED | `completeObligation(obligationId)` | `msg.sender == executor`, `status == 1` |
| ACTIVE → FAILED | `failObligation(obligationId)` | `msg.sender == requester \|\| msg.sender == executor`, `status == 1` |

**Confirmed:** Three states reachable: ACTIVE (1), COMPLETED (2), FAILED (3). FAILED is reachable at SourceObligationMarket level (either party can call), but TRU does not yet verify it (see section 4).

### Deployment

**Confirmed:** Deployed to Ethereum Sepolia (chainId 11155111).
- Address: `0x133A8Fe8408066B95034Ed638f5C7083Be94d14F`
- Source: `contracts/deployments/sepolia/SourceObligationMarket.json`

---

## 2. Test coverage

### SourceObligationMarket.t.sol: 7 tests

| # | Test name | What it covers |
|---|---|---|
| 1 | `test_createObligation` | Creates obligation, checks all struct fields |
| 2 | `test_createObligationEmitsEvent` | ObligationCreated event emission |
| 3 | `test_completeObligation` | ACTIVE → COMPLETED transition |
| 4 | `test_completeObligationOnlyExecutor` | Non-executor cannot complete |
| 5 | `test_failObligation` | ACTIVE → FAILED transition |
| 6 | `test_createObligationRequiresValue` | Revert on value=0 |
| 7 | `test_createObligationRequiresFutureDeadline` | Revert on past deadline |

### TRUCreditRegistry.t.sol: 13 obligation/Agent Passport tests

| # | Test name | What it covers |
|---|---|---|
| 1 | `test_obligationCreatedMovesToActive` | create → ACTIVE, executor+requester see event |
| 2 | `test_obligationCompletedMovesToCompleted` | complete → COMPLETED, passport fields verified |
| 3 | `test_obligationCompletedWithoutActiveReverts` | Cannot complete non-active |
| 4 | `test_obligationReplayGuard` | Same queryId replayed reverts |
| 5 | `test_obligationDuplicateGuard` | Same obligationId twice reverts |
| 6 | `test_obligationExecutorMismatchReverts` | Wrong executor on completion reverts |
| 7 | `test_agentPassportDeterministicMetrics` | 3 created, 2 completed → passport: 3/2/1/3000/6666bps |
| 8 | `test_agentPassportEmptyForFreshAddress` | Zeroed passport for fresh address |
| 9 | `test_obligationDoubleCompletionReverts` | Second completion with fresh queryId reverts |
| 10 | `test_obligationZeroAddressReverts` | Zero address requester/executor reverts |
| 11 | `test_selfObligationNotDoubleCounted` | self-obligation: history=2, passport=1/1/0/8000/10000bps |
| 12 | `test_sourceTxHashStoredAsRelayProvided` | sourceTxHash is relay-provided, queryId is the verified ID |
| 13 | `test_loanAndObligationHistoriesAreIsolated` | Loan and obligation histories use separate storage |

### TRUUniversalContract.t.sol: 4 obligation decode tests

| # | Test name | What it covers |
|---|---|---|
| 1 | `test_decodeObligationCreatedAcceptsSourceMarket` | Decode succeeds for correct emitter |
| 2 | `test_decodeObligationCreatedRejectsForeignEmitter` | Foreign emitter reverts |
| 3 | `test_decodeObligationCompletedRejectsForeignEmitter` | Foreign emitter reverts |
| 4 | `test_decodeObligationCompletedAcceptsSourceMarket` | Decode succeeds for correct emitter |

### TRUAudit.t.sol: 7 obligation-related tests

| # | Test name | What it covers |
|---|---|---|
| 1 | `test_obligationRecordPathsRequireUniversalContract` | Random caller rejected on both create and complete |
| 2 | `test_nonUniversalCallerCannotReachReplayLogic` | Auth gate precedes replay logic |
| 3 | `test_rotatingUniversalContractPreservesHistory` | UC rotation doesn't wipe obligation state |
| 4 | `test_failedObligationsRemainZeroWithoutFailurePath` | failedObligations=0 pinned (no verified failure path) |
| 5 | `test_passportGasScalesWithHistory` | Gas at n=2,4,8 obligations; all <10M gas |
| 6 | `test_ucSettersAreOwnerOnly` | setSourceObligationMarket owner-only |
| 7 | `test_ucSettersRejectZeroAddress` | setSourceObligationMarket allows zero (fail-closed) |

### Total

**Confirmed: 31 Forge tests** directly covering SourceObligationMarket, obligation events, or the Agent Passport.
- 7 in `SourceObligationMarket.t.sol`
- 13 in `TRUCreditRegistry.t.sol`
- 4 in `TRUUniversalContract.t.sol`
- 7 in `TRUAudit.t.sol`

---

## 3. Agent Passport

### Function

`getAgentPassport(address subject)` in `TRUCreditRegistry.sol:496-594`.

### Return type: `AgentPassport`

Defined in `ITRUCreditRegistry.sol:136-146`:

```solidity
struct AgentPassport {
    address subject;
    uint256 verifiedObligations;
    uint256 completedObligations;
    uint256 failedObligations;
    uint256 activeObligations;
    uint256 verifiedSettlementVolume;
    uint64[] verifiedSourceChains;
    VerifiedObligationEvent[] obligationHistory;
    uint256 completionRateBps;
}
```

**Confirmed:** Nine fields exactly as listed.

### How each field is computed

All fields are recomputed live from `subjectObligationHistory[subject]` storage on every call (no cached/stale state):

- **verifiedObligations**: count of distinct `obligationId` values with `eventType == Created` in the subject's history
- **completedObligations**: count of distinct `obligationId` values with `eventType == Completed` where `executor == subject`
- **failedObligations**: count of distinct `obligationId` values with `eventType == Failed`
- **activeObligations**: count of distinct `obligationId` values with `eventType == Created` AND `obligationStatus[oid] == ACTIVE`
- **verifiedSettlementVolume**: sum of `value` for `Completed` events where `executor == subject` (deduplicated by obligationId)
- **verifiedSourceChains**: distinct `sourceChain` values from `subjectObligationChains[subject]`
- **obligationHistory**: full copy of `subjectObligationHistory[subject]` (chronological, oldest-first)
- **completionRateBps**: `(completedObligations * 10000) / verifiedObligations`, 0 if no verified obligations

### Whitepaper claim check

Claim: "It does not use an LLM, a subjective scoring model, token ownership, NFT metadata, or self-reported claims."

**Confirmed accurate.** The function is pure computation over on-chain storage. Every field traces to `VerifiedObligationEvent` records that were written only after USC proof verification succeeded (`executeObligationCreated` / `executeObligationCompleted` in TRUUniversalContract). There is no external call, no oracle, no token check, no NFT check, no AI/LLM invocation. The code comment at line 488-491 explicitly states: "no AI or subjective scoring. The caller interprets the evidence per their own policy."

---

## 4. Live demo evidence

### Agent `0x8FC1b779592De32B507014103ebBEbbE91566FB1` (autonomous agent wallet)

Confirmed from README proof table and `docs/VERIFIABLE_ECONOMIC_HISTORY.md`:

| Step | Source tx (Sepolia) | Proof tx (CC3) | Details |
|---|---|---|---|
| Obligation created | `0x9591e6219585e73fc1c3e10421e5a818347b50254d6e9cf99e2cdfdd71677617` block `11663848` | `0xe7961a54e83e2b57a47fd02189fd37ae503f50421798c53cadc2751f208dd5a1` block `5454388` | Cold attestation 464.0s |
| Obligation completed | `0x3aa9af68306d2e646d491b48de3878ebc5d093f05414e88dac7e949bf491a40c` block `11663849` | `0xc19bc7df91805a135d5b4a3a1191c53488cc76ee6f3050b3f56f7bb35d0226b8` block `5454391` | 2.3s (already attested) |

Agent Passport at time of demo: `verified 1, completed 1, active 0, volume 9000, 10000 bps, chains [1]`.

### Self-obligation for `0x2b374aDd4b86Ab1bf6196D1f698Eeb77156aA0F0`

| Step | Source tx (Sepolia) | Proof tx (CC3) |
|---|---|---|
| Created | `0x5a2757cdc55494c2f591b517c253f3543e8b736e9f6ab6124a26495f0a049771` block `11663734` | `0x720a42a950e42fa0e54ab443638ffbce07ec6b1f964fb6c3fc2586bf014f3ff1` block `5454297` |
| Completed | `0x9eb3725ae6e58db7b0926af5174e911396b8dd1a6765d6ff08508f355efb3707` block `11663735` | `0xf342b72c36413471674122fe318cc5b0afbf8be13d75d29613830cc6b576ce2c` block `5454298` |

Agent Passport: `verified 1, completed 1, active 0, settlement 8000, rate 10000`.

### Whitepaper numbers check

The whitepaper claims: "one verified obligation, one completed obligation, zero active obligations, settlement volume of 9,000 source units, a 100% completion rate, one source chain."

**Confirmed accurate for agent `0x8FC1…`.** These numbers trace to the single create+complete flow documented in the README proof table and `VERIFIABLE_ECONOMIC_HISTORY.md`. The live demo script (`demo-obligation.mjs`) reads these values from the on-chain registry at runtime, not from hardcoded constants.

### Was there ever more than one obligation, or a failed/active one?

- **Multiple obligations in a single passport:** The test `test_agentPassportDeterministicMetrics` (TRUCreditRegistry.t.sol:641) exercises 3 created / 2 completed / 1 active, proving the passport handles multi-obligation scenarios correctly. This is a Forge test, not a live run.
- **Live:** Only the single-obligation demo (for `0x8FC1…`) and the single self-obligation (for `0x2b37…`) are documented as live runs. No live run with multiple obligations, a failed obligation, or a still-active obligation is documented.
- **Failed obligation:** `ObligationFailed` exists at the SourceObligationMarket level, but the verified failure path is explicitly documented as NOT YET IMPLEMENTED in TRU. The audit test `test_failedObligationsRemainZeroWithoutFailurePath` pins this limitation.

---

## 5. Agent-specific design intent

### From `docs/VERIFIABLE_ECONOMIC_HISTORY.md`

> "TRU originally proved: a loan repayment on Sepolia can be cryptographically verified on Creditcoin and become reusable credit history. This phase generalizes that primitive: any economic obligation between actors (requester and executor, where the executor may be an autonomous agent) can be represented as an on-chain event, verified through the same cross-chain proof architecture, and recorded as part of the subject's verifiable economic history."

> "This is the smallest useful primitive for 'this economic obligation was actually completed', a requester creates an obligation for an executor (human wallet or agent address), the executor completes it, both events are verifiable. It is not a marketplace, not a reputation system, and does not add identity infrastructure beyond the address."

> "Another application or autonomous agent can query without trusting a reporter... apply its own policy (e.g., require completionRateBps >= 8000 and verifiedSettlementVolume >= threshold and sourceChain == 1)"

### From `docs/PRODUCT_ARCHITECTURE.md`

> "`getAgentPassport` (lending, access control, agent-to-agent commerce)"

> "grows a deterministic limit, gated financing reads it), and autonomous agents"

### From `README.md`

> "An 'agent' here means an economic actor represented by an address. The live demo uses a fresh wallet as the executor; no autonomous AI logic runs on-chain or off-chain as part of TRU."

> "Autonomous commerce between agents reading each other's passports" listed under future applications.

### Summary

The repo describes three specific intended agent use cases beyond "agents are economic actors":

1. **Agent-to-agent commerce:** Other agents or protocols query an agent's passport and apply their own policy before delegating work or transacting.
2. **Access control:** Passport data used as a gate for protocol access.
3. **Lending/financing:** Passport data consumed by financing protocols.

The repo explicitly states what TRU is NOT: "not a marketplace, not a reputation system." It does not describe x402-style micropayments, autonomous treasury management, or agent permissioning beyond address-based identification.

---

## 6. Obligation-side security

### Protections present on obligation path

| Protection | Loan side | Obligation side | Where |
|---|---|---|---|
| **UC-only relay gate** (`onlyUniversalContract`) | Yes | Yes | `TRUCreditRegistry.sol:80-83` |
| **QueryId replay guard** (`processedQueries`) | Yes | Yes | `TRUUniversalContract.sol:462,488` |
| **Registry replay guard** (`processedRepayments` / `processedObligationCreations` / `processedObligationCompletions`) | Yes | Yes | `TRUCreditRegistry.sol:149,367,416` |
| **Emitter binding** (log.address_ must match configured source market) | Yes | Yes | `TRUUniversalContract.sol:395,433` |
| **Proof-before-decode** (`_verifyProof` called before `_decodeObligation*`) | Yes | Yes | `TRUUniversalContract.sol:463-467,489-493` |
| **Source success check** (`receiptStatus == 1`) | Yes | Yes | `TRUUniversalContract.sol:381,419` |
| **Duplicate accounting guard** (`countedLoans` / `obligationStatus[oid] == NONE`) | Yes | Yes | `TRUCreditRegistry.sol:153,369` |
| **Lifecycle guard** (status must be ACTIVE to complete) | Yes (ACTIVE→REPAID) | Yes (ACTIVE→COMPLETED) | `TRUCreditRegistry.sol:165,418` |
| **Executor mismatch guard** | N/A | Yes | `TRUCreditRegistry.sol:421` |
| **Self-obligation dedup** (requester==executor → single history entry) | N/A | Yes | `TRUCreditRegistry.sol:389-391,440-442` |
| **Failed source tx revert** (`receiptStatus == 0` reverts) | Yes | Yes | `TRUUniversalContract.sol:381,419` |

### What is loan-only (not on obligation side)

- **`countedLoans` per-loanId dedup:** Obligations use `obligationStatus[oid] == NONE` as the duplicate guard instead. Functionally equivalent.
- **Loan lifecycle (NONE→ACTIVE→REPAID):** Obligations have a different lifecycle (NONE→ACTIVE→COMPLETED/FAILED). These are structurally different, not a missing feature.
- **`outstandingObligations` counter:** This is the loan outstanding counter. Obligations track active count via `obligationStatus` lookups in `getAgentPassport`, not a separate counter.

**Confirmed:** The obligation side has equivalent security to the loan side. No protection is missing; the differences are structural (different lifecycle states, different event shapes), not security gaps.

---

## 7. Self-obligation handling

### Whitepaper claim

"A second self-obligation was also verified during validation to confirm that self-obligations are stored and counted once rather than double-counted."

### Test backing

`test_selfObligationNotDoubleCounted` (TRUCreditRegistry.t.sol:708-720):

```solidity
address self = makeAddr("self");
_recordObligationCreated(keccak256("ob-self"), 200, self, self, 8000, block.timestamp + 1000);
_recordObligationCompleted(keccak256("ob-self-complete"), 200, self, 8000);
assertEq(registry.getObligationEventCount(self), 2); // one Created + one Completed
AgentPassport memory p = registry.getAgentPassport(self);
assertEq(p.verifiedObligations, 1);
assertEq(p.completedObligations, 1);
assertEq(p.activeObligations, 0);
assertEq(p.verifiedSettlementVolume, 8000);
assertEq(p.completionRateBps, 10000);
```

### How dedup works in code

In `recordVerifiedObligationCreated` (line 388-391):
```solidity
subjectObligationHistory[executor].push(evt);
if (requester != executor) {
    subjectObligationHistory[requester].push(evt);
}
```

When `requester == executor`, the event is pushed only once (to executor's history). The same pattern applies in `recordVerifiedObligationCompleted` (line 438-442).

In `getAgentPassport`, all counters deduplicate by `obligationId` across the full history, so even if a subject appeared as both requester and executor in different obligations, each obligation is counted once.

### Live backing

The self-obligation for `0x2b37…` (create `0x5a2757…`, complete `0x9eb372…`) was verified live with Passport: `verified 1, completed 1, active 0, settlement 8000, rate 10000, history 2, chains [1]`.

**Confirmed:** The claim is accurate. Self-obligations are stored once (not double-pushed to the same address's history) and counted once in all passport metrics. This is backed by both a Forge test and a live on-chain run.
