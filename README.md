# TRU

TRU turns verified economic behavior on any supported blockchain into reusable on-chain history on Creditcoin — loan repayment history for humans and verified obligation history for autonomous agents — through the same cryptographic proof architecture.

## 1. The Problem

Credit history does not move between chains. A borrower who repays reliably on Ethereum has no way to make that history count on another network. Each chain starts the borrower at zero, with no portable score and no verifiable record of past performance. Existing credit systems are also opaque about inputs and trust a reporter to be honest. TRU addresses the portability and verifiability gaps together.

## 2. The Insight

Do not move the history. Prove it. Instead of copying a score or asking an oracle to report what happened, TRU has a Creditcoin contract cryptographically verify that a specific loan repayment transaction was included in an attested source block. The fact arrives self-certifying, not reported.

## 3. How TRU Works

A borrower repays a loan on Ethereum Sepolia through `SourceLoanMarket`, which emits `LoanRepaid` or `LoanCreated`. The same pipeline also verifies economic obligations: a requester creates an `ObligationCreated` for an executor (any address, including an autonomous agent) through `SourceObligationMarket`, and the executor later emits `ObligationCompleted`. In both cases the TRU worker waits for Creditcoin to attest that Sepolia block, requests a Merkle plus continuity proof from the proof builder, and sanity checks it with the BlockProver precompile. The worker submits the proof to `TRUUniversalContract` on Creditcoin, which computes the transaction index, checks the replay guard, calls the native verifier `verifyAndEmit`, decodes the event from the verified transaction receipt, checks that the emitter is the configured source market (`SourceLoanMarket` for loans, `SourceObligationMarket` for obligations), and forwards the verified fields to `TRUCreditRegistry`. The registry enforces replay and duplicate guards and, for loans, updates the borrower's profile, appends a `VerifiedFinancialEvent`, and updates loan lifecycle state; for obligations, it appends a `VerifiedObligationEvent` and updates the executor's obligation lifecycle. Downstream consumers like `TRUFinancing` read the already-verified loan state, while any application or agent can read the verified obligation history. No claims are made beyond what the verifier and emitter checks have proven.

## Verifiable Economic History

TRU originally proved loan repayment history. The same cryptographic verification architecture now extends to economic obligations involving autonomous agents. An agent is any address; its history is the set of verified economic events where that address was the executor. See `docs/VERIFIABLE_ECONOMIC_HISTORY.md` for the full extension.

*Human:* loan `→` repayment `→` cryptographic proof `→` verified credit history

*Agent:* obligation `→` completion `→` cryptographic proof `→` verified economic history

Agent flow:

```
Agent obligation (requester → executor, value, deadline)
  → SourceObligationMarket emits ObligationCreated / ObligationCompleted
  → Attestcoin attestation of the Sepolia block
  → Merkle + continuity proof
  → Creditcoin BlockProver verification
  → TRUUniversalContract (checks emitter == SourceObligationMarket, replay guard)
  → TRUCreditRegistry (append VerifiedObligationEvent, update obligation lifecycle)
  → verified agent economic history (queryable via getAgentPassport)
```

Trust boundary is unchanged and precise:

* **TRU verifies** that the configured source contract emitted the event, that the event existed in the attested source block, and that the logged parameters match the verified receipt.
* **TRU does not** determine whether an agent is trustworthy, whether the real-world work was satisfactory, or what reputation the agent deserves.
* Applications and autonomous agents interpret the verified history according to their own policies — for example, requiring a completion rate or settlement volume threshold before transacting. TRU provides evidence; the application makes the decision.

The Agent Passport is not an NFT, collectible, or AI-generated score. It is a deterministic view over `VerifiedObligationEvent` history, where every field (`verifiedObligations`, `completedObligations`, `activeObligations`, `verifiedSettlementVolume`, `verifiedSourceChains`, `completionRateBps`) is computed from verified events and explainable as `completed * 10000 / verified`.

## 4. Why Creditcoin + USC Are Essential

