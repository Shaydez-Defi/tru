import type { ComponentType } from "react";

/* ── App shell ─────────────────────────────────────────────── */

export type ScreenName =
  | "landing"
  | "verifying"
  | "overview"
  | "credit"
  | "events"
  | "event-detail"
  | "protocol"
  | "connect";

export type NavigateFn = (screen: ScreenName) => void;

export interface ScreenProps {
  navigate: NavigateFn;
  active?: ScreenName;
  /** Connected wallet address, or null when not connected. */
  account: string | null;
  /** Event selected from a ledger, for the detail/tracking screens. */
  selectedEvent?: LedgerEntry | null;
  onSelectEvent?: (entry: LedgerEntry) => void;
  onConnect?: (address: string) => void;
}

export type IconComponent = ComponentType<{ size?: number }>;

export interface PipelineNodeDatum {
  label: string;
  meta: string;
  icon: IconComponent;
  pos: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}

/* ── UI ledger (sample data; see data.ts) ──────────────────── */

export type LedgerStatus = "verified" | "pending";
export type HistoryDomain = "loan" | "obligation";

export type LedgerEventKind =
  | "repayment"
  | "origination"
  | "obligation-created"
  | "obligation-completed"
  | "pending";

export interface LedgerEntry {
  event: string;
  amount: string;
  /** Numeric value behind `amount`, for aggregation (agreed units for obligations, SepoliaETH for loans, never USD). */
  valueUsd: number;
  /** Display reference, e.g. "#42" (loan) or "#7" (obligation). */
  ref: string;
  refKind: "loan" | "obligation";
  kind: LedgerEventKind;
  domain: HistoryDomain;
  date: string;
  chain: string;
  tx: string;
  status: LedgerStatus;
  /**
   * True for built-in demo rows; false for entries mapped from live
   * on-chain registry reads.
   */
  sample: boolean;
  /** Full source tx hash (live entries only), for explorer links. */
  fullTxHash?: string;
  /** Source block number as string (live entries only), for ordering. */
  sourceBlock?: string;
  /** Borrower address (live loan entries only). */
  borrower?: string;
}

export interface HistorySummary {
  verifiedEvents: number;
  verifiedObligations: number;
  completedObligations: number;
  activeObligations: number;
  settlementVolumeUnits: number;
  sourceChains: number;
  completionRatePct: number;
}

export interface MonthDatum {
  label: string;
  count: number;
}

export interface StageDatum {
  key: string;
  label: string;
}

/* ── On-chain domain mirrors (display-only) ───────────────────
   Field names mirror contracts/src/creditcoin/interfaces/
   ITRUCreditRegistry.sol so UI copy stays honest about what the
   contracts actually expose. These are local view-model types;
   the UI currently renders sample data, not live contract reads. */

export type CreditState = "NEW" | "BUILDING" | "ESTABLISHED" | "VERIFIED";

export interface CreditEvidenceView {
  creditState: CreditState;
  repayments: number;
  totalRepaid: string;
  creditLimit: string;
  distinctLoansRepaid: number;
}

export type ObligationStatus = "NONE" | "ACTIVE" | "COMPLETED" | "FAILED";

export type ObligationEventType = "Created" | "Completed" | "Failed";

export interface VerifiedObligationEventView {
  eventId: string;
  obligationId: string;
  requester: string;
  executor: string;
  sourceChain: number;
  sourceTxHash: string;
  sourceBlock: number;
  eventType: ObligationEventType;
  value: string;
  verifiedAt: string;
  deadline: string;
}

export interface VerifiedFinancialEventView {
  eventId: string;
  borrower: string;
  sourceChain: number;
  sourceTxHash: string;
  sourceBlock: number;
  loanId: string;
  eventType: "Repayment" | "Origination";
  amount: string;
  verifiedAt: string;
}

/** Mirrors getAgentPassport: deterministic counts only, no scores. */
export interface AgentPassportView {
  subject: string;
  verifiedObligations: number;
  completedObligations: number;
  activeObligations: number;
  settlementVolume: string;
  completionRateBps: number;
  verifiedSourceChains: number[];
}

export interface EconomicActorView {
  address: string;
  network: string;
  credit: CreditEvidenceView;
  obligations: AgentPassportView;
}

/* ── Wallet connection (EIP-1193, minimal) ─────────────────── */

export interface EIP1193Provider {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
  providers?: EIP1193Provider[];
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}
