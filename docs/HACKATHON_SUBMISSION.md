# TRU: Hackathon Submission Package

Copy and positioning for submission. Every claim below is sourced from the
implemented, tested system. Nothing here invents functionality.

## 1. Project Title

Options:

1. **TRU, Verifiable Economic History for Humans & Autonomous Agents**
2. **TRU, Verifiable Economic History**
3. **TRU, Don't Trust the History. Verify the Event.**

**Recommended: option 1.** It states the full scope (both applications) in a
single line and separates TRU from every credit-only submission.

## 2. Tagline

**Don't trust what an economic actor says it did. Verify what actually happened.**

## 3. 1-Sentence Description

TRU turns cross-chain economic events into cryptographically verified,
reusable on-chain records, loan repayments for humans, obligation
completions for autonomous agents, through one shared proof architecture.

## 4. Short Description (68 words)

TRU is verifiable economic history infrastructure on Creditcoin. A loan
repayment or agent obligation on Ethereum Sepolia is proven by Merkle proof
against an attested block, verified on-chain by the BlockProver precompile,
and recorded as reusable history, no oracle, no reporter to trust. Humans
accrue verified credit history; autonomous agents accrue a deterministic
Agent Passport. 81 Forge tests passing, live on Sepolia + Creditcoin CC3
testnet.

## 5. Full Description (214 words)

**Problem.** Economic activity happens across chains, but its history does
not travel. A borrower who repays on Ethereum starts at zero on Creditcoin;
an agent that completes work has no portable proof it did so. Systems that
fill the gap depend on self-reports, centralized APIs, or opaque scores.

**Solution.** TRU verifies the underlying event instead of trusting a claim
about it: a Creditcoin contract checks a Merkle proof that the exact source
transaction occurred in an attested block, then records the decoded fact as
history.

**Technical mechanism.** Source market emits event → Attestcoin attests the
block → proof builder returns Merkle + continuity proof → BlockProver
`verifyAndEmit` → `TRUUniversalContract` (replay guard, decode, emitter
check) → `TRUCreditRegistry` (UC-gated append). One primitive serves all
four event types.

**Human application.** Verified repayments grow a deterministic credit limit
(`0 + repayments×100`) with tiers (`NEW` → `VERIFIED`); gated financing
reads it without disbursing.

**Agent application.** Verified obligation completions form a deterministic
Agent Passport (`verified/completed/active` counts, settlement volume,
completion rate) that any protocol can query and interpret under its own
policy.

**Why it matters.** Any system that needs to know what an actor actually did
, lending, underwriting, delegation, agent commerce, can consume TRU
evidence instead of trusting a reporter. TRU supplies verified facts;
applications decide what they mean.

## 6. The Problem

When value moves across chains, proof of good behavior does not move with
it. A reliable borrower arrives on a new chain with no history. An agent
that fulfilled an obligation elsewhere cannot prove it here. So applications
fall back on three substitutes, all weak: asking the actor (forgeable),
asking a centralized API (single point of trust and failure), or buying an
opaque score (inputs unverifiable, methodology hidden). The missing piece is
not another score, it is a way to prove the underlying event happened.

## 7. The Solution

TRU verifies economic events across chains and records them as reusable
history. Not a credit score. Not a reputation score. A verification layer:
given a source transaction, TRU proves on Creditcoin that it occurred, binds
it to its emitter and chain, guards it against replay, and stores the decoded
fact where any contract or agent can read it. Credit for humans and
passports for agents are both downstream readings of that history.

## 8. How It Works

```
Source-chain event (Sepolia: LoanCreated / LoanRepaid / ObligationCreated / ObligationCompleted)
→ Attestcoin (Creditcoin attests the source block; ~35-block lag, ~7–9 min cold, predictable)
→ Cryptographic proof (Merkle + continuity proof from the proof builder; worker sanity-checks via verifySingle)
→ Creditcoin BlockProver (native precompile verifyAndEmit; reverts on any tampered byte)
→ TRUUniversalContract (txIndex → queryId replay guard → verify → decode from verified receipt → emitter check → forward)
→ TRUCreditRegistry (UC-gated record; replay + duplicate + lifecycle guards; history append)
→ Verified economic history (getCreditPassport / getAgentPassport / paginated event views)
```

### Relayer model (who runs the worker)

The worker is unprivileged infrastructure, not a trusted party. All four
`execute*` entry points on `TRUUniversalContract` carry no access control, only proof-validity and `queryId` replay checks, so anyone holding CC3
testnet tokens can construct and submit a valid proof; duplicate submissions
revert harmlessly on `Query already processed`. A malicious or faulty relayer
cannot invent, alter, or duplicate history: verification lives in the native
precompile, not in the delivery path. The current demo runs a single
operator relay for convenience; the roadmap is in-app submission from the
user's own wallet, which requires no contract changes.

## 9. Why Agents

An agent claims it completed an economic obligation. Today a counterparty
must trust the claim, trust the agent's operator, or trust a middleman's
report. With TRU, the counterparty instead reads the agent's verified
history: was an `ObligationCompleted` event for this agent proven against an
attested block and recorded on-chain? The completion becomes checkable
evidence rather than a claim. This is infrastructure an agent economy can
build on, not an AI agent itself. TRU contains no models, no autonomy, no
judgment; it is the layer agents query before they decide whom to trust.

## 10. Human + Agent Model

```
Human → loan repayment → verified economic history (credit profile, limit, tiers)
Agent → obligation completion → verified economic history (passport, completion rate, volume)
```

Same primitive. Different application. One proof path, one replay guard
design, one registry trust boundary, with per-type decode branches and
isolated history stores. The obligation extension reused the loan pipeline
without changing any loan code path.

## 11. Technical Innovation