Remove Attestcoin, does it still work? No. A Creditcoin contract cannot see Ethereum. Without the Attestcoin protocol there is no mechanism by which that contract could know a repayment happened. The only alternatives would be someone telling it, which is forgeable and rejected by rule, or an oracle relaying it, which makes the credit history's integrity trust in the relay. The contract itself checks a Merkle proof that the repayment transaction was included in an attested Sepolia block. This is load-bearing, not decorative, and is drawn from `docs/ATTESTCOIN-INTEGRATION.md` section 1.

This is not zero trust. Three things are still trusted: the `SourceLoanMarket` logic that its loan functions emit truthful events, the key that deployed and owns the contracts, and the Creditcoin network's attestation of Sepolia blocks. What is eliminated is trust in the delivery path: the worker, any frontend, any backend, and any relay. A misbehaving operator of all of them cannot mint credit for a repayment that did not happen or change the amount of one that did.

## 5. Architecture

```
Sepolia (Ethereum)                               Creditcoin CC3 Testnet
─────────────────                                 ────────────────────────
SourceLoanMarket                                  BlockProver precompile 0x…0FD2
 createLoan() -> LoanCreated                      ▲ verifyAndEmit(proof) -> reverts
 repayLoan()  -> LoanRepaid                      │ "Merkle proof validation failed"
SourceObligationMarket                            │ on any tampered byte
 createObligation() -> ObligationCreated          │
 completeObligation() -> ObligationCompleted      │
      │  tx hash (any market)                    │
      ▼                                          │
 worker (off-chain, infrastructure only)          │
  polls /api/v1/attested-height/1                 │
  ProofBuilder.getProof(txHash)                   │
  ───────── USC proof ───────────────────────►    │
                                    ┌──────────────────────────────┐
                                    │ TRUUniversalContract         │
                                    │ processedQueries[queryId]    │
                                    │ decode LoanCreated /         │
                                    │ LoanRepaid /                 │
                                    │ ObligationCreated /          │
                                    │ ObligationCompleted, check   │
                                    │ emitter == configured market │
                                    └──────────────┬───┬───────────┘
                                                   │   │
                                          Loan*   Obligation*
                                                   │   │
                                          TRUCreditRegistry (CC3)
                                           loanStatus / obligationStatus
                                           borrowerEvents / subjectObligationHistory
                                           getCreditEvidence / getCreditPassport
                                           getAgentPassport / getObligationEvents
                                                   │
                                                   ▼
                                          Downstream consumers
                                           TRUFinancing (reads getCreditEvidence)
                                           Any app/agent (reads getAgentPassport)
```

* Loan* = LoanCreated / LoanRepaid → `VerifiedFinancialEvent` history.
  Obligation* = ObligationCreated / ObligationCompleted → `VerifiedObligationEvent` history.
  Both flow through the same `verifyAndEmit` + emitter + replay checks.

Current contract set: `SourceLoanMarket` and `SourceObligationMarket` (Sepolia, source markets, know nothing about Creditcoin), `TRUUniversalContract` (CC3, verification only), `TRUCreditRegistry` (CC3, history only — loans and obligations), `TRUFinancing` (CC3, consumer of verified state). The worker relays proof bytes only and never decides what gets credited.

## 6. Live End-to-End Demonstration

The demonstration is placed early because it is the primary evidence. The latest full chain is from phase 10, on the current deployment (contracts in section 15). Earlier independent runs in phase 0, phase 4, phase 6, and the attestation timing diagnostic show the same pipeline succeeding across different blocks.

Phase 10 live chain, borrower `0x2b374aDd4b86Ab1bf6196D1f698Eeb77156aA0F0`:

* Origination: `createLoan(1000000, now+30d)` on Sepolia
  - tx `0x74d0e459379fb89894db4d2b7903f15cb18ec27e90669c0f8743380f9749ac8a` block `11580721`
  - worker waited for attestation `534.9s`, proof `header 11580721 txIndex 97 cached true 0.5s`, `verifySingle true`
  - submitted via `TRUUniversalContract.executeLoanOrigination` tx `0xdd9e4e7183c816776aab9b69b45f5578406035555181fee24ee5bc09bccfaf3c` CC3 block `5385429` gas `384944`
  - `LoanOriginationVerified` matched source event YES
  - registry `loanStatus[0]=ACTIVE (1)`, `outstandingObligations=1`, `verifiedSourceChains [1]`

