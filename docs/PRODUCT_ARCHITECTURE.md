# TRU: Agent Economic History

**Date:** 2026-09-10
**Status:** Positioning document. Describes only what is implemented and
verified in the repository.

## 1. Product Definition

TRU makes an agent's economic history verifiable instead of trusted.

Autonomous agents act across chains: completing obligations, repaying loans,
performing work for counterparties. None of that activity becomes reusable,
verifiable history. The next agent or protocol that wants to work with them
has no way to check what they have actually done. It can only trust what the
agent claims.

TRU solves this by verifying cross-chain economic events through Attestcoin
and recording them on Creditcoin as reusable history. An agent's Passport
becomes something other protocols can verify directly, without trusting the
agent or any intermediary.

```
TRU
|
+-- Agent Passport (primary output)
|   +-- Verified obligations
|   +-- Completed obligations
|   +-- Settlement volume
|   +-- Completion rate
|   +-- Source chains
|
+-- Credit Profile (secondary output)
    +-- Verified loan repayments
    +-- Credit limit
    +-- Credit state
```

## 2. The Agent Passport

The Agent Passport is the primary output of TRU. It is a deterministic,
on-chain view derived entirely from verified economic events.

Fields (from `ITRUCreditRegistry.sol`):

- `subject`: the queried address
- `verifiedObligations`: distinct Created obligationIds in the subject's history
- `completedObligations`: distinct Completed obligationIds
- `failedObligations`: distinct Failed obligationIds (always 0 today; no verified failure path)
- `activeObligations`: distinct Created whose global status is still ACTIVE
- `verifiedSettlementVolume`: sum of Completed values where executor == subject
- `verifiedSourceChains`: distinct source chainKeys
- `obligationHistory`: full chronological event array (oldest-first)
- `completionRateBps`: completed * 10000 / verified (0 when verified == 0)

Every field is recomputed live from on-chain storage on every call. No AI,
no subjective scoring, no token ownership, no NFT metadata. An agent has a
Passport because it did verifiable work, not because someone assigned it a
score.

How another protocol consumes it: call `getAgentPassport(B)` (view, no gas
for reads), receive the nine fields, apply its own thresholds (e.g.
`completionRateBps >= 8000`, volume floor, chain allowlist), and decide
whether and how to transact. TRU supplies the evidence; the consumer decides.

What cannot currently be claimed: failures (no verified path), deadline
compliance (neither source nor registry enforces it), work quality, off-chain
honesty, or any reputation meaning beyond the counts.

## 3. Core Primitive

The smallest useful primitive: one verified source-chain event, proven by
Merkle proof against an attested block, decoded on-chain, and recorded as
reusable history.

```
Source-chain event
  -> Attestcoin attestation of the source block
  -> Merkle + continuity proof (proof builder)
  -> Creditcoin BlockProver verifyAndEmit
  -> TRUUniversalContract (replay guard -> verify -> decode -> emitter check -> forward)
  -> TRUCreditRegistry (UC-gated record + history append)
  -> verified economic history (queryable views)
```

All four entry points (`execute`, `executeLoanOrigination`,
`executeObligationCreated`, `executeObligationCompleted`) run the same
five-step sequence. Only the decode branch (event signature, topic layout,
emitter address) and the registry call differ. Loan repayment and agent
obligation completion are applications of the same verification primitive,
not two systems.

## 4. What TRU Does vs What Applications Do

| TRU (protocol) | Applications / agents |
| --- | --- |
| Proves a source event happened (verifyAndEmit + emitter + replay guards) | Read getAgentPassport / getCreditPassport / getObligationEvents |
| Records the verified fact as append-only history | Define eligibility (completion rate, volume, chain, credit tier) |
| Exposes deterministic derivations (counts, sums, rates) | Make transact/lend/gate decisions |
| Rejects fakes, tampers, replays, duplicates, wrong emitters | Bear the consequences of their own policy |

TRU never decides creditworthiness, trustworthiness, or work quality.

## 5. Agent Obligation Flow

The obligation flow, as implemented and verified live:

```
Agent/requester (any address)
  -> createObligation(executor, value, deadline) -> ObligationCreated
  -> completeObligation(id) by the executor -> ObligationCompleted
  -> attestation -> proof -> BlockProver -> TRUUniversalContract -> TRUCreditRegistry
  -> verified registry event -> Agent Passport updates
```

