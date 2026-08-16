# TRU — Judge QA Prep

Prep sheet for live, adversarial questioning at the demo table. Format is
question, then the answer as you would actually say it out loud. Every answer
is grounded in the real deployed system. Where the honest answer is "that is a
real limitation we are aware of," that is exactly what it says.

---

## 1. "Why do you need Creditcoin/Attestcoin at all? Couldn't you just use an oracle?"

A Creditcoin contract cannot see Ethereum, so someone has to deliver the
repayment fact. An oracle delivers it as a report, which turns the integrity of
the whole credit history into trust in whoever runs that relay. Attestcoin
makes the fact self-certifying: our contract checks a Merkle proof that the
repayment transaction was included in an attested Sepolia block, and the
borrower, loan, and amount are decoded from those verified bytes. Nobody in the
delivery path can change those values without breaking the proof, so we never
have to decide whether to believe a reporter. This is not zero trust: we still
trust SourceLoanMarket's logic, the deployer key, and Creditcoin's attestation.
What is eliminated is trust in the delivery path, which is exactly where an
oracle would sit.

## 2. "What happens if Creditcoin's attestation service goes down or is slow?"

The slow case is the normal case: attestation trails Sepolia by about 35 blocks
structurally, so every fresh repayment waits 7 to 9 minutes before a proof can
even be built. If the service actually goes down, the worker waits on a timeout
and the repayment just stays in a pending state; nothing gets credited. That is
the design, not a failure mode: verification gates every write, so an outage
means no new credit is written, but it also means no credit can ever be written
on an unverified event. When the service returns, pending repayments process.

## 3. "Your demo took 8 minutes to verify — is that a real limitation?"

Yes, it is real and structural. Creditcoin attests Sepolia blocks about 35
blocks deep behind the head, advancing in 10-block batches at Sepolia's own
block rate, so a freshly mined repayment waits 7 to 9 minutes. We measured it
across five runs and it is consistent. It is predictable in advance, because
you can read the attested-height gap and estimate the remaining wait, but it is
not something we can accelerate. For the demo we repay early and let attestation
pass the block while the user does the other steps, so the verification stage
itself completes in seconds. It is a genuine UX constraint we are designing
around, not something we paper over.

## 4. "How do I know your SourceLoanMarket contract isn't just designed to make your demo work, versus being a real lending pattern?"

SourceLoanMarket is deliberately minimal, and that is the point: TRU treats the
source contract as a black box that emits truthful events. It does enforce the
real lending invariants: principal must be positive, the due date must be in
the future, and repayment requires the loan to be active, owned by the caller,
and paid with a positive value. But honestly, it is demo-grade lending code, not
a battle-tested lending protocol. The claim TRU makes is narrower: whatever the
source contract emits, Creditcoin verifies it cryptographically. TRU binds to
the emitter address and the event signature, not to this contract's internals,
so swapping in a real lending contract that emits the same event works with no
pipeline changes.

## 5. "What stops you, the deployer, from just calling a function and giving yourself unlimited credit?"

Inside the running system, nothing is callable to do that. The registry's only
write path is `recordVerifiedRepayment`, which only the universal contract can
call, and that contract's `execute` accepts only proof bytes, with no borrower,
loan, or amount parameters. The only way to credit anyone is to submit a real
USC proof of a real repayment, which means actually repaying on Sepolia. The
honest caveat is the deployer owns the contracts and could redeploy them, which
is an owner-governance limit, not a cryptographic one. That is a standard trust
assumption for any owned contract, and we state it rather than hide it.

## 6. "This is testnet only — what would break moving to mainnet?"

The pipeline itself is environment-agnostic: it loads addresses and ABIs from
deployment files, and the chainKey mapping is queried rather than hardcoded, so
the code path does not change. What changes is configuration and threat model:
a different proof-builder endpoint and decoder address on mainnet, real gas
costs on both chains, and a re-check of the deployed decoder quirk we work
around on the testnet. The bigger change is economic: on testnet the self-loan
gap costs nothing real, but on mainnet it becomes an actual attack, so that has
to be fixed before mainnet is meaningful. And the source lending contract would
need a real audit, since TRU inherits the truthfulness of whatever emits the
events.

