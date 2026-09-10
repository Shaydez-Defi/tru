import type { LedgerEntry, MonthDatum, StageDatum } from "./types";

/*
 * SAMPLE DATA — for UI demo only. None of these values are read from
 * on-chain contracts. Every entry is explicitly marked `sample: true`
 * and the UI labels sample surfaces as examples.
 */

export const ENTRIES: LedgerEntry[] = [
  { event: "Repayment verified", amount: "100 USDC", ref: "#42", refKind: "loan", domain: "loan", date: "Aug 15, 2026", chain: "Ethereum Sepolia", tx: "0x8f2a...c94d", status: "verified", sample: true },
  { event: "Repayment verified", amount: "250 USDC", ref: "#39", refKind: "loan", domain: "loan", date: "Jul 30, 2026", chain: "Ethereum Sepolia", tx: "0x3c91...4e0f", status: "verified", sample: true },
  { event: "Loan originated", amount: "350 USDC", ref: "#39", refKind: "loan", domain: "loan", date: "Jul 2, 2026", chain: "Ethereum Sepolia", tx: "0xa17b...992c", status: "verified", sample: true },
  { event: "Obligation completed", amount: "250 USDC", ref: "#7", refKind: "obligation", domain: "obligation", date: "Aug 11, 2026", chain: "Ethereum Sepolia", tx: "0x77aa...b3e1", status: "verified", sample: true },
  { event: "Obligation created", amount: "250 USDC", ref: "#7", refKind: "obligation", domain: "obligation", date: "Jul 28, 2026", chain: "Ethereum Sepolia", tx: "0x91cf...55d2", status: "verified", sample: true },
  { event: "Attestation pending", amount: "80 USDC", ref: "#45", refKind: "loan", domain: "loan", date: "Aug 19, 2026", chain: "Ethereum Sepolia", tx: "0x51d4...7b2a", status: "pending", sample: true },
];

// Real, sparse, honest — TRU is early-stage, so the chart is early-stage too.
export const MONTHS: MonthDatum[] = [
  { label: "MAR", count: 0 }, { label: "APR", count: 0 }, { label: "MAY", count: 0 },
  { label: "JUN", count: 0 }, { label: "JUL", count: 1 }, { label: "AUG", count: 1 },
];
export const MAX_COUNT: number = Math.max(1, ...MONTHS.map((m) => m.count));

export const STAGES: StageDatum[] = [
  { key: "submitted", label: "Submitted" },
  { key: "attesting", label: "Attesting" },
  { key: "proof", label: "Proof" },
  { key: "creditcoin", label: "Creditcoin" },
  { key: "done", label: "Verified" },
];

export const SOURCE_BLOCK = 11503369;
export const START_ATTESTED = 11503334;
export const BLOCK_TIME_SEC = 12;
export const TOTAL_GAP: number = SOURCE_BLOCK - START_ATTESTED;