Source contracts (Sepolia):
- `SourceObligationMarket`: creates obligations, emits ObligationCreated / ObligationCompleted / ObligationFailed

Verification (Creditcoin CC3):
- `TRUUniversalContract`: verifies proof, checks emitter, forwards to registry
- `TRUCreditRegistry`: records verified events, updates Passport

The worker (`creditcoin/src/worker.mjs`) handles all four event types through
identical attest -> prove -> verifySingle sanity check -> submit steps. It
never decides what gets credited.

## 6. Credit History (Secondary Product)

Loan repayment history for human borrowers. Credit is TRU's first
application, not the boundary of the protocol.

- `SourceLoanMarket` (Sepolia): emits LoanCreated / LoanRepaid
- `TRUCreditRegistry`: records verified repayments, computes creditLimit = 0 + repayments * 100
- Credit state: NEW (0) -> BUILDING (1-2) -> ESTABLISHED (3-5) -> VERIFIED (6+)
- `TRUFinancing`: gates requestFinancing on creditState >= BUILDING and amount <= creditLimit

Credit history and Agent Passport share the same verification pipeline but
use separate storage and views (`test_loanAndObligationHistoriesAreIsolated`).

## 7. AI / Autonomous Agent Boundary

TRU does not need AI and contains none: no LLMs, no model calls, no learned
parameters, no subjective scoring anywhere in contracts, worker, or tests.

```
TRU -> provides cryptographically verified facts
  -> autonomous agent / AI consumes those facts
  -> agent makes its own decision
```

An AI agent is a consumer of TRU evidence, never a component of TRU
verification. The live demo executor (0x8FC1...) was a fresh wallet acting as
an autonomous executor address. The code treats every executor uniformly as
an address with a verifiable history.

## 8. Current Capabilities

Implemented, tested (92 Forge tests passing), and live on Sepolia + Creditcoin
CC3 testnet:

- Verified loan origination/repayment with credit tiers and financing gating
- Verified obligation creation/completion with lifecycle (NONE -> ACTIVE -> COMPLETED)
- Replay/duplicate/emitter/executor-mismatch guards
- Deterministic Agent Passport views
- Worker handling of all four event types
- Five-contract deployment with wiring

## 9. Claims Audit

### CLAIM NOW (implemented and tested)

- Agent economic history becomes verifiable on-chain via Agent Passport
- Cross-chain loan repayment becomes verified on-chain credit history
- One shared verification primitive serves both
- Replay, duplicate, tamper, wrong-event, and foreign-emitter attacks are rejected
- Agent Passport fields are deterministic derivations of verified events
- Worker cannot mint credit or fake history (UC-gated writes only)
- 92 Forge tests passing

### CLAIM CAREFULLY (enabled/demonstrated, word precisely)

- "Autonomous agents can build verifiable history" -- true in the sense that any address, including an agent-controlled wallet, accrues history as executor. Say "agent address," not "AI agent."
- "Completion rate / settlement volume" -- always with "derived from verified on-chain events" and the exact formula
- Cold-attestation latency (~7-9 min, predictable, not reducible)
- failedObligations exists as a field but is always 0

### DO NOT CLAIM

- Autonomous AI agents operating in the system (none exist in code)
- AI trust scores, reputation scores, or LLM judgment (none exist)
- Cross-chain identity (subjects are bare addresses; no identity layer)
- Decentralized reputation (TRU stores evidence, not reputation)
- Verified failure handling (no executeObligationFailed path)
- Deadline enforcement (neither source nor registry enforces it)
- Scalability beyond current volume (O(n^2) views)
- Production readiness (testnet only)

## 10. Product Narrative

An agent completes an obligation on Ethereum. That completion becomes
verifiable on Creditcoin: a Merkle proof that the exact transaction happened
in an attested block, checked on-chain, bound to its emitter, and guarded
against replay. The agent's Passport updates with a verified completion,
settlement volume, and completion rate. Another protocol reads the Passport,
applies its own policy, and decides whether to work with that agent. TRU
supplies the facts. The consumer decides what they mean.