* Repayment: `repayLoan(0)` value `123456789`
  - tx `0xc21ea7d1505fcbbc10ff1ebbf1e5774e3608296652cb0bca17787bd35a34db8e` block `11581259`
  - worker waited `473.8s`, proof `header 11581259 txIndex 148 cached true 0.1s`, `verifySingle true`
  - submitted via `TRUUniversalContract.execute` tx `0xe0a48f58639dcb7aab0d1f84ffe6eeade1df7076eaf9040fb815ee660d5f2b4d` CC3 block `5385870` gas `400288`
  - `RepaymentVerified` matched source YES
  - registry `repayments=1 totalRepaid=123456789 creditLimit=100`, `loanStatus[0]=REPAID (2)`, `outstandingObligations=0`
  - `getCreditPassport`:
    `evidence creditState BUILDING (1) repayments 1 totalRepaid 123456789 creditLimit 100 distinctLoansRepaid 1 failedOrRejectedEvents 0`
    `loanHistory` one `VerifiedFinancialEvent` with `sourceChain 1 sourceTxHash 0xc21e… sourceBlock 11581259 loanId 0 amount 123456789`
    `verifiedSourceChains [1]`

* Financing: as the same borrower on CC3 (funded with 1 CTC for gas)
  - `getCreditEvidence` before: `BUILDING, 1, 100, 1, 0`
  - `requestFinancing(50)` tx `0xa8117461a266471e2b67ebccc8d5d7f302d3e6484f31d2698872f0613525b097` CC3 block `5385873` gas `150544`
  - `getFinancingRequests` returns one `FinancingRequest` with `amount 50 timestamp 1787876505 creditStateAtRequest BUILDING (1) status APPROVED (1)`
  - `requestFinancing(200)` correctly reverted `Amount exceeds credit limit`
  - fresh wallet with `NEW` correctly reverted `Insufficient credit state`

* Verifiable economic history for an autonomous agent (same deployment, same worker, same proof path — live, not simulated):
  - Agent `0x8FC1b779592De32B507014103ebBEbbE91566FB1` (fresh wallet funded on Sepolia, represents an autonomous executor)
  - `createObligation(agent, 9000, now+86400)` by requester `0x2b374aDd…` on Sepolia tx `0x9591e6219585e73fc1c3e10421e5a818347b50254d6e9cf99e2cdfdd71677617` block `11663848` (`ObligationCreated(1, requester 0x2b37…, executor 0x8FC1…, value 9000, deadline 1788992128)`)
    - worker waited `464.0s`, proof `header 11663848 txIndex 73 cached true 0.4s`, `verifySingle true`, submitted via `TRUUniversalContract.executeObligationCreated` tx `0xe7961a54e83e2b57a47fd02189fd37ae503f50421798c53cadc2751f208dd5a1` CC3 block `5454388` gas `857271` → `ObligationCreatedVerified` matched source YES → `obligationStatus ACTIVE`
  - `completeObligation(1)` by the agent on Sepolia tx `0x3aa9af68306d2e646d491b48de3878ebc5d093f05414e88dac7e949bf491a40c` block `11663849` (`ObligationCompleted(1, executor 0x8FC1…, settlementAmount 9000)`)
    - worker waited `2.3s` (already attested), proof `header 11663849 txIndex 70 cached true 0.1s`, `verifySingle true`, submitted via `TRUUniversalContract.executeObligationCompleted` tx `0xc19bc7df91805a135d5b4a3a1191c53488cc76ee6f3050b3f56f7bb35d0226b8` CC3 block `5454391` gas `560098` → `ObligationCompletedVerified` matched source YES → `obligationStatus COMPLETED`
  - `getAgentPassport(0x8FC1…)` returns `verifiedObligations 1, completedObligations 1, activeObligations 0, failedObligations 0, verifiedSettlementVolume 9000, completionRateBps 10000, verifiedSourceChains [1]` with `obligationHistory` of two `VerifiedObligationEvent` entries (`Created` and `Completed` for obligationId `1`). A second self-obligation (`0x5a2757…` block `11663734` → `0x720a42…` and `0x9eb372…` block `11663735` → `0xf342b72c…`) was also verified live for `0x2b37…` with the same path, showing the primitive works for both human and agent addresses. See `docs/VERIFIABLE_ECONOMIC_HISTORY.md` for the full extension.

