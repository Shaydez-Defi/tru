# TRU Product Architecture

**Date:** 2026-09-10
**Status:** Positioning document. Describes only what is implemented and
verified in the repository. No new features, no code changes, no UI changes.

## 1. Product Definition

TRU, Verifiable Economic History for Humans and Autonomous Agents.

Core statement: TRU turns cross-chain economic events into cryptographically
verified, reusable records.

The fundamental distinction: TRU does not claim to determine whether an actor
is trustworthy. TRU verifies that an underlying economic event actually
happened. Applications and agents then interpret those verified facts
according to their own policies.

```
TRU
│
└── Verifiable Economic History
    │
    ├── Human Economic History
    │   └── Loan repayment
    │
    └── Agent Economic History
        └── Obligation completion
```

## 2. Core Primitive

The smallest useful primitive TRU provides is: **one verified source-chain
event, proven by Merkle proof against an attested block, decoded on-chain,
and recorded as reusable history.**

The pipeline is identical for every event type:

```
Source-chain event
→ Attestcoin attestation of the source block
→ Merkle + continuity proof (proof builder)
→ Creditcoin BlockProver verifyAndEmit
→ TRUUniversalContract (replay guard → verify → decode → emitter check → forward)
→ TRUCreditRegistry (UC-gated record + history append)
→ verified economic history (queryable views)
```

Evidence from `TRUUniversalContract.sol`: all four entry points (`execute`,
`executeLoanOrigination`, `executeObligationCreated`,
`executeObligationCompleted`) run the same five-step sequence, `calculateTxIndex` → shared `_computeQueryId` → shared `processedQueries`
replay guard → shared `_verifyProof` → per-type decode branch → per-type
`*Verified` event → per-type UC-gated registry call. Only the decode branch
(event signature, topic layout, emitter address) and the registry call differ.

Loan repayment and agent obligation completion are therefore applications of
the same underlying verification primitive, not two systems. The conclusion
is not forced: it follows from the code, where verification, replay
protection, and forwarding are shared and only event interpretation branches.

## 3. Verifiable Economic History

The shared output layer. For each verified event the registry appends an
event record (`VerifiedFinancialEvent` for loans, `VerifiedObligationEvent`
for obligations) containing the queryId-derived event ID, source chain,
source block, involved addresses, economic value, and verification timestamp.
Histories are append-only, per-subject, and isolated from each other
(`test_loanAndObligationHistoriesAreIsolated`). Every stored record traces to
a `verifyAndEmit` success; rejected proofs never write state.

## 4. Human Economic History

Loan repayment history for human borrowers, implemented first (phases 6–10,
predating the obligation extension):

1. What it does: records verified loan originations and repayments per borrower.
2. Implemented by: `SourceLoanMarket` (Sepolia) → `TRUUniversalContract`
   (`execute` / `executeLoanOrigination`) → `TRUCreditRegistry`
   (`recordVerifiedRepayment` / `recordVerifiedLoanOrigination`).
3. What is verified: that `SourceLoanMarket` emitted `LoanCreated` /
   `LoanRepaid` with the exact loanId, borrower, and principal/amount in an
   attested Sepolia block.
4. Reusable data: `profiles` (`repayments`, `totalRepaid`, `creditLimit =
   0 + repayments*100`), `getCreditEvidence`, `getCreditPassport`
   (evidence + loan history + outstanding obligations + source chains).
5. Consumers: `TRUFinancing.requestFinancing` (gates on `creditState >=
   BUILDING` and `amount <= creditLimit`); any reader of the public views.
6. What TRU does not do: decide creditworthiness, set risk policy, disburse
   funds, or judge the borrower.

Credit is TRU's first application, not the boundary of the protocol. The
implementation supports this framing: the credit formula and `TRUFinancing`
are downstream consumers of the same verified-event history, and the
obligation extension reused the pipeline without changing any loan code path.

## 5. Agent Economic History

Obligation completion history for executors, where the executor may be an
autonomous agent:

1. What it does: records verified obligation creations and completions per subject.
2. Implemented by: `SourceObligationMarket` (Sepolia) → `TRUUniversalContract`
   (`executeObligationCreated` / `executeObligationCompleted`) →
   `TRUCreditRegistry` (`recordVerifiedObligationCreated` /
   `recordVerifiedObligationCompleted`).
