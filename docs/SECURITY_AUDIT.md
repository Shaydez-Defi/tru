# TRU: Final Security Audit

**Date:** 2026-09-09
**Scope:** Full audit and hardening of the implemented system. No new product
features, no UI, no NFTs, no AI, no tokens, no new reputation systems.
`ObligationFailed` verification was not added: the audit found no
security-critical reason requiring it (`failedObligations` is deterministically
`0` by design, documented in `docs/VERIFIABLE_ECONOMIC_HISTORY.md`).
**Result: PASS WITH FINDINGS**, no Critical or High findings. Three LOW
hardening fixes applied with regression tests. All other findings are
documented trust assumptions or observations with no code change.

## 1. Audit Scope

All code paths that can modify persistent credit or economic-history state:

- `contracts/src/sepolia/SourceLoanMarket.sol`, loan creation/repayment, `LoanCreated`/`LoanRepaid`
- `contracts/src/sepolia/SourceObligationMarket.sol`, obligation lifecycle, `ObligationCreated`/`ObligationCompleted`/`ObligationFailed`
- `contracts/src/creditcoin/TRUUniversalContract.sol`, `execute`, `executeLoanOrigination`, `executeObligationCreated`, `executeObligationCompleted`, all decoders, replay guard, admin setters
- `contracts/src/creditcoin/TRUCreditRegistry.sol`, `recordVerifiedRepayment`, `recordVerifiedLoanOrigination`, `recordVerifiedObligationCreated`, `recordVerifiedObligationCompleted`, all views (`getCreditEvidence`, `getCreditPassport`, `getAgentPassport`, pagination)
- `contracts/src/creditcoin/interfaces/ITRUCreditRegistry.sol`, shared types and entry points
- `contracts/src/creditcoin/TRUFinancing.sol`, `requestFinancing`, request storage and views
- `creditcoin/src/worker.mjs`, all four event handlers, `listen`, `--tx` path, error classification
- `creditcoin/src/deploy-production.mjs`, deployment and wiring order
- `creditcoin/src/demo-obligation.mjs`, read-only demo, no state writes
- All Forge tests (`contracts/test/*.sol`)

Out of scope for changes (reviewed, not modified): spike contracts, `TestRepayment`, decoder library, SDK, precompiles.

## 2. Architecture Reviewed

```
Sepolia: SourceLoanMarket + SourceObligationMarket (know nothing of Creditcoin)
  → events → worker (proof relay only) → proof builder → BlockProver precompile
  → TRUUniversalContract (verify + decode + emitter check + replay guard)
  → TRUCreditRegistry (UC-gated writes only)
  → TRUFinancing + any app/agent (read-only consumers of verified state)
```

Every persistent state mutation in `TRUCreditRegistry` is reachable only
through `onlyUniversalContract`-gated functions, and `TRUUniversalContract`
writes only after `verifyAndEmit` succeeds and the emitter check passes.

## 3. Trust Model

TRU eliminates the need to trust the worker or any reporter to truthfully
describe a source-chain event. It does not eliminate all trust:

- **Source contract logic is trusted.** `SourceLoanMarket` enforces active +
  owner + value for loans; `SourceObligationMarket` enforces executor-only
  completion and active status. A bug or malicious upgrade there produces
  truthfully-verified but semantically wrong events.
- **Deployment owner key is trusted.** Owner-only setters can re-point
  `sourceLoanMarket`, `sourceObligationMarket`, `registry`, and
  `universalContract`. Owner compromise can redirect future verification.
- **Creditcoin attestation is trusted.** The ~35-block standing lag and
  10-block-batch policy govern when proofs become available.
- **BlockProver precompile and EvmV1Decoder library are trusted** as inherited
  infrastructure (decoder `getLogsByEventSignature` breakage is worked around
  with in-contract filtering, as documented since phase 0).

## 4. Verification Boundary

For each of the four `execute*` entry points, the order is identical:
compute `txIndex` → derive `queryId` → check `processedQueries` → call
`verifyAndEmit` (reverts on failure) → mark processed → decode from the
verified receipt → emitter check → forward to registry. The decoded
`borrower`/`loanId`/`amount`/`requester`/`executor`/`value`/`principal`/`due`
values come exclusively from the verified receipt logs. The worker supplies
only proof bytes plus `chainKey`/`blockHeight` (both bound by `verifyAndEmit`)
and `sourceTxHash` (see LOW-1: relay-provided index, not verified).