- **Cross-chain event verification without oracles:** the consuming contract
  itself checks inclusion proofs; no reporter sits in the trust path.
- **Cryptographic proof verification on-chain:** native precompile, reverting
  on any altered byte (demonstrated live by tamper tests).
- **Reusable verified history:** append-only, per-subject, queryable event
  logs rather than one-shot attestations.
- **Generalized event handling:** four event types through one five-step
  primitive, each independently readable and live-proven.
- **Registry-based history:** all writes UC-gated; all reads are pure views.
- **Replay protection:** global `queryId` guard plus per-domain replay maps,
  proven live (`Query already processed`).
- **Emitter validation:** per-market source binding with fail-closed unset
  state for obligations.
- **Deterministic Agent Passport metrics:** counts, sums, and
  `completed*10000/verified` recomputed live from storage, explainable to
  the event.

## 12. Why This Is Different

A credit or reputation application tells you what someone is considered to
be: a score, a tier, a badge, computed by its own opaque rules from inputs
you cannot audit. TRU verifies what an economic actor actually did: a
specific transaction, in a specific attested block, from a specific contract,
guarded against replay and forgery. A score asks for trust in the scorer; a
verified event asks only that you check the proof. Applications, including
scoring systems, can then be built on evidence instead of assertion. (No
competitor claims are made; the repository contains no comparative research.)

## 13. Current Demo

**Can an agent prove it kept its promise?** Yes, live on testnet:

- Requester `0x2b37…` creates obligation `1` for agent `0x8FC1…`
  (value 9000): Sepolia tx
  `0x9591e6219585e73fc1c3e10421e5a818347b50254d6e9cf99e2cdfdd71677617`
  block `11663848` → verified on CC3 tx
  `0xe7961a54e83e2b57a47fd02189fd37ae503f50421798c53cadc2751f208dd5a1`
  block `5454388` → `ACTIVE`.
- Agent completes it: Sepolia tx
  `0x3aa9af68306d2e646d491b48de3878ebc5d093f05414e88dac7e949bf491a40c`
  block `11663849` → verified on CC3 tx
  `0xc19bc7df91805a135d5b4a3a1191c53488cc76ee6f3050b3f56f7bb35d0226b8`
  block `5454391` → `COMPLETED`.
- Result: `getAgentPassport` returns verified 1, completed 1, active 0,
  settlement 9000, rate 10000, every field traceable to the two verified
  events above.
- The same path also verified a self-obligation end to end, and the loan
  path is independently live (repayment `0xc21ea7d1…` → `0xe0a48f58…`,
  `repayments 1, creditLimit 100, BUILDING`).

Reproducible via `npm run demo:obligation -- <agentAddress>`.

## 14. AI Positioning

TRU does not need an LLM inside the protocol, and there is none. Scoring,
judgment, and autonomy would all reintroduce exactly the trusted reporter
TRU removes. The architecture is instead:

```
TRU → verified facts
↓
AI/autonomous agent → decision
```

An AI agent deciding whether to transact, delegate, or extend credit can
consume facts TRU has verified, completion counts, settlement volume,
credit tiers, and apply its own policy. TRU itself remains deterministic
verification infrastructure: same inputs, same outputs, every value
explainable to a verified event.

## 15. Future Applications

Clearly future, not implemented: autonomous agent commerce, cross-chain
underwriting, delegation gated on verified track records, lending beyond the
current demo market, machine-to-machine payments, and reputation systems
built on TRU evidence rather than self-reports. Also planned: verified
failure lifecycle, unified loan+obligation timeline, more source chains,
mainnet, and frontend views. Each reuses the same primitive without new
trust assumptions.

## 16. Hackathon Fit

TRU is built directly on Creditcoin/Attestcoin infrastructure: attestation,
the proof builder, the BlockProver precompile, and CC3 testnet execution.
It demonstrates cross-chain verification doing real work (not a toy
integration), produces reusable economic history both chains can build on,
and lays programmable financial infrastructure, deterministic credit state
plus agent-native history, that the Creditcoin ecosystem can compose into
lending, underwriting, and agent commerce. No judging criteria are presumed;
the fit is technical: TRU exercises the Attestcoin stack end to end.

## 17. Links

- Repository: https://github.com/Shaydez-Defi/tru
- Technical docs: `docs/` in the repository (`README.md` entry point,
  `docs/PRODUCT_ARCHITECTURE.md`, `docs/ENGINE_AUDIT.md`,
  `docs/SECURITY_AUDIT.md`, `docs/VERIFIABLE_ECONOMIC_HISTORY.md`).
- Live contracts (CC3 testnet, chain `102031`): registry
  `0x0D2707D258A87b971fd4cd78232304a672CA43c0`, universal contract
  `0xa33fd898502de87aA52C5992483b74f471613Ef0`, financing
  `0xd971aeaAc0D7216c41CccEdc5F4d6EF539Cad0bB`, viewable at
  `https://creditcoin-testnet.blockscout.com/` (base URL confirmed in
  `docs/usc-research.md`; full per-tx links follow the standard
  `/tx/<hash>` pattern).
- Source markets (Sepolia, chain `11155111`): `0x9953AC50803f85EaA666B7724a7B165504B9c2e1`,
  `0x133A8Fe8408066B95034Ed638f5C7083Be94d14F`.
- Live frontend: https://tru-ctc.vercel.app (no wallet needed to browse
  verified history; connecting a wallet shows live state for that address).
- Demo video: [TODO, to be recorded].

## 18. Judge Takeaway

1. TRU verifies economic events across chains.
2. Verified events become reusable economic history.
3. The same primitive works for human credit and autonomous-agent obligations.

Don't trust what an economic actor says it did. Verify what actually happened.
