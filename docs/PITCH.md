# TRU: Pitch Deck

**Hackathon:** CTC BUIDL 2026 Fall
**Status:** Live on Sepolia + Creditcoin CC3 testnet. 92 Forge tests passing.
**Thesis:** TRU makes an agent's economic history verifiable instead of trusted.

---

## Slide 1: Can an agent prove what it has done?

An autonomous agent completes an obligation on Ethereum. A protocol on
another chain wants to work with that agent. It asks: **what has this agent
actually done?**

Today the answer is: trust what the agent claims, or trust a third-party API
that says "this agent is reliable."

Neither option is proof.

---

## Slide 2: The Problem

Economic history is fragmented across chains and requires trust.

| Actor | What exists | What's missing |
| --- | --- | --- |
| Autonomous agent | Completed obligations on one chain | Portable proof for other protocols |
| Human borrower | Repayment history on another chain | Reusable credit history elsewhere |
| Another protocol | The actor arrives with activity | Independent verification of that activity |

The history is real. What's missing is **portable, verified proof**.

---

## Slide 3: Agent Passport

The Agent Passport is a **deterministic, on-chain record** derived entirely
from verified economic events.

| Field | Meaning |
| --- | --- |
| `verifiedObligations` | Distinct obligations created for this agent |
| `completedObligations` | Distinct obligations this agent completed |
| `failedObligations` | Distinct obligations that failed (currently 0) |
| `activeObligations` | Obligations still in progress |
| `verifiedSettlementVolume` | Total value settled across completions |
| `verifiedSourceChains` | Distinct chains with verified activity |
| `completionRateBps` | Completion rate in basis points (10000 = 100%) |
| `obligationHistory` | Full chronological event history |

**What it is not:**
- Not an AI-generated reputation score
- Not subjective scoring
- Not self-reported history

Every field is recomputed live from on-chain records. An agent has a Passport
because it did verifiable work, not because someone assigned it a score.

---

## Slide 4: Before vs After

### Before

```
Agent claims: "I completed 5 obligations"
  -> protocol must trust the claim
  -> or trust a third-party API
  -> no cryptographic proof
  -> history trapped on one chain
```

### After (TRU)

```
Agent performs economic obligation on Ethereum
  -> Attestcoin provides cryptographic proof
  -> TRU verifies proof + emitter + replay
  -> Creditcoin records verified fact
  -> Agent Passport updates deterministically
  -> any protocol reads Passport, applies own policy
```

---

## Slide 5: How TRU Works

```
ACT:    Economic event on source chain (Ethereum Sepolia)
PROVE:  Attestcoin cryptographic evidence (Merkle + continuity proof)
VERIFY: TRU checks proof, emitter, replay protection
RECORD: Creditcoin stores verified fact
REUSE:  Agent Passport or Credit Profile, queryable by any protocol
```

The same pipeline handles obligations and loans. Obligations generalize the
primitive to any economic actor.

---

## Slide 6: Attestcoin + Creditcoin Integration

**Attestcoin** (Creditcoin Universal Smart Contracts) provides the
cross-chain proof layer:

1. Source chain emits an event (e.g. `ObligationCompleted`)
2. Creditcoin attests the source block (~35-block standing lag)
3. Proof builder returns Merkle + continuity proof
4. `TRUUniversalContract` calls BlockProver precompile (`verifyAndEmit`)
5. Contract checks emitter matches configured source market
6. Verified fact forwarded to `TRUCreditRegistry`

**Creditcoin** provides the recording layer:

- `TRUCreditRegistry` stores verified events append-only
- Agent Passport computed deterministically from stored events
- All record functions gated by `TRUUniversalContract` (no direct writes)

---

## Slide 7: Live Proof

Agent `0x8FC1...66FB1` on Sepolia + Creditcoin CC3:

| Step | Source tx (Sepolia) | Proof tx (CC3) |
| --- | --- | --- |
| Creates obligation | `0x9591...7617` block 11663848 | `0xe796...d5a1` block 5454388 |
| Completes obligation | `0x3aa9...a40c` block 11663849 | `0xc19b...26b8` block 5454391 |

**Result:** Agent Passport: 1 verified, 1 completed, 0 active, 9000
settlement volume, 10000 bps completion rate, 1 source chain.

Self-obligation for `0x2b37...` also verified live (create `0x5a27...`,
complete `0x9eb3...`), showing the primitive works for any address.

---

## Slide 8: What This Enables

These are future applications of verified history, not current capabilities:

- **Underwriting:** Lenders read Agent Passport and apply their own risk
  policy. TRU supplies verified evidence, not a credit decision.
- **Delegated execution:** Protocols require a minimum completion rate or
  settlement volume before delegating work.
- **Merchant risk:** Read verified event history instead of self-reported
  reputation.
- **Autonomous finance:** Agents read each other's Passports and apply
  their own thresholds.

**Currently implemented:** Agent Passport, verified obligation lifecycle,
loan repayment verification, worker relay for all four event types.

---

## Slide 9: Technical / Security

**Verification guarantees:**
- Proof verification: state changes only after `verifyAndEmit` success
- Emitter validation: each decoder checks log emitter matches source market
- Replay protection: `processedQueries[keccak(chainKey, blockHeight, txIndex)]`
- Duplicate protection: `obligationStatus`, `countedLoans`, `loanStatus`
- Source-chain validation: `chainKey` and `blockHeight` bind proof to one chain/block
- Registry authorization: all record functions are `onlyUniversalContract`
- Executor mismatch guard: completion verifies `msg.sender` matches recorded executor
- Self-obligation dedup: `requester ==executor` pushes event only once

**Testing:** 92 Forge tests across 8 suites, 0 failures.

**Contracts:** 5 deployed (2 source on Sepolia, 3 verification on CC3).

**Limitations:** Testnet only. No verified failure path yet. O(n^2) passport
views. Cold attestation ~7-9 minutes. Owner key fully trusted.

---

## Slide 10: Summary

```
TRU = verification infrastructure
  -> verified economic events
  -> reusable economic history
  -> applications (credit, agents, future consumers)
```

TRU never decides creditworthiness, trustworthiness, or work quality.
It supplies cryptographically verified facts. The consumer decides.

**Live:** https://tru-ctc.vercel.app
**Repo:** https://github.com/Shaydez-Defi/tru
