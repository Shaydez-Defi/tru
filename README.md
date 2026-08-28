# TRU

TRU turns verified repayment behavior on any supported blockchain into reusable on-chain credit history on Creditcoin.

## 1. The Problem

Credit history does not move between chains. A borrower who repays reliably on Ethereum has no way to make that history count on another network. Each chain starts the borrower at zero, with no portable score and no verifiable record of past performance. Existing credit systems are also opaque about inputs and trust a reporter to be honest. TRU addresses the portability and verifiability gaps together.

## 2. The Insight

Do not move the history. Prove it. Instead of copying a score or asking an oracle to report what happened, TRU has a Creditcoin contract cryptographically verify that a specific loan repayment transaction was included in an attested source block. The fact arrives self-certifying, not reported.

## 3. How TRU Works

A borrower repays a loan on Ethereum Sepolia through `SourceLoanMarket`, which emits `LoanRepaid` or `LoanCreated`. The TRU worker waits for Creditcoin to attest that Sepolia block, requests a Merkle plus continuity proof from the proof builder, and sanity checks it with the BlockProver precompile. The worker submits the proof to `TRUUniversalContract` on Creditcoin, which computes the transaction index, checks the replay guard, calls the native verifier `verifyAndEmit`, decodes the event from the verified transaction receipt, checks that the emitter is the configured `SourceLoanMarket`, and forwards the verified fields to `TRUCreditRegistry`. The registry enforces replay and duplicate guards, updates the borrower's profile, appends a `VerifiedFinancialEvent`, and updates loan lifecycle state. Downstream consumers like `TRUFinancing` read that already-verified state. No claims are made beyond what the verifier and emitter checks have proven.

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
      │  tx hash                                 │ on any tampered byte
      ▼                                          │
 worker (off-chain, infrastructure only)          │
  polls /api/v1/attested-height/1                 │
  ProofBuilder.getProof(txHash)                   │
  ───────── USC proof ───────────────────────►    │
                                    ┌────────────┴────────────────┐
                                    │ TRUUniversalContract        │
                                    │ processedQueries[queryId]   │
                                    │ decode LoanCreated/        │
                                    │ LoanRepaid, check emitter │
                                    │ == SourceLoanMarket         │
                                    └───────┬──────────┬──────────┘
                                            │          │
                                   LoanCreated         LoanRepaid
                                            │          │
                         recordVerified      │          │  recordVerified
                         LoanOrigination     │          │  Repayment
                                            ▼          ▼
                                   TRUCreditRegistry (CC3)
                                    loanStatus ACTIVE/REPAID
                                    outstandingObligations
                                    profiles: repayments, totalRepaid, creditLimit
                                    borrowerEvents: VerifiedFinancialEvent[]
                                    getCreditEvidence / getCreditPassport
                                            │
                                            ▼
                                    TRUFinancing (CC3) — downstream consumer
                                     reads getCreditEvidence, gates requestFinancing
                                     on creditState >= BUILDING and amount <= creditLimit
                                     records FinancingRequest, no disbursement
