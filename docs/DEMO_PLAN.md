# TRU Demo Plan

**Format:** 2-minute screen recording. No frontend exists in the repository,
so the demo is a terminal plus block explorers. Everything shown is real
testnet state. Nothing is simulated.

## 1. Demo Objective

Answer one question in two minutes: "Can an economic actor prove it kept
its promise?" Show a real agent obligation — created and completed on
Sepolia, proven by Merkle proof, verified on Creditcoin — resolving into a
deterministic, queryable Agent Passport. A non-technical judge should follow
the story; a technical judge should see enough hashes, blocks, and guards
to recognize real infrastructure.

## 2. Primary Demo

**Agent obligation completion as the hero, human credit as supporting proof.**

The agent flow wins on every criterion: it is the differentiator (no other
demo shows cross-chain agent history), it is visually compact (one agent,
one obligation, one passport), and it is reliable (history already verified
on-chain; nothing time-sensitive happens during recording). The human loan
flow appears once, briefly, to prove the same primitive serves both.

## 3. Why This Demo

- **Clarity:** one promise, one completion, one passport. No protocol
  background needed to follow it.
- **Differentiation:** verified agent history is the claim no credit
  application can make.
- **Reliability:** all verification is already on-chain. The recording reads
  live state in seconds; no attestation wait, no pending transactions.
- **Honesty:** a fresh end-to-end verification takes ~7–9 minutes of cold
  attestation and cannot fit in two minutes. Presenting already-verified
  history — while saying so out loud — is the only honest shape.

## 4. Exact Timeline

- **0:00–0:15 — Problem.** Economic history is fragmented; claims are cheap.
- **0:15–0:30 — TRU concept.** Verify the event, don't trust the claim.
- **0:30–1:20 — Live obligation verification.** Terminal: run the demo
  script against the real agent; open the four real transactions in
  explorers.
- **1:20–1:40 — Verified history / Agent Passport.** Passport fields on
  screen; each traced to its verified event.
- **1:40–1:55 — Architecture.** One diagram: same primitive, two applications.
- **1:55–2:00 — Takeaway.** The closing line.

## 5. Exact Actions

1. **Terminal, repo root.** Run
   `node creditcoin/src/demo-obligation.mjs 0x4987510f276d0650cE8A86bA7bd7a4490cBcE812`.
   Viewer sees: source market address, Created event (obligation 2, value
   12000), Completed event, passport (`verified 1, completed 1, settlement
   12000, rate 10000`). Say: "This is live chain state, read seconds ago —
   not a mock." Proves: history exists on-chain and is queryable.
2. **Etherscan tab (Sepolia).** Open create tx
   `0x1d4bd42658192bf68d140bfe594ade49d6081ab0ef4bfa8509185fc7a0e3f742`
   (block `11667875`). Viewer sees `ObligationCreated` log from
   `0x133A8Fe8408066B95034Ed638f5C7083Be94d14F`. Say: "The promise, as the
   source contract logged it." Proves: the event is real and public.
3. **Same tab or second tab.** Open complete tx
   `0x25336758c379d1f1cc02c66c7d2036ee238cc678d9d9ae2df8dc42f0bab7c07b`
   (block `11667877`). Viewer sees `ObligationCompleted`. Say: "The kept
   promise, same contract, one block later in history." Proves: completion
   is a separate verified fact, not asserted by the agent.
4. **Blockscout tab (CC3 testnet).** Open verification txs
   `0x07c5fe9f62df5cb2774a3c9748500a9041293407b1b43ec460f1112ff4e28a32`
   (block `5457726`, `ObligationCreatedVerified`) and
   `0xadc7783d19d30e4c8c590228f61f78c4a6a692af76da870a42714279630c8c72`
   (block `5457729`, `ObligationCompletedVerified`). Say: "Creditcoin checked
   the Merkle proof for each event and recorded it — tamper with one byte
   and the precompile reverts." Proves: verification really happened
   on-chain.
5. **Back to terminal.** Scroll to the passport block. Say: "One verified,
   one completed, zero active, twelve thousand settled, one hundred percent
   — every number computed from those two events." Proves: the passport is
   derivation, not opinion.
6. **Architecture slide/diagram (static image).** Same primitive, two
   applications (human loan chain `0xc21ea7d1…` → `0xe0a48f58…` shown as one
   line). Say: "Loans use the identical path — credit is the first app, not
   the boundary." Proves: generality without extra claims.