## 7. "Why is activeLoans missing from the credit profile?"

Because it was an unimplemented stub. The original struct declared an
`activeLoans` field, but nothing ever wrote to it, so the public getter would
always have returned 0 as if it were data. We removed it from the struct, the
ABI, the worker log, and the tests, and redeployed, rather than ship a field
that reads zero as if it meant something. `profiles()` now returns exactly
`repayments`, `totalRepaid`, and `creditLimit`, all of which are actually
written. Real active-loan accounting needs a loan-creation and maturity feed
that is outside the current scope, and we did not want to fake it.

## 8. "What's stopping someone from creating a loan and repaying it to themselves in a loop to inflate their own credit limit?"

Nothing, and that is a known limitation, not something we will spin. Anyone can
call `createLoan` and get a loanId for themselves, then repay it with one wei;
the duplicate guard only blocks re-crediting the same loanId, and loanIds are
unlimited, so a loop of create-and-repay bumps `repayments` and therefore
`creditLimit` by 100 per iteration at a cost of roughly gas plus a wei. The
credit rule counts verified repayments, and today the source market lets a
borrower be their own lender. Fixing it requires the source contract to prove
that an external lender actually funded the loan, or the credit rule to scale
with repayment size relative to principal, and neither can be inferred from the
repayment event alone. We flag this explicitly because it is the real economic
hole in the current design.

## 9. "Is this actually different from a bridge?"

Yes. A bridge moves an asset, or a representation of it, across chains and
usually asks you to trust its validators. TRU moves no asset at all: no tokens
cross between chains, there is no wrapped token, no mint or burn. What moves is
a fact, in the form of a proof, and that proof is verified on Creditcoin by the
native precompile before it updates credit state that lives only on Creditcoin.
The proof-of-inclusion machinery is bridge technology, but the semantics are
not a transfer; it is a cryptographically verified attestation of an event on
another chain.

## 10. "What would you build next with more time?"

First, close the self-loan gap, because it is the real economic hole: require
the source contract to prove external funding, or change the credit rule to
scale with repayment relative to principal. Second, mainnet readiness: per-
environment configuration and a real audit of the source lending contract.
Third, the frontend, which is the actual current gap in the build order,
designed around the measured 8-minute pending window with a live countdown
derived from the attested-height gap. Then real active-loan accounting, and
finally support for more source chains, since Attestcoin already supports
Ethereum mainnet and the pipeline is not Sepolia-specific.

---

## Additional questions we anticipate

### "Anyone can call execute — what stops spam or griefing?"

Anyone can submit any proof, but a submission only credits if it is a verified
`LoanRepaid` emitted by the configured source contract. A failed verification
costs the submitter gas and changes nothing, and the replay guard means each
event is credited exactly once no matter how many times it is submitted. There
is no path to spam yourself or someone else into credit.

### "Couldn't you just point the universal contract at a fake source contract that emits whatever you want?"

Technically yes, and it is owner-only to change, so it is the same
governance-trust caveat as the deployer question: we explicitly list the source
contract's logic as one of the three things we trust. Pointing the emitter
binding at a liar contract is an owner decision, which is equivalent to an
oracle operator choosing a bad feed. The guarantee is conditional: if the
source contract's logic is sound, no one in the delivery path can inject a
false fact.

### "How do I know the proof is real and not mocked?"

There is no mocked path in the final pipeline. The proof comes from Gluwa's
live proof-builder service for the testnet, and it is verified on-chain by the
native BlockProver precompile, which is a runtime component of the Creditcoin
chain, not our code. The adversarial tests show the observable signal: tamper
with any byte of the transaction and the precompile itself reverts with
"Merkle proof validation failed" before any state changes. Everything in the
final path is either a live testnet deployment or inherited, real
infrastructure.