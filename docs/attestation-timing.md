# Attestation Timing — Diagnostic

Diagnostic task (not a build step) to inform frontend/demo design. Three full
end-to-end runs through the real wired pipeline (SourceLoanMarket on Sepolia →
worker → TRUUniversalContract → TRUCreditRegistry) using the currently deployed
contracts. **No contracts were modified.**

Contracts used:

- SourceLoanMarket (Sepolia): `0x3e1FF41C2fBb3f6D8Cb787A7f4EF9891ABaBfe84`
- TRUUniversalContract (CC3): `0x80eCf7F95F3ECbBDdA29C2260342D9B77124BF0a`
- TRUCreditRegistry (CC3): `0x52B7eAd2769B3449Fa213B9fb40f94B4f17915bA`

## Summary table

| | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- |
| Repay tx | `0x10dc1550…` | `0x51556a87…` | `0x77025195…` |
| Sepolia block | 11503274 | 11503321 | 11503369 |
| Time: repay → attestation available | **499.9 s** | **549.0 s** | **450.9 s** |
| Time: attestation → proof ready | 0.2 s (cached) | 0.1 s (cached) | 0.2 s (cached) |
| Time: proof ready → submit mined on CC3 | 12.9 s | 17.0 s | 12.9 s |
| **Total end-to-end** | **513.1 s** | **566.4 s** | **464.3 s** |
| Registry after run | repayments=2, limit=200 | repayments=3, limit=300 | repayments=4, limit=400 |

All three runs verified end-to-end: `verifySingle` true, `status=1`, registry
updated by exactly one per run (creditLimit 100→200→300→400 across the three).

## Why cold attestation is ~8 minutes (not ~10 s)

The worker polls the proof-builder's attestation cache
(`/api/v1/attested-height/{chainKey}`). The trajectory captured during each wait
shows exactly what governs the delay:

1. **The proof-builder cache mirrors the on-chain attested height exactly.** In
   every sample, `pb cache` == `on-chain attested height`. There is no ingestion
   lag or cache-build cost to speak of — the service simply reports the height
   the Creditcoin chain has actually attested.

2. **Attestation lags the Sepolia head by a roughly constant depth.** At each
   run's start the attested height was 39–44 blocks behind the target (which was
   the head at repayment time). As the head advanced during the wait, attestation
   trailed it by ~34–35 blocks the whole way (end-of-run depth: 35, 34, 35). So
   the attestation system is not "eventually catching up" — it tracks the head
   with a **~35-block standing lag**.

3. **Attestation advances in 10-block batches.** The trajectory jumps exactly
   +10 blocks every ~120–140 s (e.g. run 3: 11503330 → …40 at ~74 s → …50 at
   ~193 s → …60 at ~328 s → …70 at ~451 s). That cadence matches Sepolia's ~12 s
   block time × 10 — the attestation is produced in lock-step with the source
   chain, not in big bursts.

So the wait is: `(standing lag ≈ 35–44 blocks) × (~12 s/block) ≈ 7–9 minutes`.
A freshly-mined repayment at the head must wait for attestation to climb from
~35 blocks behind up to the repayment's own block — and because attestation
only advances at the head's own rate, this gap never shrinks faster than
wall-clock.

### Why phase-0 looked fast (~10 s)
In phase 0 the processed tx was already **old** (mined well before processing),
so its block was already below the attested height at the moment the worker
started — attestation was immediately available. Same reason run 2 of phase-4
was ~2 s. It is not that attestation is sometimes fast; it is that
**already-attested** blocks are instant. A repayment processed *promptly after
mining* always hits the ~8-minute cold wait (phase-4: 340.5 s, phase-6: 463.4 s,
this diagnostic: 451–549 s).

## Can attestation time be known in advance / reduced?

- **Predictable: yes.** The attested height is readable in advance from the
  proof-builder API (`/api/v1/attested-height/1`) or the on-chain chain-info
  precompile (`get_latest_attestation_height_and_hash`). Given the target block,
  the remaining wait is approximately `(targetHeight − attestedHeight) × 12 s`,
  with the attested height advancing in ~10-block batches. A frontend can show
  a live, accurate "verification pending, ~N minutes" from the attested-height
  gap at any moment.
- **Tunable: no.** The ~35-block standing lag is structural — it is the
  Creditcoin network's block-height attestation policy (how deep behind the
  source head the network attests), not our worker's polling interval (10 s) and
  not Sepolia congestion. The worker can poll faster and get the signal at the
  exact moment it flips, but it cannot make the attestation itself arrive sooner.
- **Reducible operationally: only by aging the tx.** If the demo needs a fast
  first step, repay earlier and let attestation pass the block while the user
  fills out the rest of the demo flow; the "pending" stage then completes in
  ~2–10 s when the worker starts. Cold attestation cannot be accelerated.

## Plain-language conclusion

**Cold attestation is reliably slow: ~7–9 minutes (5 runs: 340, 451, 464, 500,
549 s), not ~10–15 s.** The fast (~10 s) numbers we saw earlier were always
already-attested blocks. The delay is a fixed structural property of the
Creditcoin network — it attests to Sepolia blocks about 35 deep behind the head,
catching up in 10-block steps at the same rate the chain produces them — so it
is *predictable in advance* (read the attested-height gap, multiply by ~12 s)
but *not controllable or reducible* from our side. The frontend/demo must
therefore treat the post-repayment state as a **pending-verification state of
~8 minutes**, ideally with a live countdown derived from the attested-height
gap, and it can make the pending window feel instant by repaying early and
letting attestation pass the block before the user reaches the verification
step.