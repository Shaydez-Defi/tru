import { useEffect, useState } from "react";
import { Contract, JsonRpcProvider } from "ethers";
import type { LedgerEntry } from "./types";
import registryMeta from "../../contracts/deployments/creditcoin/TRUCreditRegistry.json";
import loanMarketMeta from "../../contracts/deployments/sepolia/SourceLoanMarket.json";
import obligationMarketMeta from "../../contracts/deployments/sepolia/SourceObligationMarket.json";

/* ── Configuration (public endpoints only; no secrets) ─────── */

export const SEPOLIA_RPC_URL =
  import.meta.env.VITE_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
export const CC3_RPC_URL =
  import.meta.env.VITE_CC3_RPC_URL ?? "https://rpc.cc3-testnet.creditcoin.network";
export const PROOF_BUILDER_URL =
  import.meta.env.VITE_PROOF_BUILDER_URL ?? "https://prover.cc3-testnet.creditcoin.network";

export const SEPOLIA_CHAIN_ID = 11155111;
export const CC3_CHAIN_ID = 102031;
/** chainKey 1 = Sepolia on CC3 testnet (per getSupportedChains). */
export const SEPOLIA_CHAIN_KEY = 1;

export const REGISTRY_ADDRESS: string = registryMeta.address;
export const LOAN_MARKET_ADDRESS: string = loanMarketMeta.address;
export const OBLIGATION_MARKET_ADDRESS: string = obligationMarketMeta.address;

/** Demo borrower with real verified on-chain history, shown when no wallet is connected. */
export const SAMPLE_ACTOR_ADDRESS = "0x2b374aDd4b86Ab1bf6196D1f698Eeb77156aA0F0";

/* ── Providers & contracts (read-only) ─────────────────────── */

const sepoliaProvider = new JsonRpcProvider(SEPOLIA_RPC_URL);
const ccProvider = new JsonRpcProvider(CC3_RPC_URL);

const registry = new Contract(REGISTRY_ADDRESS, registryMeta.abi, ccProvider);

/* ── Formatting helpers ────────────────────────────────────── */

export function truncateAddress(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

export function truncateHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 6)}...${hash.slice(-4)}` : hash;
}

export function formatVerifiedAt(timestampSec: bigint | number): string {
  const d = new Date(Number(timestampSec) * 1000);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatMonthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
}

export interface MonthBucket {
  label: string;
  count: number;
}

/** Bucket verified entries into the last 6 calendar months (oldest → newest). */
export function bucketByMonth(entries: LedgerEntry[]): MonthBucket[] {
  const now = new Date();
  const buckets: MonthBucket[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ label: formatMonthLabel(d), count: 0, key: `${d.getFullYear()}-${d.getMonth()}` } as MonthBucket & { key: string });
  }
  for (const e of entries) {
    if (e.status !== "verified") continue;
    const t = Date.parse(e.date);
    if (Number.isNaN(t)) continue;
    const d = new Date(t);
    const idx = buckets.findIndex(
      (b, bi) =>
        b.label === formatMonthLabel(d) &&
        // disambiguate same month name across years via position from the end
        bi >= buckets.length - 1 - (now.getFullYear() * 12 + now.getMonth() - (d.getFullYear() * 12 + d.getMonth()))
    );
    if (idx >= 0) buckets[idx].count += 1;
  }
  return buckets.map(({ label, count }) => ({ label, count }));
}

/* ── Registry reads ────────────────────────────────────────── */

export interface CreditEvidenceData {
  creditState: number;
  repayments: bigint;
  totalRepaid: bigint;
  creditLimit: bigint;
  distinctLoansRepaid: bigint;
}

export interface AgentPassportData {
  verifiedObligations: bigint;
  completedObligations: bigint;
  failedObligations: bigint;
  activeObligations: bigint;
  verifiedSettlementVolume: bigint;
  verifiedSourceChains: bigint[];
  completionRateBps: bigint;
}

export async function fetchCreditEvidence(borrower: string): Promise<CreditEvidenceData> {
  const ev = await registry.getCreditEvidence(borrower);
  return {
    creditState: Number(ev.creditState),
    repayments: BigInt(ev.repayments),
    totalRepaid: BigInt(ev.totalRepaid),
    creditLimit: BigInt(ev.creditLimit),
    distinctLoansRepaid: BigInt(ev.distinctLoansRepaid),
  };
}

export async function fetchOutstandingObligations(borrower: string): Promise<bigint> {
  return BigInt(await registry.getOutstandingObligations(borrower));
}

export async function fetchAgentPassport(subject: string): Promise<AgentPassportData> {
  const p = await registry.getAgentPassport(subject);
  return {
    verifiedObligations: BigInt(p.verifiedObligations),
    completedObligations: BigInt(p.completedObligations),
    failedObligations: BigInt(p.failedObligations),
    activeObligations: BigInt(p.activeObligations),
    verifiedSettlementVolume: BigInt(p.verifiedSettlementVolume),
    verifiedSourceChains: (p.verifiedSourceChains as bigint[]).map((c) => BigInt(c)),
    completionRateBps: BigInt(p.completionRateBps),
  };
}

const LOAN_EVENT_NAMES = ["Loan originated", "Repayment verified"] as const;
const OBLIGATION_EVENT_NAMES = ["Obligation created", "Obligation completed"] as const;

/**
 * Loans move native SepoliaETH (repayLoan is payable; amount = msg.value wei),
 * so loan amounts render as SepoliaETH. Obligations carry raw "agreed units"
 * per SourceObligationMarket with no guaranteed denomination, so they render
 * raw with no currency claim.
 */
export function formatLoanAmount(wei: string): { text: string; eth: number } {
  const eth = Number(BigInt(wei)) / 1e18;
  if (!Number.isFinite(eth)) return { text: `${wei} wei`, eth: NaN };
  if (eth !== 0 && Math.abs(eth) < 0.000001) return { text: `${wei} wei`, eth };
  const shown = String(Math.round(eth * 1e6) / 1e6);
  return { text: `${shown} SepoliaETH`, eth };
}

/**
 * Settlement volume has no guaranteed denomination (obligation values are raw
 * "agreed units"), so it renders grouped with a units label and no currency.
 */
export function formatUnits(value: number | bigint): string {
  return `${Number(value).toLocaleString("en-US")} settlement units`;
}

function mapLoanEvent(raw: Record<string, unknown>, borrower: string): LedgerEntry {
  const eventType = Number(raw.eventType);
  const loanId = String(raw.loanId);
  const amount = String(raw.amount);
  const txHash = String(raw.sourceTxHash);
  const pretty = formatLoanAmount(amount);
  return {
    event: LOAN_EVENT_NAMES[eventType] ?? "Loan event",
    amount: pretty.text,
    valueUsd: pretty.eth,
    ref: `#${loanId}`,
    refKind: "loan",
    kind: eventType === 1 ? "origination" : "repayment",
    domain: "loan",
    date: formatVerifiedAt(raw.verifiedAt as bigint),
    chain: "Ethereum Sepolia",
    tx: truncateHash(txHash),
    fullTxHash: txHash,
    sourceBlock: String(raw.sourceBlock),
    borrower,
    status: "verified",
    sample: false,
  };
}