Explorer links are formatted as `https://sepolia.etherscan.io/tx/<hash>` for Sepolia and `https://creditcoin-testnet.blockscout.com/tx/<hash>` for CC3. The CC3 Blockscout pattern is confirmed in `docs/usc-research.md`; the Sepolia Etherscan pattern is used as a placeholder because no Sepolia explorer URL pattern is recorded in the phase reports.

## 7. Credit State

`TRUCreditRegistry` keeps a deterministic model with documented thresholds. The comment above the enum is the single source of truth:

```
NEW         = 0 repayments
BUILDING    = 1-2 repayments
ESTABLISHED = 3-5 repayments
VERIFIED    = 6+ repayments
```

The credit limit formula is unchanged since phase 6 and remains:

```
creditLimit = BASE_LIMIT + (repayments * INCREMENT_PER_REPAYMENT)
```

with `BASE_LIMIT = 0` and `INCREMENT_PER_REPAYMENT = 100`, both `public constant` and readable on-chain. The unit is the base unit of `LoanRepaid.amount`, which is `msg.value` at `SourceLoanMarket.repayLoan` (wei on Sepolia). `getCreditEvidence(address)` returns `creditState, repayments, totalRepaid, creditLimit, distinctLoansRepaid, failedOrRejectedEvents`. `distinctLoansRepaid` is computed from the `borrowerEvents` log with deduplication, not new storage. `failedOrRejectedEvents` is definitionally `0` because only USC-verified events ever reach storage; rejected proofs never write state. `getCreditPassport(address)` wraps that evidence with `loanHistory` (reuse of `borrowerEvents`), `outstandingObligations` (count of `ACTIVE` loans), and `verifiedSourceChains` (distinct `sourceChain` values from both repayment and origination history, currently `[1]`).

## 8. Security Model

Every property is enforced either by construction (no violating code path exists) or by explicit check (a check rejects the attempt), as classified in `docs/phase-5-security.md`. Evidence is drawn from phase 0 spike tests and live pipeline tests.

| Attack | Result | How enforced |
| --- | --- | --- |
| Fake repayment (inject false borrower/loan/amount) | Rejected | By construction: `execute` takes no borrower, loanId, or amount inputs; values are derived from the verified transaction |
| Tampered borrower topic | Rejected | Precompile reverts `Merkle proof validation failed`; fresh consumer instance reverts identically |
| Tampered amount word (e.g. `987654321 -> 987654322`) | Rejected | Precompile reverts `Merkle proof validation failed`; any byte change breaks the Merkle proof |
| Valid proof but wrong event (no `LoanRepaid`/`LoanCreated` log) | Rejected | Consumer reverts `No Repayment event found` / `No LoanCreated event found` (phase 0 test 4b, valid proof passes verifier but fails event gate) |
| Unauthorized source (foreign contract emitter) | Rejected | By explicit check `log.address_ == sourceLoanMarket` (`Not SourceLoanMarket emitter`), and registry `onlyUniversalContract` |
| Replayed query (same `queryId = keccak(chainKey, blockHeight, txIndex)`) | Rejected | By explicit check `processedQueries` in `TRUUniversalContract` and `processedRepayments` / `processedOriginations` in registry; live replay reverted `Query already processed` and profile unchanged |
| Duplicate loan (same `borrower` + `loanId` via different queryId) | Rejected | By explicit check `countedLoans[borrower][loanId]` (`Loan already credited`) and `loanStatus` (`Loan already originated`); distinct loans accumulate |
| Invalid proof (nonexistent tx) | Rejected | Proof builder returns `success false` HTTP 404, nothing reaches the verifier |
| Failed source transaction (receipt status 0) | Rejected | Consumer requires `receiptStatus == 1` (`Transaction did not succeed`) |