## 5. Access Control Model

- Registry writes: `onlyUniversalContract` on all four record functions.
  Verified by `test_randomAddressCallReverts` and obligation equivalents.
- UC admin: `setRegistry`, `setSourceLoanMarket`, `setSourceObligationMarket`
  are `onlyOwner`. Registry admin: `setUniversalContract` is `onlyOwner`.
- `TRUFinancing`: `registry` is immutable (constructor-only, no setter);
  anyone may call `requestFinancing` for themselves (intended).
- Source markets: creation is permissionless; completion/repayment restricted
  to the designated executor/borrower; failure restricted to involved parties.

## 6. Replay Protection

- UC-level: single shared `processedQueries[keccak(chainKey, blockHeight,
  txIndex)]` across all four execute paths. A transaction containing several
  events credits once, conservatively, regardless of type. Live-proven:
  resubmission reverts `Query already processed` (loan and obligation flows).
- Registry-level: `processedRepayments`, `processedOriginations`,
  `processedObligationCreations`, `processedObligationCompletions`, each keyed
  by `queryId`. Covered by unit tests per path.
- Note: because the UC guard marks state before decoding and a decode revert
  rolls back the whole transaction, a failed decode does not burn the queryId.

## 7. Duplicate Protection

- Loans: `countedLoans[borrower][loanId]` plus `loanStatus` transitions.
- Obligations: `obligationStatus[obligationId]` global lifecycle plus
  per-queryId replay maps. Double completion reverts `Obligation not active`
  (new regression test `test_obligationDoubleCompletionReverts`).

## 8. Obligation Lifecycle Security

`NONE → ACTIVE → COMPLETED`, with `FAILED` defined but no verified failure
path (out of scope, documented). Findings verified by test:

- Completion before creation reverts (`test_obligationCompletedWithoutActiveReverts`).
- Completion twice reverts, state unchanged (`test_obligationDoubleCompletionReverts`, new).
- Unrelated address cannot complete (`Executor mismatch` test).
- Executor/requester/value/deadline are immutable after creation (stored at
  creation; completion only references them).
- Obligation IDs are globally unique per source market counter; IDs are
  namespaced per registry by single-market assumption (see INFORMATIONAL-2).
- Self-obligations (`requester == executor`) are stored once per event, not
  twice (fixed in a prior phase, live-verified; new regression test
  `test_selfObligationNotDoubleCounted`).

## 9. Agent History Integrity

`getAgentPassport` derivations were re-audited:

- `verifiedObligations`: distinct `Created` obligationIds in subject history.
- `completedObligations` / `failedObligations`: distinct `Completed`/`Failed`
  obligationIds (dedup loops prevent double counting if an event ever appears
  twice).
- `activeObligations`: distinct `Created` whose global status is still `ACTIVE`.
- `verifiedSettlementVolume`: sums only events where `executor == subject`.
- `completionRateBps`: `completed * 10000 / verified`, `0` when `verified == 0`
  (no division by zero).
- Requester and executor both receive history entries (queryability for both
  sides); settlement volume accrues to the executor only.
- `getObligationEvents` pagination matches the loan `getEvents` pattern
  (reverse chronological, empty on out-of-range offset).

## 10. Loan Flow Security

Unchanged and re-verified: replay (`Query already processed`), duplicate
(`Loan already credited` / `Loan already originated`), emitter binding
(`Not SourceLoanMarket emitter`), receipt status gate, UC-only registry
access, repayment-without-origination edge case still documented and tested.
All 42 registry loan tests and 8 UC loan decode tests pass unmodified
(except the `test_unconfiguredContractCannotRecord` fixture change described
in LOW-2, which tests the same property more cleanly).

## 11. Financing Security

- `amount <= creditLimit` and `creditState >= BUILDING` enforced against live
  `getCreditEvidence(msg.sender)`; zero amount rejected (new test
  `test_requestRevertsForZeroAmount`).
- Requests snapshot `creditStateAtRequest`; later state changes do not alter
  history (existing test).
- No token movement, no minting, no registry writes, no reentrancy surface
  (external view call precedes local push; no value transfer).
- No policy change made; `APPROVED`-on-eligibility remains as documented.

## 12. Worker Security

- The worker cannot write verified history: it holds no UC privilege and
  registry calls from its key revert (`onlyUniversalContract`). It can only
  submit proofs any party could submit.