```

Current contract set: `SourceLoanMarket` (Sepolia), `TRUUniversalContract` (CC3, verification only), `TRUCreditRegistry` (CC3, credit logic only), `TRUFinancing` (CC3, consumer of verified state). The worker relays proof bytes only and never decides what gets credited.

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

Current deployment is phase 10, which supersedes earlier phase addresses. The deployment files under `contracts/deployments` are the single source of truth and are loaded by the worker at runtime. `SourceLoanMarket` is redeployed fresh on each `deploy-production.mjs` run.

| Component | Chain | Address | ChainId / chainKey |
| --- | --- | --- | --- |
| SourceLoanMarket | Ethereum Sepolia | `0x9013c573Ca23450456E7091d369E79BC7803E72A` | chainId `11155111`, chainKey `1` on CC3 Testnet |
| TRUCreditRegistry | Creditcoin CC3 Testnet | `0x0Eed154cf8c024d7f16D1c5856EC71E34aCebc5b` | chainId `102031` |
| TRUUniversalContract | Creditcoin CC3 Testnet | `0x8BF244FEf53060e262de699D099C649cF3Bf14D9` | chainId `102031`; decoder `0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f` |
| TRUFinancing | Creditcoin CC3 Testnet | `0xf5180eD8244a8B25F6F100EA0ccD5e1a727354a6` | chainId `102031`; registry `0x0Eed…` |

ChainKeys are per environment; on CC3 Testnet `chainKey 1 = Sepolia` and `chainKey 3 = Ethereum mainnet`, queried via `getSupportedChains` rather than hardcoded. The BlockProver precompile is `0x0000000000000000000000000000000000000FD2` and ChainInfo is `0x0000000000000000000000000000000000000fd3`.

## 10. Proven Results

Three-plus independent live end-to-end runs plus the attestation timing diagnostic show the same pipeline succeeding:

* Phase 0 spike: Sepolia `0xbd0cdaf5…` block `11497681` -> `SpikeConsumer.execute` tx `0x784bdffd…` block `5317027` verifiedCount `1`.
* Phase 4 pipeline: loan 0 creation `0x60e6e5c8…` block `11498016` and repayment `0x98c2040d…` block `11498018` -> `TRUUniversalContract.execute` `0xd55830a2…` block `5317198` -> `repayments 1`.
* Phase 6 credit logic: repayment `0x9f4ec67d…` block `11503185` -> submit `0xea7808a4…` block `5321469` -> `creditLimit 0 -> 100`.
* Attestation timing: three runs with repay `0x10dc15…` block `11503274`, `0x51556a…` block `11503321`, `0x770251…` block `11503369`, each `+1` repayment and `creditLimit 200/300/400`, cold waits `499.9s, 549.0s, 450.9s`.
* Phase 10 full chain described in section 6: origination `0x74d0e459…` and repayment `0xc21ea7d1…` leading to `BUILDING / 1 / 100` and financing `0xa81174…`.

Forge test count as of phase 10: `54 passing` (7 `SourceLoanMarket`, 8 `TRUUniversalContract`, 33 `TRUCreditRegistry`, 6 `TRUFinancing`) with `foundry.toml` solc `0.8.28`, `via_ir true`, `optimizer 200`. The specific verified state transitions observed in live tests are `repayments 0 -> 1` with `creditLimit 0 -> 100`, then `1 -> 2 -> 3 -> 4` with `100 -> 200 -> 300 -> 400` across the timing runs, and the phase 10 origination `ACTIVE` with `outstanding 1` then repayment `REPAID` with `outstanding 0`.

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

Current phase 10 deployment only, both chains. Previous phase addresses are superseded by the redeploy.

| Contract | Chain | Address | Deploy Tx |
| --- | --- | --- | --- |
| SourceLoanMarket | Sepolia (`11155111`) | `0x9013c573Ca23450456E7091d369E79BC7803E72A` | `0xa41f3ea3ce8d5bc51b4b7696fc080a5ac026db3eb81e5bf6f146d59b1f17a874` |
| TRUCreditRegistry | CC3 (`102031`) | `0x0Eed154cf8c024d7f16D1c5856EC71E34aCebc5b` | `0x1db4f64cd9b96bf076af5ff0696351cc6eceb2eb1afd550fcb419a9ceb92bcbf` |
| TRUUniversalContract | CC3 (`102031`) | `0x8BF244FEf53060e262de699D099C649cF3Bf14D9` | `0x748597853c630ed3b27b7447b4cc549ed4ae9dd9b5277f74cb4ea3eb427bd2ba` |
| TRUFinancing | CC3 (`102031`) | `0xf5180eD8244a8B25F6F100EA0ccD5e1a727354a6` | `0x3725187fb016cf1ef58fd9f323fe504fc4a0b8aad6f4e83a68ed08c3f11d5fe4` |
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

This deploys `SourceLoanMarket` to Sepolia, then `TRUCreditRegistry` and `TRUUniversalContract` to CC3, and configures `TRUCreditRegistry.setUniversalContract`. `TRUFinancing` is deployed separately after that with `registry` as constructor arg; see `contracts/src/creditcoin/TRUFinancing.sol` and the ad-hoc deploy snippet used in phase 10.

Worker (real USC pipeline):

```
# Sepolia RPC and Creditcoin RPC plus proof builder are in creditcoin/.env:
# SOURCE_RPC_URL, SEPOLIA_PRIVATE_KEY, CREDITCOIN_RPC_URL, CREDITCOIN_PRIVATE_KEY, PROOF_BUILDER_URL

# process a single repayment or origination
node creditcoin/src/worker.mjs --tx <sepoliaTxHash>

# listen from a block
node creditcoin/src/worker.mjs --from-block <N> --process-count 1
```

The worker loads ABIs and addresses from `contracts/deployments/*`, waits for attestation via `ProofBuilder.waitUntilHeightAttested`, builds the proof via `getProof`, sanity checks with `PrecompileBlockProver.verifySingle`, and submits to `TRUUniversalContract.execute` or `executeLoanOrigination`.

Driver (source chain helper):

```
node creditcoin/src/driver.mjs --create
node creditcoin/src/driver.mjs --repay <loanId>
node creditcoin/src/driver.mjs   # create + repay in one
```

Explorer links are `https://sepolia.etherscan.io/tx/<hash>` for Sepolia transactions and `https://creditcoin-testnet.blockscout.com/tx/<hash>` for CC3 transactions as recorded in `docs/usc-research.md` for CC3.
