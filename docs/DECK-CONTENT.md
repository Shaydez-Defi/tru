# TRU — Deck Content

Slide-by-slide content for the hackathon submission deck. Text only, as a
presenter would speak it. Frontend screenshots are not ready; slides that will
carry them are marked with `[SCREENSHOT: ...]` placeholders.

---

## Slide 1 — Title

**TRU**

- Verified on-chain behavior becomes portable credit history on Creditcoin.
- Repay on Ethereum, get verified credit on Creditcoin.
- Track: DeFi

---

## Slide 2 — The problem

**Credit history is stranded on one chain**

- Alice repays loans reliably on Ethereum. That history earns her nothing anywhere else.
- She moves to another chain and starts from zero: no score, no limit, no history.
- A chain cannot see the other chain, so good behavior on one network never becomes credit on another.
- Credit today is also opaque: someone else decides, and you cannot verify the inputs.

---

## Slide 3 — What TRU does

**Repay on any chain. Get verified credit on Creditcoin.**

- Alice repays a loan on Ethereum Sepolia.
- Creditcoin cryptographically verifies that repayment actually happened, on-chain.
- Her credit profile on Creditcoin updates: repayments +1, credit limit grows by a fixed amount per verified repayment.

Demo beat (before/after):

- Before: `repayments=0, creditLimit=$0`
- After one verified repayment: `repayments=1, creditLimit=$100`
- After three: `creditLimit=$300`
- The rule is deterministic and readable on-chain: `creditLimit = 0 + repayments × 100`.

---

## Slide 4 — Architecture

**A proof flows from Sepolia to Creditcoin; only verified facts reach the credit registry**

```
Sepolia                    Creditcoin (CC3 testnet)
─────────                   ───────────────────────────
SourceLoanMarket            BlockProver precompile (native)
  repayLoan() emits            ▲ verifyAndEmit(proof)
  LoanRepaid(borrower,loanId,amount)
        │ tx hash            │
        ▼                     │
  worker (off-chain relay)    │  TRUUniversalContract
  waits for attestation ─── USC proof ───►  verifies proof, decodes
  builds Merkle proof                           LoanRepaid from verified bytes
                                               checks emitter == SourceLoanMarket
                                                │
                                                ▼
                                  TRUCreditRegistry
                                  replay + duplicate guards
                                  repayments += 1, totalRepaid += amount
                                  creditLimit = 0 + repayments × 100
```

- The worker relays proof bytes only. It never decides who gets credit.
- The registry accepts only verified events. No borrower, loan, or amount is ever passed in as a parameter.
- Separation by design: source market emits, universal contract verifies, registry scores.

---

## Slide 5 — Why Attestcoin is load-bearing

**Remove Attestcoin, does it still work? No.**

- A Creditcoin contract cannot see Ethereum, so the repayment fact must arrive somehow.
- Without Attestcoin, the only options are: someone reports it (forgeable), or an oracle relays it (trust the relay).
- Attestcoin replaces reporting with proof: the contract checks a Merkle proof that the repayment tx was in an attested Sepolia block, then decodes the values from those verified bytes.
- Nobody in the delivery path can change the amount, borrower, or loan ID without breaking the proof. The fact arrives self-certifying, not reported.
- This is not zero trust. We still trust the source contract's logic, the deployer key, and Creditcoin's attestation. What we eliminate is trust in the delivery path.

---

## Slide 6 — Security

**Every property is enforced either by construction or by an explicit check**

| Property | How it is enforced |
| --- | --- |
| Replay protection | Same proof resubmitted reverts: "Query already processed". Guards on both the universal contract and the registry. |
| Borrower binding | No borrower input exists. Borrower is decoded from the verified transaction. Tampered borrower topic reverts at the precompile. |
| Loan binding | Verified event must be emitted by the configured SourceLoanMarket. Foreign emitter rejected. |
| Amount integrity | No amount input exists. Amount is decoded from the verified transaction. Tampered amount reverts: "Merkle proof validation failed". |
| Duplicate protection | A loan ID credits a profile once. Same loan via a different proof reverts: "Loan already credited". |

- Proof: 23 Forge tests passing, plus live end-to-end attacks rejected on the real testnet pipeline.

---

## Slide 7a — Demo: Borrow

`[SCREENSHOT: Borrow screen, borrower creating a loan on Sepolia, showing loan created + event emitted]`

- Alice creates a loan on the source market.
- Bullets the presenter speaks:
  - Loan created on Ethereum Sepolia. Note the `LoanRepaid` event that follows.
  - This is the real transaction, no simulation.

---

## Slide 7b — Demo: Repay and pending verification

`[SCREENSHOT: Repay screen showing tx confirmed, then "verification pending ~8 min" with a live countdown]`

- Alice repays the loan.
- Bullets the presenter speaks:
  - Repayment confirmed on Sepolia.
  - Creditcoin attests Sepolia blocks about 35 deep behind the head, so a fresh repayment waits roughly 7-9 minutes for verification.
  - This is a structural property of the network, predictable but not reducible. The pending state shows a live countdown derived from the attested-height gap.

---

## Slide 7c — Demo: Credit profile with proof

`[SCREENSHOT: Credit Profile screen, repayments=1, totalRepaid, creditLimit=$100, with the verified proof / tx links]`

- Profile updated on Creditcoin.
- Bullets the presenter speaks:
  - `repayments=1, creditLimit=$100` after one verified repayment.
  - The profile is on-chain, readable by anyone via `profiles(borrower)`.
  - The verification tx and source repayment are public on both explorers.

---

## Slide 8 — Honest limitations, as what's next

- **Testnet today.** Live on Sepolia and Creditcoin CC3 testnet. The path to mainnet is configuration plus the fixes below, not redesign.
- **Self-loan gap.** Today a borrower can create and repay a loan to themselves and earn credit. We flag it as a known limitation and it is first on the fix list: require external funding on the source contract, or scale credit with repayment relative to principal.
- **Pending state.** The ~8 minute verification window is real. We design for it with a live countdown rather than hiding it, and already-attested repayments verify in seconds.
- **No frontend yet.** The full backend pipeline is live and evidenced; the demo UI is the current work.

---

## Slide 9 — What's next

- **Close the self-loan gap**: source contract proves external funding; credit scales with repayment size relative to principal.
- **Mainnet path**: per-environment config (chainKey, proof builder, decoder), real audit of the source lending contract, re-check inherited decoder behavior on mainnet.
- **More source chains**: the pipeline is not Sepolia-specific. Attestcoin already supports Ethereum mainnet; any supported chain can emit repayment facts.
- **Portable credit**: any borrower's verified history becomes reusable collateral for lending decisions elsewhere on Creditcoin.
- CEIP alignment: TBD by team, fill in specific Creditcoin ecosystem initiative if pursuing one.

---

## Slide 10 — Team / ask

**TRU**

- Team: [names / handles]
- Built: three live contracts, a real USC-verified pipeline, 23 passing tests, live adversarial security evidence on testnet.
- Ask: [what the team is seeking, e.g. feedback on the credit model, pilot lending partners, path to mainnet support].