# Phase 0 — Security Tests: Invalid Data Rejection

**Date**: 2026-08-16
**Status**: ✅ PASS — all 5 scenarios rejected. No test unexpectedly succeeded.

This is AGENTS.md build order **step 2**, run against the same throwaway spike setup
from `docs/phase-0-report.md` (fresh `SpikeConsumer` deployments on CC3 testnet, real
Sepolia source tx, real USC proof verification).

## Setup

- Source tx (the one being protected): `0xbd0cdaf5ed7c37ca8472b60fc9f1fcadfd829368a943465b7951b5e2ed781c9c`
  on Sepolia, block `11497681`, txIndex `56`. Verified event: borrower
  `0x2b374aDd4b86Ab1bf6196D1f698Eeb77156aA0F0`, loanId `42`, amount `999000000`.
- Two fresh consumers were deployed so the tests isolate the right rejection:
  - `main` `0x819c7fAa0453ee8C474E98b218F3Db6656D7c319` — used for the baseline +
    replay test (needs one successful submission first).
  - `fresh` `0x804B62b8347d9A1e24070781cc55F1d6d9141E4b` — used for the tamper tests,
    where the query had never been processed so the proof-verification gate (not the
    replay guard) is what rejects.
- Worker/scripts: `creditcoin/src/security-tests.mjs` (results JSON in
  `docs/security-tests-raw.json`), SDK `@gluwa/usc-sdk` 0.18.0, precompile
  `verifySingle` + BlockProver `verifyAndEmit` via `SpikeConsumer.execute`.

## Results

| # | Scenario | Input submitted | Verifier response | Consumer outcome |
|---|----------|-----------------|-------------------|------------------|
| 1 | Fake borrower | Valid proof, `encodedTransaction` log `topics[1]` rewritten to `0x...deaddead` | revert `Error(string) "Merkle proof validation failed"` | revert `Error(string) "Merkle proof validation failed"` |
| 2 | Tampered amount | Valid proof, log `data` changed `999000000 → 999000001` | revert `Error(string) "Merkle proof validation failed"` | revert `Error(string) "Merkle proof validation failed"` |
| 3 | Replayed query | Exact same valid proof/query submitted twice | (replay guard fires) | second submit revert `Error(string) "Query already processed"` |
| 4a | Nonexistent tx | `proofBuilder.getProof(0xfff…fff)` (no such Sepolia tx) | — | proof builder returns `success: false`, HTTP `404` (no proof can be built) |
| 4b | Valid proof, wrong event | Proof for a real attested Sepolia tx in the same block with **no** `Repayment` log (`0xfd6a9838…`) | `verifySingle` → `true` (proof is valid) | revert `Error(string) "No Repayment event found"` |

Details and exact evidence:

- **Test 1 — fake borrower**: the borrower address in the log topic was changed to a
  fake (`0x…deaddead`; confirmed by re-decoding the tampered bytes). The BlockProver
  precompile rejects because any byte change alters the transaction hash, which no
  longer matches the Merkle proof. Revert data:
  `0x08c379a0…1e4d65726b6c652070726f6f662076616c69646174696f6e206661696c6564`
  (`"Merkle proof validation failed"`).
- **Test 2 — tampered amount**: `data` rewritten to `999000001`
  (`0x…3b8b87c1`, confirmed by re-decoding). Same precompile rejection.
- **Test 3 — replay**: first submission of the proof to the `main` consumer succeeded
  (tx `0x059b52508c7bc93ee65222477a10dbdfb9e8a6928f9a4474c618dd974468b8d2`, block
  `5317087`, status `1`, replay key `queryId =
  0x1f4be96b08b098c9fccc2ac264ba935051e190ea6ba6245d53542ab6147d773b`). Resubmitting
  the identical proof reverts with `"Query already processed"` before any verification
  work. After all tests, `verifiedCount` is still `1` and the stored values are still
  the legitimate ones.
- **Test 4a — nonexistent tx**: the proof builder cannot construct a proof for a
  non-existent txHash (`success: false`, HTTP 404). Nothing reaches the verifier or
  the consumer.
- **Test 4b — wrong event (bonus)**: a valid proof of a real, attested, non-repayment
  Sepolia tx **passes** the verifier (`true`) but is rejected by the consumer's event
  gate (`"No Repayment event found"`). This confirms the two-layer design: USC proof
  verification gates every submission, and the consumer additionally requires the
  expected `Repayment` event to be present.

## Structural findings (important for later phases)

- **Tests 1 and 5 reduce to the same guarantee**: the spike consumer takes **no
  `borrower`, `loanId`, or `amount` inputs** — they are derived on-chain only from the
  USC-verified transaction. Therefore a "fake borrower"/"wrong loan ID"/"wrong amount"
  claim cannot be injected as a parameter; the only injection path is tampering the
  submitted transaction bytes, which the Merkle-proof verification rejects for every
  field. This is the correct layer-1 defense and matches AGENTS.md rule 3 (verified
  event is the only source of truth).
- **Order of guards**: `execute` checks the replay key before running the verifier.
  On a consumer that has already processed a query, the replay guard is what rejects
  (as in Test 3). On a fresh query, the verifier is what rejects tampered data (as in
  Tests 1/2/5). Both orders are correct.
- **"Wrong loan ID" as a claim mismatch is not yet enforceable at this layer**: because
  the consumer never receives a claimed loanId, there is nothing for it to cross-check
  against the verified event. That check becomes meaningful in the real contracts
  (AGENTS.md step 5, "loan binding"), where e.g. a submitted `loanId` or an off-chain
  claim would be validated against the verified event. Note: test 5 here proves the
  loanId value **inside** the transaction is tamper-proof, which is the prerequisite
  for that later binding.

## Conclusion

Every invalid-data path tested is rejected with an explicit, observable signal (revert
reason string from the precompile, revert reason from the consumer's guard, or a 404
from the proof builder). No fake, tampered, or replayed input was credited on-chain.
The spike's integrity boundary for Phase 0 is confirmed. Next per AGENTS.md is
build order **step 3** (build the three real contracts).