Loan origination uses the same verifier path and emitter and replay checks as repayment, via `executeLoanOrigination` and `recordVerifiedLoanOrigination`.

## 9. Testnet Deployment

Current deployment is the verifiable economic history extension, which supersedes earlier phase addresses. The deployment files under `contracts/deployments` are the single source of truth and are loaded by the worker at runtime. Both source markets are redeployed fresh on each `deploy-production.mjs` run.

| Component | Chain | Address | ChainId / chainKey |
| --- | --- | --- | --- |
| SourceLoanMarket | Ethereum Sepolia | `0x9953AC50803f85EaA666B7724a7B165504B9c2e1` | chainId `11155111`, chainKey `1` on CC3 Testnet |
| SourceObligationMarket | Ethereum Sepolia | `0x133A8Fe8408066B95034Ed638f5C7083Be94d14F` | chainId `11155111`, chainKey `1` on CC3 Testnet |
| TRUCreditRegistry | Creditcoin CC3 Testnet | `0x0D2707D258A87b971fd4cd78232304a672CA43c0` | chainId `102031` |
| TRUUniversalContract | Creditcoin CC3 Testnet | `0xa33fd898502de87aA52C5992483b74f471613Ef0` | chainId `102031`; decoder `0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f` |
| TRUFinancing | Creditcoin CC3 Testnet | `0xd971aeaAc0D7216c41CccEdc5F4d6EF539Cad0bB` | chainId `102031`; registry `0x0D27…` |

ChainKeys are per environment; on CC3 Testnet `chainKey 1 = Sepolia` and `chainKey 3 = Ethereum mainnet`, queried via `getSupportedChains` rather than hardcoded. The BlockProver precompile is `0x0000000000000000000000000000000000000FD2` and ChainInfo is `0x0000000000000000000000000000000000000fd3`.

## 10. Proven Results

Three-plus independent live end-to-end runs plus the attestation timing diagnostic show the same pipeline succeeding. The phase 0, 4, 6, and timing runs below used earlier contract deployments superseded by the current addresses in section 15, so those transaction hashes are historical proof that the mechanism has worked repeatedly across the build, not live state on the current contracts. The current deployment's live evidence is in section 6.

* Phase 0 spike: Sepolia `0xbd0cdaf5…` block `11497681` -> `SpikeConsumer.execute` tx `0x784bdffd…` block `5317027` verifiedCount `1`.
* Phase 4 pipeline: loan 0 creation `0x60e6e5c8…` block `11498016` and repayment `0x98c2040d…` block `11498018` -> `TRUUniversalContract.execute` `0xd55830a2…` block `5317198` -> `repayments 1`.
* Phase 6 credit logic: repayment `0x9f4ec67d…` block `11503185` -> submit `0xea7808a4…` block `5321469` -> `creditLimit 0 -> 100`.
* Attestation timing: three runs with repay `0x10dc15…` block `11503274`, `0x51556a…` block `11503321`, `0x770251…` block `11503369`, each `+1` repayment and `creditLimit 200/300/400`, cold waits `499.9s, 549.0s, 450.9s`.
* Phase 10 full loan chain described in section 6: origination `0x74d0e459…` and repayment `0xc21ea7d1…` leading to `BUILDING / 1 / 100` and financing `0xa81174…`.
* Verifiable economic history (live, current deployment): obligation for agent `0x8FC1…` — create `0x9591e621…` block `11663848` → `0xe7961a54…` block `5454388` (464.0s attestation) and complete `0x3aa9af68…` block `11663849` → `0xc19bc7df…` block `5454391` (2.3s) → `AgentPassport: verified 1, completed 1, active 0, settlement 9000, rate 10000`. A self-obligation `0x5a2757…` block `11663734` → `0x720a42…` and `0x9eb372…` block `11663735` → `0xf342b72c…` was also verified live, showing the primitive works for both human and agent addresses. See `docs/VERIFIABLE_ECONOMIC_HISTORY.md`.