function mapObligationEvent(raw: Record<string, unknown>): LedgerEntry {
  const eventType = Number(raw.eventType);
  const obligationId = String(raw.obligationId);
  const value = String(raw.value);
  const txHash = String(raw.sourceTxHash);
  const completed = eventType === 1;
  return {
    event: completed ? "Obligation completed" : "Obligation created",
    amount: `${value} units`,
    valueUsd: Number(value),
    ref: `#${obligationId}`,
    refKind: "obligation",
    kind: completed ? "obligation-completed" : "obligation-created",
    domain: "obligation",
    date: formatVerifiedAt(raw.verifiedAt as bigint),
    chain: "Ethereum Sepolia",
    tx: truncateHash(txHash),
    fullTxHash: txHash,
    sourceBlock: String(raw.sourceBlock),
    status: "verified",
    sample: false,
  };
}

/** Combined verified history (loans + obligations), most recent first. */
export async function fetchVerifiedHistory(subject: string): Promise<LedgerEntry[]> {
  const PAGE = 50;
  const [loanEvents, obligationEvents] = await Promise.all([
    registry.getEvents(subject, 0, PAGE) as Promise<Record<string, unknown>[]>,
    registry.getObligationEvents(subject, 0, PAGE) as Promise<Record<string, unknown>[]>,
  ]);
  const mapped = [
    ...loanEvents.map((e) => mapLoanEvent(e, subject)),
    ...obligationEvents.map((e) => mapObligationEvent(e)),
  ];
  // Order by source block descending (most recent first).
  mapped.sort((a, b) => Number(b.sourceBlock ?? 0) - Number(a.sourceBlock ?? 0));
  return mapped;
}

/* ── Attestation status (live network state) ───────────────── */

export interface AttestationStatus {
  sepoliaHead: number;
  attestedHeight: number;
  gapBlocks: number;
  estimatedWaitSec: number;
}

async function fetchAttestedHeight(): Promise<number> {
  const res = await fetch(`${PROOF_BUILDER_URL}/api/v1/attested-height/${SEPOLIA_CHAIN_KEY}`);
  if (!res.ok) throw new Error(`attested-height HTTP ${res.status}`);
  const body = (await res.json()) as { attestedHeight: number | string };
  return Number(body.attestedHeight);
}

export async function fetchAttestationStatus(): Promise<AttestationStatus> {
  const [head, attested] = await Promise.all([
    sepoliaProvider.getBlockNumber(),
    fetchAttestedHeight(),
  ]);
  const gap = Math.max(0, head - attested);
  return {
    sepoliaHead: head,
    attestedHeight: attested,
    gapBlocks: gap,
    estimatedWaitSec: gap * 12,
  };
}

/* ── Async data hook ───────────────────────────────────────── */

export interface AsyncData<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useAsyncData<T>(fn: () => Promise<T>, deps: unknown[]): AsyncData<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fn()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Unavailable");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // deps are caller-controlled (address / refresh key)
  }, deps);

  return { data, loading, error };
}
