import type { HistorySummary, LedgerEntry, MonthDatum, StageDatum } from "./types";

/* Live entries come from frontend/src/chain.ts (on-chain registry reads).
 * The helpers below derive dashboard metrics from entries only,
 * no invented numbers. Mirrors the on-chain derivation style
 * (distinct refs, completion ratio).
 */
export function summarizeHistory(entries: LedgerEntry[]): HistorySummary {
  const verified = entries.filter((e) => e.status === "verified");
  const createdRefs = new Set(
    verified.filter((e) => e.kind === "obligation-created").map((e) => e.ref)
  );
  const completedRefs = new Set(
    verified.filter((e) => e.kind === "obligation-completed").map((e) => e.ref)
  );
  const completed = [...completedRefs].length;
  const active = [...createdRefs].filter((r) => !completedRefs.has(r)).length;
  const settlementVolumeUsd = verified
    .filter((e) => e.kind === "obligation-completed")
    .reduce((sum, e) => sum + e.valueUsd, 0);
  const verifiedObligations = new Set([...createdRefs, ...completedRefs]).size;
  return {
    verifiedEvents: verified.length,
    verifiedObligations,
    completedObligations: completed,
    activeObligations: active,
    settlementVolumeUnits: settlementVolumeUsd,
    sourceChains: new Set(verified.map((e) => e.chain)).size,
    completionRatePct: verifiedObligations === 0 ? 0 : Math.round((completed / verifiedObligations) * 100),
  };
}

// Real, sparse, honest: TRU is early-stage, so the chart is early-stage too.
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
