# TRU — Project Constitution

## What this is
TRU turns verified financial behavior on any supported blockchain into reusable 
on-chain credit history on Creditcoin. First demo: a borrower repays a loan on 
Ethereum Sepolia → Creditcoin USC (Universal Smart Contracts) cryptographically 
verifies that repayment → TRU records it on Creditcoin → the borrower's credit 
profile updates.

## Hard rules — never violate these
1. NEVER build a fake or simulated "verification" layer. All repayment facts 
   must flow through real Creditcoin USC proof verification. If USC integration 
   isn't working yet, say so explicitly — do not stub it with a fake success path 
   and move on silently.
2. NEVER let business logic (credit scoring) run before USC verification confirms 
   the source-chain event. Verification gates everything.
3. NEVER accept repayment data from a frontend, backend API, or manual input as 
   truth. The only valid source of truth is a USC-verified event.
4. NEVER use an AI/black-box credit score. Credit logic must be deterministic and 
   explainable in one sentence (e.g. "base $100, +$100 per verified repayment").
5. NEVER let the same source-chain event (same txHash + logIndex, or same USC 
   query ID) be credited twice. Replay protection is mandatory.
6. Keep strict separation across three components — do not merge their 
   responsibilities:
   - SourceLoanMarket (Ethereum Sepolia): emits LoanRepaid events. Knows nothing 
     about Creditcoin or TRU.
   - TRUUniversalContract (Creditcoin): receives proofs, asks the native USC 
     verifier to verify, extracts the verified event. Contains NO credit logic.
   - TRUCreditRegistry (Creditcoin): receives only verified events, updates 
     credit profiles. Contains NO proof/verification logic.

## Code standards
- All NEW off-chain JavaScript/TypeScript code (frontend, new scripts, new 
  tooling) must be written in TypeScript (.ts/.tsx), not plain JS/.mjs.
- Existing working .mjs files (worker.mjs, deploy-production.mjs, 
  prove-and-verify.mjs, security-tests.mjs, and similar proven/tested files) 
  are NOT to be migrated to TS. They are stable and evidenced — do not touch 
  them for a language-only rewrite. Only modify them for actual functional 
  changes, and even then keep the existing file as .mjs unless a functional 
  change already requires touching most of the file.
- This rule applies going forward from this point in the project, not 
  retroactively.

## Build order (do not reorder)
1. Integration spike: prove a real Ethereum event can be verified through USC 
   and consumed by a Creditcoin contract, before writing any application code.
2. Prove fake/tampered/replayed data is rejected by the pipeline.
3. Build the three contracts (see rule 6).
4. Wire the full pipeline: event → worker → proof → USC → registry.
5. Security hardening: replay protection, borrower binding, loan binding, 
   amount integrity, duplicate protection.
6. Credit logic (deterministic).
7. Whatever comes after credit logic — to be defined.

## When in doubt
Stop and ask rather than assume SDK behavior, contract interfaces, or endpoint 
names — reference docs, don't guess. If a step in the build order isn't done yet, 
do not skip ahead to a later step. 