Forge test count as of this update: `73 passing` (7 `SourceLoanMarket`, 7 `SourceObligationMarket`, 11 `TRUUniversalContract`, 42 `TRUCreditRegistry`, 6 `TRUFinancing`) with `foundry.toml` solc `0.8.28`, `via_ir true`, `optimizer 200`. The specific verified state transitions observed in live tests are `repayments 0 -> 1` with `creditLimit 0 -> 100`, then `1 -> 2 -> 3 -> 4` with `100 -> 200 -> 300 -> 400` across the timing runs, and the recent origination `ACTIVE` with `outstanding 1` then repayment `REPAID` with `outstanding 0`, plus obligation `Created ACTIVE` then `Completed` with `verified 1 → completed 1` and `settlement 9000`.

## 11. Ecosystem / User Expansion

TRU's verified credit primitive is not a lending protocol itself; it is a downstream input. Future consumers that could read `getCreditEvidence`, `getCreditPassport`, or `TRUFinancing` state include lending protocols on Creditcoin, fintechs building reusable credit histories, and RWA or invoice financing flows where a verified repayment history is used to gate limits. No current adoption or users are claimed; this section frames future consumers only.

## 12. Product Roadmap

Pulled from the deck content for consistency:

* Close the self-loan gap: require the source market to prove an external funder for each loan, or scale credit with repayment relative to principal, so a borrower cannot be their own lender and mint credit.
* Mainnet path: per-environment config for chainKey, proof builder, and decoder, plus a real audit of the source lending contract, with a re-check of the inherited `EvmV1Decoder.getLogsByEventSignature` quirk on mainnet.
* Additional source chains: the pipeline is not Sepolia specific; Attestcoin already supports Ethereum mainnet and the worker already queries `getSupportedChains`.
* Portable credit vision: any verified repayment history becomes reusable collateral for lending decisions elsewhere on Creditcoin.

## 13. Limitations

Testnet only. Everything runs on Ethereum Sepolia and Creditcoin CC3 Testnet; no mainnet credit state exists yet. This is stated directly because it limits what is proven.

Self-loan gap. Today a borrower can `createLoan` for themselves and `repayLoan` with one wei to themselves. Each distinct `loanId` is verified and creditable once, and `loanIds` are unlimited, so a loop of create and repay bumps `repayments` and therefore `creditLimit` by `100` per iteration at a cost of roughly gas plus a wei. This is a known limitation, documented in the same language as the deck, and is first on the fix list.

Attestation takes about 7 to 9 minutes. The Creditcoin network attests Sepolia blocks about 35 blocks deep behind the head, advancing in 10-block batches at Sepolia's roughly 12 second block time. A freshly mined repayment waits about 7 to 9 minutes for cold attestation. This is predictable in advance as `remaining ≈ (target - attested) * 12s` from the attested height gap, but not reducible from our side. Already attested blocks are instant.

activeLoans was removed, not faked. The original `CreditProfile` declared an `activeLoans` field that was never written, so the public getter always returned `0`. It was deleted from the struct, the ABI, and the worker log, and contracts were redeployed, rather than shipped as if it meant something. `profiles(borrower)` now returns `repayments, totalRepaid, creditLimit`.

TRUFinancing approves on eligibility alone. `requestFinancing` requires `creditState >= BUILDING` and `amount <= creditLimit` and then stores a `FinancingRequest` with `status = APPROVED`. No separate approval step exists and no funds are disbursed; this is a recorded, credit-gated request only. This is stated plainly so that `APPROVED` is not oversold as disbursement.

## 14. Technical Documentation

The judge-facing deep dive is `docs/ATTESTCOIN-INTEGRATION.md`. It covers why Attestcoin is load-bearing, the exact addresses and SDK calls, the `chainKey` versus `chainId` distinction, the attestation timing finding, the five security properties, the tampered amount adversarial walkthrough, and the oracle comparison, plus the same honest limitations.

## 15. Contract Addresses

