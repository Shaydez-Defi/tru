# TRU Documentation Index

Short guide to what each major document is for. Start with `README.md`.

- `README.md`, entry point: positioning, how it works, architecture,
  live testnet evidence, testing, run instructions, limitations, addresses.
- `docs/PRODUCT_ARCHITECTURE.md`, product mapping: primitive, human/agent
  histories, Agent Passport definition, claims audit (claim now / carefully /
  do not claim), canonical narrative.
- `docs/ENGINE_AUDIT.md`, code-level audit of the shared five-step
  verification primitive, history storage, passport derivations, test results.
- `docs/VERIFIABLE_ECONOMIC_HISTORY.md`, the obligation extension: design,
  trust model, tests, live verification with exact hashes and blocks.
- `docs/SECURITY_AUDIT.md`, full security audit: trust model, verification
  boundary, access control, replay/duplicate protection, findings
  (no Critical/High), explicit trust assumptions.
- `docs/ATTESTCOIN-INTEGRATION.md`, judge-facing deep dive on the loan path:
  why Attestcoin is load-bearing, SDK calls, attestation timing, tamper
  walkthrough, oracle comparison. Addresses dated 2026-08-16, superseded,   see README §15.
- `docs/JUDGE-QA-PREP.md`, spoken answers to adversarial demo questions.
- `docs/DECK-CONTENT.md`, slide-by-slide pitch outline with screenshot
  placeholders.
- `docs/phase-*.md`, per-phase build logs (point-in-time records; phase 0,
  4–10). `docs/attestation-timing.md`, cold-attestation diagnostic.
  `docs/usc-research.md`, protocol/network reference.
  `docs/audit-vs-spec.md`, point-in-time acceptance audit (see its addendum;
  superseded in part).

Canonical sources:

- Product definition: `docs/PRODUCT_ARCHITECTURE.md` §1.
- Architecture: `README.md` §5 (diagram), `docs/ENGINE_AUDIT.md` §1 (code evidence).
- Security status: `docs/SECURITY_AUDIT.md`.
- Live testnet evidence: `README.md` §6; full detail in
  `docs/VERIFIABLE_ECONOMIC_HISTORY.md` §6 and `docs/phase-10-financing-primitive.md`.
- Current limitations: `README.md` §13 (mirrored in the audits).