- It cannot substitute event data: borrower/amounts/IDs are decoded on-chain
  from the verified receipt. The sole relay-supplied stored field is
  `sourceTxHash` (see LOW-1).
- It cannot choose an arbitrary emitter: the log address is checked on-chain
  against the configured market.
- It cannot mark anything verified: only `verifyAndEmit` success leads to a
  registry write; `verifySingle` sanity check is fail-closed (`throw` on false).
- No secrets are logged (only tx hashes, blocks, addresses, amounts, statuses).
  Private keys come from environment (`.env` is gitignored; verified no keys
  in the repo). RPC endpoints are env-configured.
- Unsafe input: `--tx` validates receipt existence and matching log, else
  exits non-zero. `parseInt` on `--from-block` is operator input, not attacker
  input.
- Retry behavior is bounded by `waitUntilHeightAttested` timeouts; duplicate
  submissions are deduplicated client-side (`seen` set) and rejected on-chain.
- Fix applied: `processLoanRepaid` now classifies registry-level
  already-recorded/already-credited reverts as `replay-rejected`, matching the
  obligation handlers (LOW-3).

## 13. Cross-Chain Assumptions

- `chainKey` and `blockHeight` passed to `verifyAndEmit` bind the proof to a
  specific source chain and block; a proof for another chain/block fails
  verification.
- The emitter check binds the event to a specific source contract deployment.
  Old deployments are rejected after rotation (documented since phase 5).
- `queryId` binds `(chainKey, blockHeight, txIndex)`; replay scope is
  per-transaction and cross-type.
- `sourceTxHash` is NOT bound by the proof (see LOW-1); `sourceChain` and
  `sourceBlock` ARE (they are the verified `chainKey`/`blockHeight`).

## 14. Findings

### LOW-1: `sourceTxHash` is relay-provided, not cryptographically verified
`TRUUniversalContract.execute*` accepts `sourceTxHash` from the caller and
forwards it; the registry stores it in history. Nothing on-chain binds it to
the verified transaction (the USC `encodedTransaction` is a protocol encoding,
not raw RLP, so its hash is not the Sepolia tx hash). Impact is limited to
history display/linking: credit fields (`repayments`, `creditLimit`,
`profiles`) and lifecycle transitions never depend on it, and replay/duplicate
guards use `queryId`. A malicious relayer can store a wrong tx hash but cannot
alter who is credited or how much.
Fix: documented in `ITRUCreditRegistry` NatSpec (verified identifier is the
`queryId`); added regression test `test_sourceTxHashStoredAsRelayProvided`
proving stored-equals-passed semantics. No logic change (a schema break would
be required to remove the field, disproportionate to a display-only field).

### LOW-2: Admin setters allowed the zero address
`TRUUniversalContract.setRegistry` and `TRUCreditRegistry.setUniversalContract`
had no zero-address check (owner-only, so self-inflicted only). Setting the
registry to zero would make `execute` succeed while silently writing nowhere
(`RepaymentVerified` emitted, queryId burned, no credit); setting the UC to
zero bricks all writes (fail-closed).
Fix: `require` non-zero in both setters. Updated
`test_unconfiguredContractCannotRecord` to use a freshly deployed registry
(same property, cleaner fixture) and added
`test_setRegistryRejectsZeroAddress` /
`test_setUniversalContractRejectsZeroAddress`.

### LOW-3: Inconsistent replay classification in worker loan handler
`processLoanRepaid` only treated `Query already processed` as replay-rejected,
while obligation handlers also matched already-recorded/already-credited.
Unreachable via the normal UC path (UC guard fires first); reachable only
after a UC rotation. State was always safe; only the CLI status was wrong.
Fix: extended the loan regex to match, no behavior change on the happy path.

### LOW-4: O(n²) passport/history views
`getAgentPassport`, `getCreditEvidence` distinct-count, and
`getCreditPassport` chain-dedup loop over unbounded per-subject arrays.
Correct at current scale; view calls could become expensive with hundreds of
events per subject. No fix (would require new storage/indexing); documented
for future pagination or off-chain indexing.

## 15. Fixes Applied

1. LOW-1: NatSpec documentation + `test_sourceTxHashStoredAsRelayProvided`.
2. LOW-2: zero-address `require` in `setRegistry` / `setUniversalContract` +
   `test_setRegistryRejectsZeroAddress` /
   `test_setUniversalContractRejectsZeroAddress` + fixture update of
   `test_unconfiguredContractCannotRecord`.