Current deployment is the verifiable economic history extension, which supersedes earlier phase addresses. Previous addresses are retained in `contracts/deployments` history but the worker loads the current files above.

| Contract | Chain | Address | Deploy Tx |
| --- | --- | --- | --- |
| SourceLoanMarket | Sepolia (`11155111`) | `0x9953AC50803f85EaA666B7724a7B165504B9c2e1` | `0xfdd5cb3e248a78aa232f32e963a090c6f0b7452af33a92ba4c2ddb870fdc0993` |
| SourceObligationMarket | Sepolia (`11155111`) | `0x133A8Fe8408066B95034Ed638f5C7083Be94d14F` | `0x174d715ab49b14836a90118e06ec58a67bfd755242af8053b2f31ec6b0a6079e` |
| TRUCreditRegistry | CC3 (`102031`) | `0x0D2707D258A87b971fd4cd78232304a672CA43c0` | `0x54e5f166cf17048ee471ef2e4699677f9afd1fbf095ff15bd7f47cc032689d27` |
| TRUUniversalContract | CC3 (`102031`) | `0xa33fd898502de87aA52C5992483b74f471613Ef0` | `0x1264d53753736398f33330340f983e4be5f0f336f514a2f13af612105b64a125` |
| TRUFinancing | CC3 (`102031`) | `0xd971aeaAc0D7216c41CccEdc5F4d6EF539Cad0bB` | `0x634cbf7119c03c1d3a4d6bcb96e592ef22cce2770717ce80eaa3ef33d7f0bca6` |
| EvmV1Decoder (deployed library) | CC3 | `0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f` | — |
| BlockProver precompile | CC3 | `0x0000000000000000000000000000000000000FD2` | — |
| ChainInfo precompile | CC3 | `0x0000000000000000000000000000000000000fd3` | — |

## 16. How to Run

Only commands that actually exist in the repo are described, verified against `contracts/foundry.toml`, `creditcoin/package.json`, and the script files.

Contracts:

```
cd contracts
forge build
forge test
```

Deployment (ethers, not forge broadcast, which is unreliable on CC3):

```
cd creditcoin
node src/deploy-production.mjs
```

This deploys `SourceLoanMarket` and `SourceObligationMarket` to Sepolia, then `TRUCreditRegistry`, `TRUUniversalContract` (with `decoder`, `registry`, and `sourceLoanMarket` constructor args, then `setSourceObligationMarket`), and `TRUFinancing` (with the just-deployed `TRUCreditRegistry` address as its constructor arg) to CC3, and configures `TRUCreditRegistry.setUniversalContract`. All five addresses and ABIs are written to `contracts/deployments` as the single source of truth loaded by the worker.

Worker (real USC pipeline):

```
# Sepolia RPC and Creditcoin RPC plus proof builder are in creditcoin/.env:
# SOURCE_RPC_URL, SEPOLIA_PRIVATE_KEY, CREDITCOIN_RPC_URL, CREDITCOIN_PRIVATE_KEY, PROOF_BUILDER_URL

# process a single repayment, origination, or obligation (auto-detected)
node creditcoin/src/worker.mjs --tx <sepoliaTxHash>

# listen from a block (handles LoanCreated/Repaid and ObligationCreated/Completed)
node creditcoin/src/worker.mjs --from-block <N> --process-count 1
```

The worker loads ABIs and addresses from `contracts/deployments/*`, waits for attestation via `ProofBuilder.waitUntilHeightAttested`, builds the proof via `getProof`, sanity checks with `PrecompileBlockProver.verifySingle`, and submits to `TRUUniversalContract.execute`, `executeLoanOrigination`, `executeObligationCreated`, or `executeObligationCompleted`.

Driver (source chain helper):

```
node creditcoin/src/driver.mjs --create
node creditcoin/src/driver.mjs --repay <loanId>
node creditcoin/src/driver.mjs   # create + repay in one
```

Explorer links are `https://sepolia.etherscan.io/tx/<hash>` for Sepolia transactions and `https://creditcoin-testnet.blockscout.com/tx/<hash>` for CC3 transactions as recorded in `docs/usc-research.md` for CC3.