3. What is verified: that `SourceObligationMarket` emitted
   `ObligationCreated` / `ObligationCompleted` with the exact obligationId,
   requester, executor, and value/deadline in an attested Sepolia block.
4. Reusable data: `getAgentPassport`, `getObligationEvents`
   (most-recent-first pages), `getObligationStatus`.
5. Consumers: any application or autonomous agent applying its own policy to
   the evidence (e.g. requiring a completion rate or settlement volume).
6. What TRU does not do: operate an agent, judge work quality, or assign trust.

Actual agent flow, as executed live:

```
Agent/requester (any address)
→ createObligation(executor, value, deadline) → ObligationCreated
→ completeObligation(id) by the executor → ObligationCompleted
→ attestation → proof → BlockProver → TRUUniversalContract → TRUCreditRegistry
→ verified registry event → agent economic history
```

## 6. Agent Passport

The Agent Passport is a deterministic, queryable view over verified
obligation history. It is not an NFT, not a token, not a profile picture, and
not a subjective trust score. It is the struct `AgentPassport` returned by
`TRUCreditRegistry.getAgentPassport`, recomputed live from storage on every
call.

Fields that currently exist (`ITRUCreditRegistry.sol`):

- `subject`: the queried address.
- `verifiedObligations`: distinct `Created` obligationIds in the subject's history.
- `completedObligations`: distinct `Completed` obligationIds.
- `failedObligations`: distinct `Failed` obligationIds, always `0` today;
  no verified failure path exists (see §12).
- `activeObligations`: distinct `Created` whose global status is still `ACTIVE`.
- `verifiedSettlementVolume`: sum of `Completed` values where
  `executor == subject` (a pure requester accrues history but zero volume).
- `verifiedSourceChains`: the subject's distinct source chainKeys.
- `obligationHistory`: copy of the subject's `VerifiedObligationEvent` array
  (chronological, oldest-first; contrast `getObligationEvents` paging, which
  is most-recent-first).
- `completionRateBps`: `completed * 10000 / verified`, `0` when `verified == 0`.

Contributing events: `ObligationCreated` (counts toward verified/active) and
`ObligationCompleted` (counts toward completed/volume/rate), both pushed to
requester and executor histories (single push when they coincide). Deduplication
loops prevent double counting. All derivations are documented in
`docs/ENGINE_AUDIT.md` §4.

What cannot currently be claimed: failures (no verified path), deadline
compliance (neither source completion nor registry enforces the deadline),
work quality, off-chain honesty, or any reputation meaning beyond the counts.

How another protocol could consume it: call `getAgentPassport(B)` (view, no
gas for reads), receive the nine fields above, apply its own thresholds
(e.g. `completionRateBps >= 8000`, volume floor, chain allowlist), and decide
whether and how to transact. TRU supplies the evidence; the consumer decides.

## 7. Verification Pipeline

Covered in §2. Additions specific to obligations: the worker
(`creditcoin/src/worker.mjs`) handles all four event types through identical
attest → prove → `verifySingle` sanity check → submit steps and never decides
what gets credited; `deploy-production.mjs` deploys five contracts and wires
`sourceObligationMarket` alongside `sourceLoanMarket`. Live obligation chain
(README §6): create `0x9591e621…` block `11663848` → `0xe7961a54…` block
`5454388`; complete `0x3aa9af68…` block `11663849` → `0xc19bc7df…` block
`5454391`; passport `verified 1, completed 1, active 0, settlement 9000,
rate 10000`.

## 8. What TRU Does vs What Applications Do

| TRU (protocol) | Applications / agents |
| --- | --- |
| Proves a source event happened (`verifyAndEmit` + emitter + replay guards) | Read `getAgentPassport` / `getCreditPassport` / `getObligationEvents` |
| Records the verified fact as append-only history | Define eligibility (completion rate, volume, chain, credit tier) |
| Exposes deterministic derivations (counts, sums, `*10000/verified`) | Make transact/lend/gate decisions |
| Rejects fakes, tampers, replays, duplicates, wrong emitters | Bear the consequences of their own policy |