3. LOW-3: worker replay-regex consistency for `processLoanRepaid`.
4. New adversarial regression tests: `test_obligationDoubleCompletionReverts`,
   `test_obligationZeroAddressReverts`, `test_selfObligationNotDoubleCounted`,
   `test_decodeObligationCompletedRejectsForeignEmitter`,
   `test_requestRevertsForZeroAmount`.

## 16. Remaining Risks

- Owner-key compromise or misconfiguration remains the highest-impact vector
  (can redirect future verification or brick writes). No multisig/timelock
  exists on testnet.
- The current testnet deployment uses the same key material for deployment
  ownership and worker relaying (both loaded from the operator environment),
  so operator trust currently equals owner trust. Production must separate
  them: multisig or hardware-backed owner, least-privilege relay key that
  cannot reconfigure contracts.
- Single-market ID namespaces: `loanId`/`obligationId` are globally unique
  per registry only while one market of each type is configured. A second
  market would need namespacing by `(sourceChain, sourceContract, id)`.
- Self-loan gap (borrower as own lender minting credit) is a known,
  documented limitation, unchanged by this audit.
- `ObligationFailed` has no verified path; `failedObligations` is
  deterministically `0`. If failure semantics become load-bearing, add the
  same decode/execute/record pattern rather than inferring failures off-chain.
- Cold attestation latency (~7-9 minutes) is a liveness property, not a
  security issue; already-attested replays resolve in seconds.

## 17. Explicit Trust Assumptions

1. Source market logic is correct (loan ownership, executor-only completion,
   no deadline enforcement on completion).
2. Deployment owner key is honest and competent (configuration, rotation,
   future upgrades).
3. Creditcoin attestation finality and availability (liveness of new writes).
4. BlockProver precompile and EvmV1Decoder correctness, except the documented
   `getLogsByEventSignature` breakage which is worked around in-contract.
5. `@gluwa/usc-sdk` proof builder returns proofs for the requested tx
   (failures are fail-closed: no proof, no submission).
6. Testnet faucet/RPC availability for demonstration only.

TRU eliminates the need to trust the worker or any reporter to truthfully
describe a source-chain event. It does not eliminate the assumptions above.

## 18. Test Coverage

- `forge test`: **81 passing, 0 failed, 0 skipped** (was 73; +8 new audit
  regression tests), across 5 suites: 7 `SourceLoanMarket`, 7
  `SourceObligationMarket`, 13 `TRUUniversalContract` (+`test_setRegistryRejectsZeroAddress`,
  +`test_decodeObligationCompletedRejectsForeignEmitter`), 47
  `TRUCreditRegistry` (+`test_obligationDoubleCompletionReverts`,
  +`test_obligationZeroAddressReverts`, +`test_selfObligationNotDoubleCounted`,
  +`test_sourceTxHashStoredAsRelayProvided`,
  +`test_setUniversalContractRejectsZeroAddress`), 7 `TRUFinancing`
  (+`test_requestRevertsForZeroAmount`).
- `forge build`: clean (only pre-existing `block.timestamp` and typecast lint
  notes).
- Live evidence reused (no new live transactions in this audit phase):
  obligation create `0x9591e621…` block `11663848` → `0xe7961a54…` block
  `5454388`; complete `0x3aa9af68…` block `11663849` → `0xc19bc7df…` block
  `5454391`; self-obligation `0x5a2757…`/`0x9eb372…`; replay of `0x1d4bd4…`
  correctly reverted `Query already processed`. Loan live chains from phases
  4/6/8/10 unchanged.

## 19. Final Security Assessment

The verification boundary holds: every persistent state mutation requires a
UC-forwarded call that itself requires a successful `verifyAndEmit` plus an
emitter match, guarded by queryId replay protection and per-domain duplicate
protection. No path was found by which an untrusted caller, the worker, or a
tampered payload can falsify verified history, redirect credit, inflate
settlement volume, or attribute events to the wrong subject. The three LOW
fixes tighten configuration fail-closes, error classification, and
documentation of the one relay-supplied field. Remaining items are explicit,
accepted trust assumptions for a testnet system. No deployment changes were
made in this phase; the LOW-2 code hardening takes effect on the next
deployment (live contracts predate it, noted here rather than hidden).