Total on-screen actions: one command, four explorer pages, one diagram.

## 6. Spoken Script (235 words)

"Economic history is fragmented. What you repay or complete on one chain
means nothing on another, so everyone relies on claims: self-reports,
APIs, opaque scores.

TRU replaces the claim with a proof. When an economic event happens on
Sepolia, Creditcoin attests the block, a Merkle proof is built, and a
Creditcoin contract verifies that exact transaction happened — then records
the fact as history. Nothing is trusted except the cryptography and the
source contract's own rules.

Here is a real one. An agent was given an obligation worth twelve thousand.
This is the creation, logged by the source contract on Sepolia. And this is
its completion, one block later in history — not the agent saying it
finished, but the contract logging that it did.

Creditcoin then checked the Merkle proof behind each event. Both verifications
live on-chain, public and permanent, linked from the registry events. The
worker that carried the proofs decided nothing; the cryptography decided
everything. Tamper with a single byte and the whole thing reverts.

And this is what the agent now owns: a passport. One obligation verified,
one completed, zero active, twelve thousand settled. Every number computed
from those two verified events — no score, no judge, no AI deciding
anything.

The same path already verifies human loan repayments into credit history.
One primitive, two applications.

TRU doesn't trust what an economic actor says it did. It verifies what
actually happened."

## 7. Technical Evidence

Minimum on-screen evidence, in priority order:

1. Sepolia create tx `0x1d4bd426…` (block `11667875`, `ObligationCreated` log).
2. Sepolia complete tx `0x25336758…` (block `11667877`, `ObligationCompleted` log).
3. CC3 verify txs `0x07c5fe9f…` (block `5457726`) and `0xadc7783d…` (block `5457729`).
4. Live `getAgentPassport` output (`1/1/0/9000→12000…` — actual: `1, 1, 0, 12000, 10000`).
5. Referenced verbally, not shown: attestation waits (`494.3s` cold /
   `2.3s` warm), proof headers/txIndexes, replay-guard behavior.

All hashes verified present in `docs/VERIFIABLE_ECONOMIC_HISTORY.md` and
`README.md`; all addresses match `contracts/deployments/*`.

## 8. Fallback Plan

The primary demo needs no live transaction, so the main failure mode is a
stale RPC or explorer outage. Fallbacks, all honest:

- If the demo script cannot reach an RPC: show the exact terminal output
  already recorded in `docs/VERIFIABLE_ECONOMIC_HISTORY.md` §6, labeled
  on-screen as "previously recorded output from this command."
- If an explorer is down: show the four hashes as text and cite the
  registry reads (which need only the CC3 RPC), or vice versa.
- If a fresh-transaction idea comes up mid-demo: do not attempt one. Say
  out loud that fresh verification takes ~8 minutes of attestation and
  point to the already-verified chain. Never present a pending transaction
  as completed verification.
- Never fall back to invented hashes, mock output, or a rehearsed "live"
  verification. The fallback is older real evidence, labeled as such.

## 9. Recording Checklist

BEFORE RECORDING:

- [ ] CC3 + Sepolia RPCs responding (`demo-obligation.mjs` runs clean once).
- [ ] Agent `0x4987510f276d0650cE8A86bA7bd7a4490cBcE812` still shows
  `verified 1 / completed 1` (re-run script, confirm).
- [ ] Four explorer tabs pre-loaded: two Sepolia txs, two CC3 txs.
- [ ] Architecture diagram ready as a static image.
- [ ] Terminal font large; no env files, keys, or extra tabs visible.
- [ ] Fallback: VERIFIABLE_ECONOMIC_HISTORY.md §6 open in reserve.

DURING RECORDING:

- [ ] No unexplained waiting or navigation; every click narrated in one line.
- [ ] Say "already verified" when showing history; never imply live mining.
- [ ] Show all four tx hashes and the passport block on screen.
- [ ] Keep under 2:00 (script is 244 words, ~1:55 at natural pace).

AFTER RECORDING:

- [ ] Verify duration ≤ 2:00.
- [ ] Verify every hash/number matches the docs.
- [ ] Verify explorer links resolve.
- [ ] Verify no private keys, seed phrases, or `.env` contents appear in any frame.

## 10. Final Judge Takeaway

TRU verifies economic events across chains. Verified events become reusable
economic history. The same primitive works for human credit and
autonomous-agent obligations. Don't trust what an economic actor says it
did. Verify what actually happened.