TRU never decides creditworthiness, trustworthiness, or work quality.

## 9. AI / Autonomous Agent Boundary

TRU does not need AI and contains none: no LLMs, no model calls, no learned
parameters, no subjective scoring anywhere in contracts, worker, or tests.
The correct architecture, as implemented:

```
TRU → provides cryptographically verified facts
→ autonomous agent / AI consumes those facts
→ agent makes its own decision
```

An AI agent is a *consumer* of TRU evidence, never a component of TRU
verification. The live demo executor (`0x8FC1…`) was a fresh wallet acting as
an autonomous executor address, the code treats every executor uniformly as
an address with a verifiable history. No other agent capability is claimed.

## 10. Current Capabilities

Implemented, tested (81 Forge tests passing), and live on Sepolia + Creditcoin
CC3 testnet: verified loan origination/repayment with credit tiers and
financing gating; verified obligation creation/completion with lifecycle
(`NONE → ACTIVE → COMPLETED`), replay/duplicate/emitter/executor-mismatch
guards, and deterministic Agent Passport views; worker handling of all four
event types; five-contract deployment with wiring.

## 11. Future Applications

Enabled by the primitive but not implemented: verified failure lifecycle
(`ObligationFailed` event exists on source, no verified path yet), unified
loan+obligation timeline view, additional source chains (Attestcoin already
supports Ethereum mainnet; worker queries `getSupportedChains`), mainnet
deployment, Agent Passport frontend views, and any consumer policy built on
`getAgentPassport` (lending, access control, agent-to-agent commerce).
Each would reuse the same five-step primitive without new trust assumptions.

## 12. Claims Audit

### A. CLAIM NOW (implemented and tested)

- Cross-chain loan repayment becomes verified on-chain credit history.
- Cross-chain obligation creation/completion becomes verified on-chain
  economic history.
- One shared verification primitive serves both (same precompile, replay
  guard, emitter checks; evidence: identical structure of the four execute
  functions, `docs/ENGINE_AUDIT.md` §1).
- Replay, duplicate, tamper, wrong-event, and foreign-emitter attacks are
  rejected (unit + live evidence, `docs/SECURITY_AUDIT.md`).
- Agent Passport fields are deterministic derivations of verified events.
- Worker cannot mint credit or fake history (UC-gated writes only).
- 81 Forge tests passing; loan flow intact through every extension.

### B. CLAIM CAREFULLY (enabled/demonstrated, word precisely)

- "Autonomous agents can build verifiable history", true in the sense that
  any address, including an agent-controlled wallet, accrues history as
  executor; the live executor was a wallet representing an agent, not an
  autonomous AI operating on-chain. Say "agent address," not "AI agent."
- "Completion rate / settlement volume", always with "derived from verified
  on-chain events" and the exact formula.
- Cold-attestation latency (~7–9 min, predictable, not reducible), state the
  numbers with the mechanism.
- `failedObligations` exists as a field but is always `0`, never present it
  as measured data.

### C. DO NOT CLAIM

- Autonomous AI agents operating in the system (none exist in code).
- AI trust scores, reputation scores, or LLM judgment (none exist).
- Cross-chain identity (subjects are bare addresses; no identity layer).
- Decentralized reputation (TRU stores evidence, not reputation).
- Verified failure handling (no `executeObligationFailed` path).
- Deadline enforcement (neither source completion nor registry enforces it).
- Multiple market namespaces (one market per type assumed; IDs are global).
- Scalability beyond current volume (`O(n²)` views noted in audits).
- Production readiness (testnet only; operator key currently equals owner key).

## 13. Product Narrative

Economic history is fragmented: what you repay or complete on one chain means
nothing on another, and every existing score asks you to trust its reporter.
TRU verifies the underlying cross-chain economic event instead, a Merkle
proof that the exact transaction happened in an attested block, checked
on-chain, bound to its emitter, and guarded against replay. Verified events
become reusable economic history: humans use it for credit (repayment history
grows a deterministic limit, gated financing reads it), and autonomous agents
use it for economic obligations (completion history forms a deterministic
passport any protocol can query). TRU supplies verified facts; applications
decide what those facts mean.
