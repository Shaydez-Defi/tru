import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { EIP1193Provider, LedgerEntry, NavigateFn, PipelineNodeDatum, ScreenName, ScreenProps } from "./types";
import {
  BLOCK_TIME_SEC,
  STAGES,
  summarizeHistory,
} from "./data";
import {
  bucketByMonth,
  fetchAgentPassport,
  fetchAttestationStatus,
  fetchCreditEvidence,
  fetchOutstandingObligations,
  fetchVerifiedHistory,
  formatLoanAmount,
  formatUnits,
  LOAN_MARKET_ADDRESS,
  OBLIGATION_MARKET_ADDRESS,
  SAMPLE_ACTOR_ADDRESS,
  truncateAddress,
  truncateHash,
  useAsyncData,
} from "./chain";

const TOKENS = `
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&display=swap');
  :root{
    --bg:#0a0a0b; --bg-elevated:#131316; --bg-elevated-2:#1a1a1e;
    --line: rgba(255,255,255,0.10); --line-soft: rgba(255,255,255,0.06);
    --text:#f2f1ec; --text-soft:#9c9a94; --text-faint:#5f5d59;
    --accent:#4A607A; --accent-bright:#00FFC6; --accent-hi:#5CF2CF; --accent-deep:#2B3D52;
    --accent-tint: rgba(0,255,198,.25);
    --accent-gradient: linear-gradient(135deg, #00FFC6 0%, #4A607A 55%, #2B3D52 100%);
    --font-display:'Geist', -apple-system, BlinkMacSystemFont, sans-serif;
    --font-body:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
    --font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    --ease-out: cubic-bezier(.16,1,.3,1); --ease-in-out: cubic-bezier(.65,0,.35,1);
  }
  /* THEMED SCROLLBAR + SELECTION (shared by every screen) */
  *{ scrollbar-width:thin; scrollbar-color:rgba(74,96,122,.65) transparent; }
  *::-webkit-scrollbar{ width:10px; height:10px; }
  *::-webkit-scrollbar-track{ background:transparent; }
  *::-webkit-scrollbar-thumb{ background:rgba(74,96,122,.55); border-radius:8px; border:3px solid var(--bg); background-clip:padding-box; }
  *::-webkit-scrollbar-thumb:hover{ background:rgba(0,255,198,.45); border:3px solid var(--bg); background-clip:padding-box; }
  ::selection{ background:rgba(0,255,198,.28); }
  /* SCREEN TRANSITIONS: every screen fades/rises in on mount; TruApp holds
     the old screen for 200ms with .screen-exit so exits fade too. */
  html{ scroll-behavior:smooth; }
  .screen-anim{ animation:screen-in .38s var(--ease-out); }
  @keyframes screen-in{ from{ opacity:0; transform:translateY(14px); } to{ opacity:1; transform:translateY(0); } }
  .screen-anim.screen-exit{ animation:none; opacity:0; transform:translateY(10px); transition:opacity .2s ease-out, transform .2s ease-out; }
  @media (prefers-reduced-motion: reduce){
    html{ scroll-behavior:auto; }
    .screen-anim{ animation:none; }
    .screen-anim.screen-exit{ transition:none; opacity:1; transform:none; }
  }
  /* IPHONE HARDENING: no text inflation, no sideways scroll, no tap flash,
     no Safari auto-zoom on the search field (needs 16px). */
  html{ -webkit-text-size-adjust:100%; }
  *{ -webkit-tap-highlight-color:transparent; }
  .tru-root,.app-root,.v-root{ overflow-x:clip; }
  @media (max-width:700px){ .events-search .events-search-input{ font-size:16px; } }
  /* PERSISTENT NAV: brand returns home, wallet chip opens connect. The brand
     shows only where the sidebar is hidden (mobile); chips are tappable. */
  .topbar-brand{ display:none; align-items:center; gap:8px; background:none; border:none; cursor:pointer;
    color:inherit; font-family:var(--font-display); font-size:15px; font-weight:700; margin-right:auto; padding:4px 0; }
  @media (max-width:860px){ .topbar-brand{ display:inline-flex; } }
  .net-chip--btn{ cursor:pointer; background:none; font:inherit; }
  .net-chip--btn:hover{ border-color:rgba(0,255,198,.4); color:var(--text); }
  .sb-wallet{ cursor:pointer; background:none; font:inherit; color:inherit; text-align:left; width:100%; }
  .sb-wallet:hover{ border-color:rgba(0,255,198,.35); }
  /* BUTTERY CTA HOVER: a sheen overlay fading in (opacity is the cheapest
     property to animate) instead of a filter snap. Applied to every pill. */
  .btn-primary,.btn-ghost,.nav-cta{ position:relative; overflow:hidden; }
  .btn-primary::after,.btn-ghost::after,.nav-cta::after{ content:""; position:absolute; inset:0; border-radius:inherit;
    background:linear-gradient(180deg, rgba(255,255,255,.16), transparent 55%); opacity:0; transition:opacity .34s var(--ease-out); pointer-events:none; }
  .btn-primary:hover::after,.btn-ghost:hover::after,.nav-cta:hover::after{ opacity:1; }
`;

function TruMark({ size = 22, color = "var(--text)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size * (520 / 600)} viewBox="0 0 600 520" fill={color} aria-hidden="true">
      <path d="M145 95 C145 63 171 42 205 42 H505 C535 42 555 62 555 92 C555 120 535 140 505 140 H302 L225 213 C213 225 203 241 203 257 C203 270 211 282 225 288 C236 293 248 292 258 286 L314 251 L374 193 H505 L425 273 L385 310 V431 C385 460 367 480 340 480 C312 480 294 460 294 431 V321 L349 268 H253 C223 268 201 255 191 237 C183 222 181 206 185 190 L238 140 H195 C165 140 145 121 145 95 Z" />
    </svg>
  );
}
function OverviewIcon({ size = 16 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" /><rect x="13" y="3" width="8" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.6" /><rect x="13" y="12" width="8" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.6" /><rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" /></svg>); }
function CreditIcon({ size = 16 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><rect x="2.5" y="5" width="19" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.6" /><path d="M2.5 9.5h19" stroke="currentColor" strokeWidth="1.6" /><path d="M6 14.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>); }
function EventsIcon({ size = 16 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>); }
function ProtocolIcon({ size = 16 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.6" /><circle cx="5" cy="19" r="2" stroke="currentColor" strokeWidth="1.6" /><circle cx="19" cy="19" r="2" stroke="currentColor" strokeWidth="1.6" /><path d="M12 6.5V12M12 12L6 17M12 12l6 5" stroke="currentColor" strokeWidth="1.6" /></svg>); }
function SettingsIcon({ size = 15 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>); }
function ArrowUpRight({ size = 12 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M6 18L18 6M18 6H9M18 6V15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>); }
function CheckGlyph({ size = 12, color = "var(--bg)" }: { size?: number; color?: string }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M4 12.5L9.5 18L20 6" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>); }
function ExportIcon({ size = 16 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M12 3v12M12 3l4 4M12 3L8 7M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>); }
function ExpandIcon({ size = 14, open }: { size?: number; open: boolean }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s ease" }}><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>); }
function SearchIcon({ size = 15 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7" /><path d="M20 20l-4.3-4.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>); }
function ArrowLeft({ size = 14 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M19 12H5M5 12l6-6M5 12l6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>); }
function ExternalLink({ size = 12 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M7 17L17 7M17 7H10M17 7V14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>); }
function ShieldGlyph({ size = 15 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>); }
function SidebarToggleIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4.5" width="18" height="15" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9.5 4.5v15" stroke="currentColor" strokeWidth="1.6" />
      <rect x="4.5" y="6" width="3.6" height="12" rx="1" fill="currentColor" />
    </svg>
  );
}



function Seal({ size = 40 }: { size?: number }) {
  return (
    <div className="seal" style={{ width: size, height: size }}>
      <div className="seal-core"><CheckGlyph size={size * 0.34} color="#1a1408" /></div>
    </div>
  );
}

function PendingMark({ size = 40 }: { size?: number }) {
  return (
    <div className="pending-mark" style={{ width: size, height: size }}>
      <svg className="pending-spin" width={size * 0.4} height={size * 0.4} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="var(--text-faint)" strokeWidth="2.2" strokeOpacity=".3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="var(--accent-bright)" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function RateGauge({ pct = 100, size = 116, caption = "on time" }: { pct?: number; size?: number; caption?: string }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = (pct / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#C9FFF2" />
          <stop offset="42%" stopColor="#00FFC6" />
          <stop offset="100%" stopColor="#0A8F77" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#gaugeGrad)" strokeWidth={stroke}
        strokeDasharray={`${filled} ${c}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="47%" textAnchor="middle" fill="var(--text)" fontSize="22" fontWeight="700" fontFamily="var(--font-display)">{pct}%</text>
      <text x="50%" y="63%" textAnchor="middle" fill="var(--text-faint)" fontSize="9.5" fontFamily="var(--font-mono)">{caption}</text>
    </svg>
  );
}

function Identicon({ addr = "0x7A3f92Fd" }: { addr?: string }) {
  // deterministic 4x4 pattern from the address string, mirrored: a
  // lightweight stand-in for a real wallet blockie.
  const codes = addr.split("").map((c) => c.charCodeAt(0));
  const cells: { row: number; col: number; on: boolean }[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 2; col++) {
      const on = codes[(row * 2 + col) % codes.length] % 2 === 0;
      cells.push({ row, col, on });
      cells.push({ row, col: 3 - col, on });
    }
  }
  return (
    <div className="identicon">
      {cells.map((c, i) => (
        <span key={i} className={`identicon-cell ${c.on ? "is-on" : ""}`} style={{ gridRow: c.row + 1, gridColumn: c.col + 1 }} />
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
    TRU design tokens (dark, slate base, mint accent)
   ──────────────────────────────────────────────────────────── */
function ChainGlyph({ size = 13 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M9 15l6-6M8 16l-1.5 1.5a3.5 3.5 0 0 1-5-5L3 11a3.5 3.5 0 0 1 5-5l1-1M16 8l1.5-1.5a3.5 3.5 0 0 1 5 5L21 13a3.5 3.5 0 0 1-5 5l-1 1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>); }
function LedgerGlyph({ size = 13 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.7" /><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>); }
function EventGlyph({ size = 13 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M12 2v6M12 16v6M4.9 4.9l4.2 4.2M14.9 14.9l4.2 4.2M2 12h6M16 12h6M4.9 19.1l4.2-4.2M14.9 9.1l4.2-4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>); }
function XGlyph({ size = 12 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="var(--red)" strokeWidth="1.9" strokeLinecap="round" /></svg>); }
function CodeGlyph({ size = 13 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M8 6l-6 6 6 6M16 6l6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>); }
function PlayGlyph({ size = 15 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" /></svg>); }
function GitHubGlyph({ size = 14 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.221-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.269 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.295 2.747-1.026 2.747-1.026.546 1.378.203 2.397.1 2.65.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .268.18.58.688.482A10.02 10.02 0 0022 12.017C22 6.484 17.522 2 12 2z" /></svg>); }
function WalletGlyph({ size = 14 }: { size?: number }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v3h-4a2.5 2.5 0 0 0 0 5h4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><circle cx="16.5" cy="12.5" r="1" fill="currentColor" /></svg>); }

const NODES: PipelineNodeDatum[] = [
  { label: "Loan repaid", meta: "economic event → verified", icon: EventGlyph, pos: "top-left" },
  { label: "Obligation completed", meta: "economic event → verified", icon: ShieldGlyph, pos: "top-right" },
  { label: "Event happened", meta: "→ proven", icon: ChainGlyph, pos: "bottom-left" },
  { label: "Verified record", meta: "reusable on Creditcoin", icon: LedgerGlyph, pos: "bottom-right" },
];
function PipelineNode({ node }: { node: PipelineNodeDatum }) {
  const Icon = node.icon;
  return (
    <div className={`node node--${node.pos}`}>
      <span className="node-icon"><Icon /></span>
      <span className="node-text"><span className="node-label">{node.label}</span><span className="node-meta">{node.meta}</span></span>
    </div>
  );
}

/* ── Scroll reveal: same safe pattern as before, never opacity:0
   by default, only a settle-into-place transform. ────────────── */
function Reveal({ children, stagger = 0, className = "" }: { children: ReactNode; stagger?: number; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); obs.unobserve(el); } }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${inView ? "is-in" : ""} ${className}`} style={{ "--stagger": stagger } as CSSProperties}>{children}</div>;
}

/* ── Section label: varied per section, not the same kicker+H2
   formula every time. ─────────────────────────────────────────── */
function SectionTag({ children }: { children: ReactNode }) {
  return <span className="section-tag">{children}</span>;
}

function LandingScreen({ navigate }: ScreenProps) {

  return (
    <div className="tru-root">
      <style>{`
        ${TOKENS}
        *{ box-sizing:border-box; }
        html,body{ margin:0; padding:0; background:var(--bg); }
        .tru-root{ background:var(--bg); color:var(--text); font-family:var(--font-body); position:relative; }
        .dither{ position:fixed; inset:0; pointer-events:none; z-index:0; opacity:.08;
          background-image:radial-gradient(circle at 1px 1px, var(--accent-bright) 1px, transparent 0);
          background-size:5px 5px; }
        .page-backdrop{ position:relative; z-index:1; }
        .wrap{ max-width:1180px; margin:0 auto; padding:0 40px; }
        @media (max-width:700px){ .wrap{ padding:0 22px; } }

        /* PAGE FRAME: nav + hero + trust strip sit inside one large
           rounded panel, inset from the true viewport edge, matching
           the reference's framed presentation. */
        .page-backdrop{ background:#050506; padding:18px; }
        .hero-frame{ position:relative; border-radius:28px; overflow:hidden; background:var(--bg);
          box-shadow:0 70px 130px -50px rgba(0,0,0,.65), inset 0 0 0 1px rgba(255,255,255,.05); }

        /* NAV */
        .nav{ position:relative; z-index:50; display:grid; grid-template-columns:1fr auto 1fr; align-items:center; padding:24px 36px; }
        .nav-left{ justify-self:start; }
        .nav-center{ justify-self:center; }
        .nav-right{ justify-self:end; }
        .nav-left{ display:flex; align-items:center; gap:11px; }
        .nav-word{ font-family:var(--font-display); font-size:19px; font-weight:700; letter-spacing:-.01em; }
        .nav-center{ display:flex; align-items:center; gap:34px; }
        .nav-link{ font-size:14px; color:var(--text-soft); text-decoration:none; transition:color .18s var(--ease-out); }
        .nav-link:hover{ color:var(--text); }
        .nav-right{ display:flex; align-items:center; gap:10px; }
        .nav-pill{ display:inline-flex; align-items:center; gap:6px; font-size:13px; color:var(--text-soft); background:var(--bg-elevated);
          border:1px solid var(--line); border-radius:100px; padding:8px 14px; text-decoration:none; transition:border-color .15s var(--ease-out), color .15s var(--ease-out); }
        .nav-pill:hover{ color:var(--text); border-color:rgba(255,255,255,.2); }
        .nav-cta{ font-size:14px; font-weight:600; color:#d9fff5; background:linear-gradient(135deg, #2a6a5c 0%, #2c4f66 58%, #2B3D52 100%);
          border:1px solid rgba(0,255,198,.28); border-radius:100px; padding:10px 20px; cursor:pointer;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.18), inset 0 -2px 5px rgba(0,0,0,.4), 0 0 0 1px rgba(0,0,0,.45), 0 8px 20px -14px rgba(0,0,0,.8);
          text-shadow:0 1px 2px rgba(0,0,0,.4);
          transition:transform .18s var(--ease-out), box-shadow .32s var(--ease-out), border-color .32s var(--ease-out); }
        .nav-cta:hover{ border-color:rgba(0,255,198,.5); }
        .nav-cta:active{ transform:translateY(1px) scale(.97); box-shadow:inset 0 2px 6px rgba(0,0,0,.5), 0 0 0 1px rgba(0,0,0,.45); }
        @media (max-width:900px){ .nav-center{ display:none; } .nav{ display:flex; justify-content:space-between; padding:18px 22px; } }

        /* HERO: sized so nav + hero + trust strip land inside one viewport
           (svh for mobile browser chrome), with a short-screen fallback. */
        .hero{ position:relative; min-height:calc(100vh - 210px); min-height:calc(100svh - 210px); display:flex; flex-direction:column; align-items:center; justify-content:center;
          text-align:center; padding:20px 24px 44px; overflow:hidden; }
        @media (max-height:780px){
          .hero{ padding:12px 24px 30px; }
          .hero-sub{ margin-bottom:24px; }
          .headline{ font-size:clamp(32px,4.6vw,58px); margin-bottom:16px; }
          .trail-lines{ height:52px !important; }
        }
        .hero-glow{ position:absolute; top:-14%; left:0; right:0; height:680px; pointer-events:none; z-index:0;
          background:
            radial-gradient(ellipse 460px 260px at 36% 6%, rgba(255,255,255,.14), transparent 62%),
            radial-gradient(ellipse 560px 340px at 66% 16%, rgba(74,96,122,.24), transparent 66%),
            radial-gradient(ellipse 380px 240px at 50% -4%, rgba(0,255,198,.07), transparent 68%);
          filter:blur(18px); }
        .hero-content{ position:relative; z-index:2; max-width:760px; display:flex; flex-direction:column; align-items:center; }

        .headline{ font-family:var(--font-display); font-weight:500; font-size:clamp(38px, 5.4vw, 68px); line-height:1.08; letter-spacing:-.02em; margin:0 0 22px; color:var(--text-faint); }
        .headline b{ display:block; font-weight:800; color:var(--text); }
        .hero-sub{ font-size:clamp(15.5px, 1.2vw, 18px); line-height:1.6; color:var(--text-soft); max-width:46ch; margin:0 0 36px; }
        .hero-actions{ display:flex; align-items:center; justify-content:center; gap:14px; flex-wrap:wrap; }
        .btn-primary{ display:inline-flex; align-items:center; gap:8px; font-size:14.5px; font-weight:600; color:#d9fff5;
          background:linear-gradient(135deg, #2a6a5c 0%, #2c4f66 58%, #2B3D52 100%);
          border:1px solid rgba(0,255,198,.28); border-radius:100px; padding:13px 22px; cursor:pointer;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.18), inset 0 -3px 7px rgba(0,0,0,.4), 0 0 0 1px rgba(0,0,0,.45), 0 10px 24px -14px rgba(0,0,0,.8);
          text-shadow:0 1px 2px rgba(0,0,0,.4);
          transition:transform .18s var(--ease-out), box-shadow .32s var(--ease-out), border-color .32s var(--ease-out); }
        .btn-primary:hover{ border-color:rgba(0,255,198,.5); }
        .btn-primary:active{ transform:translateY(1px) scale(.98); box-shadow:inset 0 3px 8px rgba(0,0,0,.5), 0 0 0 1px rgba(0,0,0,.45); }
        .btn-ghost{ display:inline-flex; align-items:center; gap:8px; font-size:14.5px; font-weight:600; color:var(--text); background:transparent;
          border:1px solid var(--line); border-radius:100px; padding:13px 22px; cursor:pointer;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.07), inset 0 -3px 6px rgba(0,0,0,.25);
          transition:border-color .3s var(--ease-out), background .3s var(--ease-out), color .3s var(--ease-out), box-shadow .3s var(--ease-out); }
        .btn-ghost:hover{ border-color:rgba(255,255,255,.28); background:rgba(255,255,255,.03); }

        .trail-lines{ position:relative; width:100%; height:88px; margin-top:6px; pointer-events:none; }
        .trail{ position:absolute; top:0; left:50%; width:1px; background:linear-gradient(to bottom, rgba(255,255,255,.28), transparent);
          animation:trail-pulse 2.6s var(--ease-in-out) infinite; }
        @keyframes trail-pulse{ 0%,100%{ opacity:.35; } 50%{ opacity:1; } }
        @media (max-width:640px){ .trail-lines{ display:none; } }
        /* MOBILE NAV: collapse to icons so everything fits one row. */
        .nav-cta-icon{ display:none; }
        .nav-cta-icon svg{ display:block; }
        @media (max-width:640px){
          .nav-pill{ padding:8px 10px; }
          .nav-pill-label{ display:none; }
          .nav-cta{ padding:9px 12px; }
          .nav-cta-label{ display:none; }
          .nav-cta-icon{ display:inline-flex; }
        }
        /* MOBILE HERO: let the card hug its content instead of stretching a
           lean column down the whole viewport. Stacked full-width pills. */
        @media (max-width:700px){
          .page-backdrop{ padding:14px; }
          .hero-frame{ border-radius:22px; }
          .hero{ min-height:0; padding:46px 20px 38px; }
          .headline{ font-size:clamp(36px,11vw,48px); line-height:1.16; margin-bottom:20px; }
          .hero-sub{ font-size:15.5px; line-height:1.75; margin-bottom:30px; }
          .hero-actions{ gap:12px; }
          .hero-actions .btn-primary, .hero-actions .btn-ghost{ width:auto; padding:12px 20px; font-size:13.5px; }
          .trust-strip{ gap:20px 24px; padding:24px 16px 28px; }
        }

        .node{ position:absolute; z-index:2; display:flex; align-items:center; gap:10px; animation:node-float 7s var(--ease-in-out) infinite; }
        .node-icon{ width:30px; height:30px; border-radius:50%; border:1px solid var(--line); background:var(--bg-elevated);
          box-shadow:inset 0 0 0 1px rgba(74,96,122,.35); display:flex; align-items:center; justify-content:center; color:var(--accent-bright); flex:none; }
        .node-text{ display:flex; flex-direction:column; gap:1px; text-align:left; white-space:nowrap; }
        .node-label{ font-family:var(--font-mono); font-size:12.5px; color:var(--text); }
        .node-meta{ font-size:10.5px; color:var(--text-faint); }
        .node--top-left{ top:16%; left:9%; animation-delay:0s; } .node--top-right{ top:20%; right:8%; animation-delay:1.6s; }
        .node--bottom-left{ bottom:22%; left:6%; animation-delay:.9s; } .node--bottom-right{ bottom:18%; right:10%; animation-delay:2.3s; }
        @keyframes node-float{ 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-9px); } }
        @media (max-width:1100px){ .node{ display:none; } }

        .stage-indicator{ position:absolute; bottom:32px; right:40px; z-index:2; display:flex; flex-direction:column; align-items:flex-end; gap:10px; }
        .stage-label{ font-size:11px; color:var(--accent-bright); font-family:var(--font-mono); letter-spacing:.05em; text-transform:uppercase; }
        .stage-dots{ display:flex; gap:6px; }
        .stage-dot{ width:20px; height:3px; border-radius:2px; background:var(--line); transition:width .2s var(--ease-out), background .2s var(--ease-out); }
        .stage-dot.is-active{ background:var(--accent-gradient); width:28px; }
        @media (max-width:700px){ .stage-indicator{ display:none; } }
        .trust-strip{ position:relative; z-index:2; display:flex; align-items:center; justify-content:center; gap:44px; flex-wrap:wrap; padding:28px 24px 40px; border-top:1px solid var(--line-soft); }
        .trust-item{ font-family:var(--font-display); font-size:13px; font-weight:600; color:var(--text-faint); letter-spacing:.02em; }
        .trust-item span{ color:var(--text-soft); font-weight:400; font-size:11px; margin-left:6px; }
        @media (prefers-reduced-motion: reduce){ .node{ animation:none; } }

        /* SHARED SECTION SHELL */
        .section{ padding:100px 0; border-top:1px solid var(--line-soft); }
        .section-tag{ display:inline-block; font-family:var(--font-mono); font-size:11.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--accent-bright); margin-bottom:18px; }
        .section-title{ font-family:var(--font-display); font-weight:600; font-size:clamp(26px, 2.6vw, 38px); line-height:1.25; letter-spacing:-.01em; max-width:18ch; }
        .section-title b{ color:var(--accent-bright); font-weight:600; }
        .reveal{ opacity:1; transition:transform .6s var(--ease-out); transition-delay:calc(var(--stagger,0) * 80ms); transform:translateY(18px); }
        .reveal.is-in{ transform:translateY(0); }
        @media (prefers-reduced-motion: reduce){ .reveal{ transition:none; transform:none; } }

        /* PROBLEM */
        .problem-envs{ display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin:48px 0 32px; }
        .env-card{ border:1px solid var(--line); border-radius:14px; padding:22px; background:var(--bg-elevated); }
        .env-card-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
        .env-name{ font-family:var(--font-mono); font-size:12.5px; color:var(--text-soft); }
        .env-frag{ width:22px; height:22px; border-radius:50%; background:var(--red-tint); display:flex; align-items:center; justify-content:center; }
        .env-fact{ font-size:14px; color:var(--text); line-height:1.5; }
        .problem-line{ text-align:center; font-size:16px; color:var(--text-soft); max-width:52ch; margin:0 auto; }
        .problem-line b{ color:var(--text); font-weight:600; }
        @media (max-width:820px){ .problem-envs{ grid-template-columns:1fr; } }

        /* SOLUTION PIPELINE */
        .pipeline{ display:flex; align-items:center; justify-content:center; gap:0; margin:52px 0 8px; flex-wrap:wrap; }
        .pipe-node{ display:flex; flex-direction:column; align-items:center; gap:10px; text-align:center; width:150px; }
        .pipe-icon{ width:52px; height:52px; border-radius:50%; border:1px solid var(--line); background:var(--bg-elevated);
          box-shadow:inset 0 0 0 1px rgba(74,96,122,.35); display:flex; align-items:center; justify-content:center; color:var(--accent-bright); }
        .pipe-label{ font-family:var(--font-display); font-size:14px; font-weight:600; }
        .pipe-sub{ font-size:11.5px; color:var(--text-faint); font-family:var(--font-mono); }
        .pipe-arrow{ color:var(--text-faint); font-size:18px; padding:0 6px; align-self:center; }
        @media (max-width:900px){ .pipeline{ flex-direction:column; gap:16px; } .pipe-arrow{ transform:rotate(90deg); padding:4px 0; } }

        /* HOW IT WORKS */
        .steps-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:var(--line); border:1px solid var(--line); border-radius:16px; overflow:hidden; margin-top:48px; }
        .step-card{ background:var(--bg); padding:28px 24px; }
        .step-n{ font-family:var(--font-mono); font-size:12px; color:var(--accent-bright); margin-bottom:16px; display:block; }
        .step-title{ font-family:var(--font-display); font-size:17px; font-weight:600; margin-bottom:8px; }
        .step-body{ font-size:13.5px; color:var(--text-soft); line-height:1.55; }
        @media (max-width:860px){ .steps-grid{ grid-template-columns:1fr; } }

        /* LIVE PROOF */
        .proof-panel{ border:1px solid var(--line); border-radius:18px; overflow:hidden; margin-top:48px; background:var(--bg-elevated); }
        .proof-stage{ display:grid; grid-template-columns:repeat(4,1fr); }
        .proof-cell{ padding:24px 22px; border-right:1px solid var(--line); }
        .proof-cell:last-child{ border-right:none; }
        .proof-cell-label{ font-family:var(--font-mono); font-size:10.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--text-faint); margin-bottom:14px; }
        .proof-row{ display:flex; justify-content:space-between; align-items:baseline; padding:6px 0; font-size:12.5px; }
        .proof-k{ color:var(--text-soft); }
        .proof-v{ font-family:var(--font-mono); color:var(--text); }
        .proof-v--ok{ color:var(--accent-bright); display:flex; align-items:center; gap:5px; }
        .proof-cmd{ display:flex; align-items:center; justify-content:space-between; gap:12px; padding:18px 22px; border-top:1px solid var(--line); background:var(--bg); }
        .proof-cmd code{ font-family:var(--font-mono); font-size:12.5px; color:var(--text-soft); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .proof-copy{ font-size:12px; font-weight:600; color:var(--text); background:var(--bg-elevated-2); border:1px solid var(--line); border-radius:8px; padding:6px 12px; cursor:pointer; flex:none; transition:color .15s var(--ease-out), border-color .15s var(--ease-out), background .15s var(--ease-out); }
        .proof-copy:hover{ color:var(--accent-bright); border-color:rgba(0,255,198,.4); }
        @media (max-width:860px){ .proof-stage{ grid-template-columns:1fr; } .proof-cell{ border-right:none; border-bottom:1px solid var(--line); } }

        /* CREDIT PROFILE PREVIEW */
        .profile-panel{ border:1px solid var(--line); border-radius:18px; padding:30px; margin-top:48px; max-width:520px; margin-left:auto; margin-right:auto; background:var(--bg-elevated); position:relative; }
        .profile-example-tag{ position:absolute; top:-11px; left:26px; font-family:var(--font-mono); font-size:10px; letter-spacing:.05em; text-transform:uppercase; color:var(--text-faint); background:var(--bg); padding:2px 10px; border:1px solid var(--line); border-radius:100px; }
        .profile-wallet{ font-family:var(--font-mono); font-size:12.5px; color:var(--text-soft); margin-bottom:22px; }
        .profile-status{ font-family:var(--font-display); font-size:26px; font-weight:700; margin-bottom:4px; }
        .profile-status-k{ font-size:12px; color:var(--text-faint); margin-bottom:26px; }
        .profile-stats{ display:grid; grid-template-columns:repeat(3,1fr); gap:1px; background:var(--line); border-radius:12px; overflow:hidden; border:1px solid var(--line); margin-bottom:20px; }
        .profile-stat{ background:var(--bg); padding:16px; text-align:center; }
        .profile-stat-v{ font-family:var(--font-display); font-size:19px; font-weight:700; }
        .profile-stat-k{ font-size:10.5px; color:var(--text-faint); margin-top:3px; }
        .profile-capability{ display:flex; align-items:center; gap:10px; padding:14px 16px; border:1px solid var(--accent-tint); background:rgba(0,255,198,.06); border-radius:10px; font-size:13px; }

        /* VERIFICATION DETAIL */
        .vdetail{ border:1px solid var(--line); border-radius:16px; padding:26px 28px; margin-top:48px; max-width:600px; margin-left:auto; margin-right:auto; background:var(--bg-elevated); }
        .vdetail-title{ font-family:var(--font-display); font-size:17px; font-weight:600; margin-bottom:18px; }
        .vdetail-row{ display:flex; justify-content:space-between; padding:10px 0; border-top:1px solid var(--line); font-size:13px; }
        .vdetail-row:first-of-type{ border-top:none; }
        .vdetail-k{ color:var(--text-soft); }
        .vdetail-v{ font-family:var(--font-mono); color:var(--text); }
        .vdetail-status{ display:flex; align-items:center; gap:6px; color:var(--accent-bright); }

        /* CREDITCOIN STATE before/after */
        .state-compare{ display:flex; align-items:center; justify-content:center; gap:0; margin-top:48px; }
        .state-box{ text-align:center; padding:26px 40px; }
        .state-k{ font-size:12px; color:var(--text-faint); margin-bottom:10px; }
        .state-v{ font-family:var(--font-display); font-size:34px; font-weight:700; }
        .state-v--before{ color:var(--text-faint); }
        .state-v--after{ color:var(--accent-bright); }
        .state-arrow{ color:var(--text-faint); font-size:22px; padding:0 20px; }
        @media (max-width:600px){ .state-compare{ flex-direction:column; gap:16px; } .state-arrow{ transform:rotate(90deg); } }

        /* UNDER THE HOOD */
        .arch-diagram{ display:flex; flex-direction:column; align-items:center; margin-top:48px; }
        .arch-block{ width:100%; max-width:340px; border:1px solid var(--line); border-radius:12px; padding:16px 20px; text-align:center; background:var(--bg-elevated); }
        .arch-block-title{ font-family:var(--font-mono); font-size:13px; font-weight:600; }
        .arch-block-sub{ font-size:11.5px; color:var(--text-faint); margin-top:3px; }
        .arch-arrow{ color:var(--text-faint); padding:6px 0; font-size:14px; }

        /* DEPENDENCY TRIANGLE */
        .dep-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:1px; background:var(--line); border:1px solid var(--line); border-radius:16px; overflow:hidden; margin-top:48px; }
        .dep-card{ background:var(--bg); padding:28px 24px; }
        .dep-role{ font-family:var(--font-mono); font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--accent-bright); margin-bottom:10px; }
        .dep-name{ font-family:var(--font-display); font-size:18px; font-weight:600; margin-bottom:10px; }
        .dep-body{ font-size:13px; color:var(--text-soft); line-height:1.55; }
        @media (max-width:860px){ .dep-grid{ grid-template-columns:1fr; } }

        /* DEV ARCHITECTURE */
        .dev-flow{ display:flex; align-items:center; justify-content:center; gap:14px; margin:48px 0 32px; flex-wrap:wrap; }
        .dev-chip{ font-family:var(--font-mono); font-size:13px; background:var(--bg-elevated); border:1px solid var(--line); border-radius:8px; padding:10px 16px; }
        .dev-flow-arrow{ color:var(--text-faint); }
        .dev-snippet{ font-family:var(--font-mono); font-size:12.5px; color:var(--text-soft); background:var(--bg-elevated); border:1px solid var(--line); border-radius:12px; padding:18px 22px; max-width:460px; margin:0 auto; line-height:1.7; }
        .dev-snippet .k{ color:var(--accent-bright); }

        /* USE CASES */
        .cases-list{ display:flex; flex-direction:column; margin-top:48px; border-top:1px solid var(--line); }
        .case-row{ display:flex; gap:28px; align-items:flex-start; padding:26px 0; border-bottom:1px solid var(--line); }
        .case-n{ font-family:var(--font-mono); font-size:13px; color:var(--accent-bright); flex:none; padding-top:2px; }
        .case-title{ font-family:var(--font-display); font-size:16px; font-weight:600; margin-bottom:6px; }
        .case-body{ font-size:14px; color:var(--text-soft); line-height:1.6; max-width:56ch; }

        /* FUTURE VISION */
        .vision-flow{ display:flex; flex-direction:column; align-items:center; gap:4px; margin-top:48px; }
        .vision-step{ font-family:var(--font-mono); font-size:13.5px; color:var(--text-soft); padding:8px 0; }
        .vision-step:last-child{ color:var(--accent-bright); font-weight:600; font-size:16px; }
        .vision-arrow{ color:var(--text-faint); font-size:14px; }

        /* FINAL CTA */
        .final-cta{ text-align:center; padding:110px 24px; }
        .final-cta h2{ font-family:var(--font-display); font-weight:600; font-size:clamp(28px, 3vw, 42px); max-width:18ch; margin:0 auto 32px; line-height:1.3; }
        .final-actions{ display:flex; align-items:center; justify-content:center; gap:14px; }

        /* FOOTER */
        .footer{ border-top:1px solid var(--line-soft); padding:56px 0 32px; }
        .footer-top{ display:grid; grid-template-columns:1.4fr repeat(3,1fr); gap:32px; margin-bottom:44px; }
        .footer-brand-word{ font-family:var(--font-display); font-size:19px; font-weight:700; margin-bottom:10px; }
        .footer-brand-desc{ font-size:13px; color:var(--text-faint); max-width:28ch; line-height:1.5; }
        .footer-col-title{ font-family:var(--font-mono); font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--text-faint); margin-bottom:14px; }
        .footer-col a{ display:block; font-size:13.5px; color:var(--text-soft); text-decoration:none; padding:5px 0; }
        .footer-col a:hover{ color:var(--text); }
        .footer-bottom{ display:flex; justify-content:space-between; align-items:center; padding-top:24px; border-top:1px solid var(--line-soft); font-size:12px; color:var(--text-faint); flex-wrap:wrap; gap:12px; }
        .footer-legal{ color:inherit; text-decoration:none; }
        .footer-legal:hover{ color:var(--text); }
        @media (max-width:820px){ .footer-top{ grid-template-columns:1fr 1fr; } }
      `}</style>

      <div className="dither" />

      <div className="page-backdrop">
        <div className="hero-frame">
          <nav className="nav">
            <div className="nav-left"><TruMark size={26} /><span className="nav-word">TRU</span></div>
            <div className="nav-center">
              <a className="nav-link" href="#product">Product</a>
              <a className="nav-link" href="#how">How It Works</a>
              <a className="nav-link" href="#developers">Developers</a>
              <a className="nav-link" href="#docs">Documentation</a>
            </div>
            <div className="nav-right">
              <a className="nav-pill" href="https://github.com/Shaydez-Defi/tru" target="_blank" rel="noreferrer"><GitHubGlyph size={14} /> <span className="nav-pill-label">GitHub</span></a>
              <button className="nav-cta" onClick={() => navigate("connect")}><span className="nav-cta-icon"><WalletGlyph size={15} /></span><span className="nav-cta-label">Connect Wallet</span></button>
            </div>
          </nav>

          {/* HERO */}
          <section className="hero" id="product">
            <div className="hero-glow" />
            {NODES.map((n) => <PipelineNode key={n.label} node={n} />)}
            <div className="hero-content">

              <h1 className="headline">Economic history<b>you can prove.</b></h1>
              <p className="hero-sub">TRU verifies what economic actors actually do on-chain, from loan repayments to agent obligations.</p>

              <div className="hero-actions">
                <button className="btn-primary" onClick={() => navigate("connect")}>Connect Wallet <WalletGlyph size={14} /></button>
                <button className="btn-ghost" onClick={() => navigate("protocol")}>Explore Protocol</button>
              </div>

              <div className="trail-lines">
                <span className="trail" style={{ height: "64px", left: "-42px", animationDelay: "0s" }} />
                <span className="trail" style={{ height: "104px", left: "-10px", animationDelay: ".5s" }} />
                <span className="trail" style={{ height: "46px", left: "22px", animationDelay: "1s" }} />
              </div>
            </div>

            <div className="stage-indicator">
              <span className="stage-label">Verification stages</span>
              <div className="stage-dots">
                <span className="stage-dot is-active" /><span className="stage-dot" /><span className="stage-dot" /><span className="stage-dot" />
              </div>
            </div>
          </section>

          <div className="trust-strip">
            <span className="trust-item">Attestcoin</span><span className="trust-item">Creditcoin</span><span className="trust-item">Ethereum<span>Sepolia</span></span>
          </div>
        </div>
      </div>

      {/* PROBLEM */}
      <section className="section">
        <div className="wrap">
          <Reveal><SectionTag>The Problem</SectionTag><p className="section-title">Economic history doesn't travel with its actor.</p></Reveal>
          <Reveal stagger={1}>
            <div className="problem-envs">
              <div className="env-card"><div className="env-card-head"><span className="env-name">Ethereum</span><span className="env-frag"><XGlyph /></span></div><p className="env-fact">5 loans repaid, on time, in full.</p></div>
              <div className="env-card"><div className="env-card-head"><span className="env-name">Other chain</span><span className="env-frag"><XGlyph /></span></div><p className="env-fact">Active transaction history, unrecognized.</p></div>
              <div className="env-card"><div className="env-card-head"><span className="env-name">Agent obligations</span><span className="env-frag"><XGlyph /></span></div><p className="env-fact">Completed work, with no portable proof it happened.</p></div>
            </div>
          </Reveal>
          <Reveal stagger={2}><p className="problem-line">The history is real. Most systems just have no way to check it.</p></Reveal>
        </div>
      </section>

      {/* SOLUTION */}
      <section className="section">
        <div className="wrap" style={{ textAlign: "center" }}>
          <Reveal><SectionTag>The TRU Model</SectionTag><p className="section-title" style={{ margin: "0 auto", textAlign: "center" }}>Verify events where they happened.</p></Reveal>
          <Reveal stagger={1}>
            <div className="pipeline">
              <div className="pipe-node"><span className="pipe-icon"><EventGlyph size={20} /></span><span className="pipe-label">Economic Activity</span><span className="pipe-sub">loans & obligations</span></div>
              <span className="pipe-arrow">→</span>
              <div className="pipe-node"><span className="pipe-icon"><ShieldGlyph size={20} /></span><span className="pipe-label">Attestcoin</span><span className="pipe-sub">attests the source block</span></div>
              <span className="pipe-arrow">→</span>
              <div className="pipe-node"><span className="pipe-icon"><TruMark size={18} color="var(--accent-bright)" /></span><span className="pipe-label">TRU</span><span className="pipe-sub">verifies the event</span></div>
              <span className="pipe-arrow">→</span>
              <div className="pipe-node"><span className="pipe-icon"><LedgerGlyph size={20} /></span><span className="pipe-label">Creditcoin</span><span className="pipe-sub">records verified history</span></div>
            </div>
          </Reveal>
          <Reveal stagger={2}><p className="problem-line">Same proof. Different economic events: loans were the starting point, obligations generalize the primitive.</p></Reveal>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="section" id="how">
        <div className="wrap">
          <Reveal><SectionTag>How It Works</SectionTag><p className="section-title">What happens between an event and a record.</p></Reveal>
          <Reveal stagger={1}>
            <div className="steps-grid">
              <div className="step-card"><span className="step-n">01</span><h3 className="step-title">Activity Happens</h3><p className="step-body">An actor takes a loan or accepts an obligation on a supported chain.</p></div>
              <div className="step-card"><span className="step-n">02</span><h3 className="step-title">Attestcoin Attests</h3><p className="step-body">Attestcoin provides cross-chain proof that the event actually occurred.</p></div>
              <div className="step-card"><span className="step-n">03</span><h3 className="step-title">TRU Verifies</h3><p className="step-body">TRU checks the attested event against the conditions for a valid economic event.</p></div>
              <div className="step-card"><span className="step-n">04</span><h3 className="step-title">Creditcoin Records</h3><p className="step-body">The resulting verified history is written to Creditcoin, reusable by other apps and agents.</p></div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* LIVE PROOF */}
      <section className="section">
        <div className="wrap">
          <Reveal><SectionTag>Live Proof</SectionTag><p className="section-title">A real repayment, traced end to end.</p></Reveal>
          <Reveal stagger={1}>
            <div className="proof-panel">
              <div className="proof-stage">
                <div className="proof-cell">
                  <div className="proof-cell-label">Source Activity</div>
                  <div className="proof-row"><span className="proof-k">Chain</span><span className="proof-v">Ethereum</span></div>
                  <div className="proof-row"><span className="proof-k">Loan</span><span className="proof-v">$100</span></div>
                  <div className="proof-row"><span className="proof-k">Status</span><span className="proof-v">Repaid</span></div>
                  <div className="proof-row"><span className="proof-k">Tx</span><span className="proof-v">0x8f2a...c94d</span></div>
                </div>
                <div className="proof-cell">
                  <div className="proof-cell-label">Attestation</div>
                  <div className="proof-row"><span className="proof-k">Provider</span><span className="proof-v">Attestcoin</span></div>
                  <div className="proof-row"><span className="proof-k">Status</span><span className="proof-v proof-v--ok"><CheckGlyph size={11} /> Verified</span></div>
                  <div className="proof-row"><span className="proof-k">Proof</span><span className="proof-v">0x4b19...2e0a</span></div>
                </div>
                <div className="proof-cell">
                  <div className="proof-cell-label">TRU</div>
                  <div className="proof-row"><span className="proof-k">Verification</span><span className="proof-v proof-v--ok"><CheckGlyph size={11} /> Valid</span></div>
                  <div className="proof-row"><span className="proof-k">Event type</span><span className="proof-v">LoanRepaid</span></div>
                </div>
                <div className="proof-cell">
                  <div className="proof-cell-label">Creditcoin</div>
                  <div className="proof-row"><span className="proof-k">Credit state</span><span className="proof-v proof-v--ok"><CheckGlyph size={11} /> Updated</span></div>
                  <div className="proof-row"><span className="proof-k">Record</span><span className="proof-v">0x1c7e...9a04</span></div>
                </div>
              </div>
              <div className="proof-cmd"><code>node creditcoin/src/worker.mjs --tx 0x8f2a...c94d</code><button className="proof-copy">Copy</button></div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* CREDIT PROFILE PREVIEW */}
      <section className="section">
        <div className="wrap" style={{ textAlign: "center" }}>
          <Reveal><SectionTag>Credit Profile</SectionTag><p className="section-title" style={{ margin: "0 auto", textAlign: "center" }}>A verifiable record, not a score.</p></Reveal>
          <Reveal stagger={1}>
            <div className="profile-panel">
              <span className="profile-example-tag">Example profile</span>
              <div className="profile-wallet">0x7A3f...92Fd</div>
              <div className="profile-status">Building</div>
              <div className="profile-status-k">Credit state</div>
              <div className="profile-stats">
                <div className="profile-stat"><div className="profile-stat-v">1</div><div className="profile-stat-k">Verified repayment</div></div>
                <div className="profile-stat"><div className="profile-stat-v">100%</div><div className="profile-stat-k">Repayment rate</div></div>
                <div className="profile-stat"><div className="profile-stat-v">$0</div><div className="profile-stat-k">Outstanding</div></div>
              </div>
              <div className="profile-capability"><CheckGlyph size={15} /> Sample capacity: $200 of verified limit. The contract derives capacity as repayments × $100</div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* VERIFICATION DETAIL */}
      <section className="section">
        <div className="wrap" style={{ textAlign: "center" }}>
          <Reveal><SectionTag>Verification Detail</SectionTag><p className="section-title" style={{ margin: "0 auto", textAlign: "center" }}>Every field here traces back to something real.</p></Reveal>
          <Reveal stagger={1}>
            <div className="vdetail">
              <h3 className="vdetail-title">Repayment #003</h3>
              <div className="vdetail-row"><span className="vdetail-k">Source chain</span><span className="vdetail-v">Ethereum Sepolia</span></div>
              <div className="vdetail-row"><span className="vdetail-k">Source transaction</span><span className="vdetail-v">0x8f2a...c94d</span></div>
              <div className="vdetail-row"><span className="vdetail-k">Event</span><span className="vdetail-v">LoanRepaid</span></div>
              <div className="vdetail-row"><span className="vdetail-k">Amount</span><span className="vdetail-v">100 USDC</span></div>
              <div className="vdetail-row"><span className="vdetail-k">Attestation reference</span><span className="vdetail-v">0x4b19...2e0a</span></div>
              <div className="vdetail-row"><span className="vdetail-k">Creditcoin record</span><span className="vdetail-v">0x1c7e...9a04</span></div>
              <div className="vdetail-row"><span className="vdetail-k">Status</span><span className="vdetail-v vdetail-status"><CheckGlyph size={12} /> Verified</span></div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* CREDITCOIN STATE */}
      <section className="section">
        <div className="wrap" style={{ textAlign: "center" }}>
          <Reveal><SectionTag>Creditcoin State</SectionTag><p className="section-title" style={{ margin: "0 auto", textAlign: "center" }}>What actually changes when a repayment clears.</p></Reveal>
          <Reveal stagger={1}>
            <div className="state-compare">
              <div className="state-box"><div className="state-k">Before</div><div className="state-v state-v--before">$0</div></div>
              <span className="state-arrow">→</span>
              <div className="state-box"><div className="state-k">After verified repayment</div><div className="state-v state-v--after">$200</div></div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* UNDER THE HOOD */}
      <section className="section">
        <div className="wrap" style={{ textAlign: "center" }}>
          <Reveal><SectionTag>Under the Hood</SectionTag><p className="section-title" style={{ margin: "0 auto", textAlign: "center" }}>Five layers, in order.</p></Reveal>
          <Reveal stagger={1}>
            <div className="arch-diagram">
              <div className="arch-block"><div className="arch-block-title">Source Chain</div><div className="arch-block-sub">where activity happens</div></div>
              <span className="arch-arrow">↓</span>
              <div className="arch-block"><div className="arch-block-title">Attestcoin</div><div className="arch-block-sub">cryptographic attestation</div></div>
              <span className="arch-arrow">↓</span>
              <div className="arch-block"><div className="arch-block-title">TRU Verification Layer</div><div className="arch-block-sub">validated credit event</div></div>
              <span className="arch-arrow">↓</span>
              <div className="arch-block"><div className="arch-block-title">Creditcoin</div><div className="arch-block-sub">credit state</div></div>
              <span className="arch-arrow">↓</span>
              <div className="arch-block"><div className="arch-block-title">Applications</div><div className="arch-block-sub">lenders, RWA, risk engines</div></div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* WHY ATTESTCOIN */}
      <section className="section">
        <div className="wrap">
          <Reveal><SectionTag>Why Each Layer Matters</SectionTag><p className="section-title">Why each layer is needed.</p></Reveal>
          <Reveal stagger={1}>
            <div className="dep-grid">
              <div className="dep-card"><div className="dep-role">Proof</div><div className="dep-name">Attestcoin</div><p className="dep-body">Without it, TRU cannot reliably know what happened on another chain.</p></div>
              <div className="dep-card"><div className="dep-role">Verification</div><div className="dep-name">TRU</div><p className="dep-body">Without it, the attested event stays raw data. It never becomes verified, replay-guarded history.</p></div>
              <div className="dep-card"><div className="dep-role">Record</div><div className="dep-name">Creditcoin</div><p className="dep-body">Without it, TRU has nowhere to turn verified history into reusable infrastructure.</p></div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* DEVELOPER ARCHITECTURE */}
      <section className="section" id="developers">
        <div className="wrap" style={{ textAlign: "center" }}>
          <Reveal><SectionTag>For Developers</SectionTag><p className="section-title" style={{ margin: "0 auto", textAlign: "center" }}>One query, without touching the chains underneath.</p></Reveal>
          <Reveal stagger={1}>
            <div className="dev-flow">
              <span className="dev-chip">VerifiedEvent</span><span className="dev-flow-arrow">→</span>
              <span className="dev-chip">CreditEvent</span><span className="dev-flow-arrow">→</span>
              <span className="dev-chip">CreditState</span>
            </div>
          </Reveal>
          <Reveal stagger={2}>
            <div className="dev-snippet">
              <span className="k">getCreditEvidence</span>(address) →<br />
              &nbsp;&nbsp;{"{"} creditState, repayments, creditLimit {"}"}
            </div>
          </Reveal>
        </div>
      </section>

      {/* USE CASES */}
      <section className="section" id="docs">
        <div className="wrap">
          <Reveal><SectionTag>Use Cases</SectionTag><p className="section-title">Where verified history actually matters.</p></Reveal>
          <Reveal stagger={1}>
            <div className="cases-list">
              <div className="case-row"><span className="case-n">01</span><div><h3 className="case-title">Cross-chain lending</h3><p className="case-body">A lender can weigh repayment history that happened on a chain they never touch.</p></div></div>
              <div className="case-row"><span className="case-n">02</span><div><h3 className="case-title">RWA and private credit</h3><p className="case-body">Real-world loan performance becomes part of an auditable, on-chain record.</p></div></div>
              <div className="case-row"><span className="case-n">03</span><div><h3 className="case-title">Credit portability</h3><p className="case-body">A borrower's track record travels with them, instead of resetting at the border of a new ecosystem.</p></div></div>
              <div className="case-row"><span className="case-n">04</span><div><h3 className="case-title">Agent obligations</h3><p className="case-body">An agent's completed obligations become portable, verifiable history another protocol can read before delegating work.</p></div></div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* FUTURE VISION */}
      <section className="section">
        <div className="wrap" style={{ textAlign: "center" }}>
          <Reveal><SectionTag>Future Vision</SectionTag><p className="section-title" style={{ margin: "0 auto", textAlign: "center" }}>Grows as the history grows.</p></Reveal>
          <Reveal stagger={1}>
            <div className="vision-flow">
              <span className="vision-step">One chain</span><span className="vision-arrow">↓</span>
              <span className="vision-step">Multiple chains</span><span className="vision-arrow">↓</span>
              <span className="vision-step">Multiple protocols</span><span className="vision-arrow">↓</span>
              <span className="vision-step">Verifiable economic infrastructure</span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="final-cta">
        <Reveal>
          <h2>Financial history shouldn't be trapped by the chain it happened on.</h2>
          <div className="final-actions">
            <button className="btn-primary" onClick={() => navigate("overview")}>Build with TRU <ArrowUpRight /></button>
            <button className="btn-ghost" onClick={() => navigate("protocol")}>Explore the Protocol</button>
          </div>
        </Reveal>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <div className="wrap">
          <div className="footer-top">
            <div>
              <div className="footer-brand-word">TRU</div>
              <p className="footer-brand-desc">Verifiable economic history infrastructure.</p>
            </div>
            <div className="footer-col"><div className="footer-col-title">Protocol</div>
              <a href="#how">How It Works</a><a href="#credit" onClick={(e) => { e.preventDefault(); navigate("credit"); }}>Economic Actors</a><a href="#verifying" onClick={(e) => { e.preventDefault(); navigate("verifying"); }}>Verification</a>
            </div>
            <div className="footer-col"><div className="footer-col-title">Developers</div>
              <a href="#docs">Documentation</a><a href="https://github.com/Shaydez-Defi/tru" target="_blank" rel="noreferrer">GitHub</a><a href="https://github.com/Shaydez-Defi/tru/tree/main/contracts/src" target="_blank" rel="noreferrer">Contracts</a>
            </div>
            <div className="footer-col"><div className="footer-col-title">Ecosystem</div>
              <a href="https://creditcoin.org" target="_blank" rel="noreferrer">Creditcoin</a><a href="https://github.com/Shaydez-Defi/tru/blob/main/docs/ATTESTCOIN-INTEGRATION.md" target="_blank" rel="noreferrer">Attestcoin</a><a href="#protocol" onClick={(e) => { e.preventDefault(); navigate("protocol"); }}>Supported Chains</a>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© 2026 TRU. Verifiable economic history infrastructure.</span>
            <span><a className="footer-legal" href="https://github.com/Shaydez-Defi/tru/blob/main/LICENSE" target="_blank" rel="noreferrer">MIT License</a></span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function VerifyingScreen({ navigate, account, selectedEvent }: ScreenProps) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 20000);
    return () => clearInterval(t);
  }, []);
  const att = useAsyncData(() => fetchAttestationStatus(), [tick]);
  const viewer = account ?? SAMPLE_ACTOR_ADDRESS;

  const target: number | null = selectedEvent?.sourceBlock !== undefined
    ? Number(selectedEvent.sourceBlock)
    : att.data !== null ? att.data.sepoliaHead : null;
  const attested: number | null = att.data !== null ? att.data.attestedHeight : null;
  const gap: number | null = target !== null && attested !== null ? target - attested : null;
  const done = gap !== null && gap <= 0;
  const eventDone = selectedEvent?.status === "verified";
  // A verified registry event necessarily completed the whole pipeline, so all
  // stages show done. Otherwise the rail reflects live attestation only: later
  // stages stay pending until a worker actually submits this event.
  const completed = eventDone ? STAGES.length : selectedEvent ? (done ? 2 : 1) : 0;
  const activeIndex = eventDone ? STAGES.length : selectedEvent ? (done ? 2 : 1) : 0;
  const window = 1000;
  const progressPct = done || eventDone ? 100 : attested !== null && target !== null
    ? Math.min(98, Math.max(2, ((attested - (target - window)) / window) * 100))
    : 2;
  const minutesRemaining = gap !== null && gap > 0 ? Math.ceil((gap * BLOCK_TIME_SEC) / 60) : 0;
  const refLabel = !selectedEvent ? "" : selectedEvent.refKind === "obligation" ? `Obligation ${selectedEvent.ref}` : selectedEvent.kind === "origination" ? `Loan Origination ${selectedEvent.ref}` : `Loan Repayment ${selectedEvent.ref}`;

  return (
    <div className="v-root">
      <style>{`
        ${TOKENS}
        *{ box-sizing:border-box; }
        html,body{ margin:0; padding:0; background:var(--bg); }
        .v-root{ min-height:100vh; background:var(--bg); color:var(--text); font-family:var(--font-body); position:relative; overflow:hidden; }
        .v-glow{ position:absolute; top:-14%; left:0; right:0; height:680px; pointer-events:none; z-index:0;
          background:
            radial-gradient(ellipse 460px 260px at 36% 6%, rgba(255,255,255,.10), transparent 62%),
            radial-gradient(ellipse 560px 340px at 66% 16%, rgba(74,96,122,.20), transparent 66%);
          filter:blur(18px); }

        .v-top{ position:relative; z-index:2; display:flex; align-items:center; justify-content:space-between; padding:26px 40px; }
        .v-back{ display:flex; align-items:center; gap:7px; font-size:13.5px; color:var(--text-soft); background:none; border:none; cursor:pointer; }
        .v-back:hover{ color:var(--text); }
        .v-brand{ display:flex; align-items:center; gap:9px; font-family:var(--font-display); font-size:17px; font-weight:700; }
        .v-brand-btn{ display:flex; align-items:center; gap:9px; background:none; border:none; cursor:pointer; color:inherit; font:inherit; padding:0; }

        .v-stage{ position:relative; z-index:2; padding:20px 24px 100px; }
        .v-layout{ display:grid; grid-template-columns:1fr 320px; gap:56px; max-width:1080px; margin:0 auto; align-items:start; }
        .v-main{ display:flex; flex-direction:column; align-items:center; padding-top:8px; }
        @media (max-width:900px){ .v-layout{ grid-template-columns:1fr; } }

        .v-side{ display:flex; flex-direction:column; gap:16px; position:sticky; top:100px; }
        .side-panel{ border:1px solid var(--line); border-radius:14px; padding:20px 22px; background:var(--bg-elevated); }
        .side-title{ font-family:var(--font-mono); font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--accent-bright); margin-bottom:14px; }
        .side-row{ display:flex; justify-content:space-between; align-items:baseline; padding:8px 0; border-top:1px solid var(--line); font-size:12.5px; }
        .side-row:first-of-type{ border-top:none; }
        .side-k{ color:var(--text-soft); }
        .side-v{ font-family:var(--font-mono); color:var(--text); }
        .side-panel--note{ background:var(--bg); }
        .side-note-body{ font-size:12.5px; color:var(--text-soft); line-height:1.6; }
        .v-eyebrow{ font-family:var(--font-mono); font-size:12px; letter-spacing:.06em; text-transform:uppercase; color:var(--accent-bright); margin-bottom:14px; }
        .v-headline{ font-family:var(--font-display); font-size:clamp(28px,3.4vw,42px); font-weight:600; text-align:center; margin:0 0 12px; }
        .v-sub{ font-size:14.5px; color:var(--text-soft); text-align:center; max-width:46ch; margin:0 0 56px; line-height:1.6; }

        /* SIGNATURE VISUAL: two block heights, racing to converge.
           This IS the product's actual mechanism made visible, not a
           generic loading widget standing in for it. */
        .race{ width:100%; max-width:640px; margin-bottom:56px; }
        .race-row{ display:flex; align-items:center; gap:18px; margin-bottom:22px; }
        .race-chip{ flex:none; width:150px; text-align:right; }
        .race-chip-label{ font-size:11px; color:var(--text-faint); text-transform:uppercase; letter-spacing:.05em; }
        .race-chip-value{ font-family:var(--font-mono); font-size:16px; color:var(--text); margin-top:2px; }
        .race-track{ position:relative; flex:1; height:2px; background:var(--line); border-radius:2px; }
        .race-fill{ position:absolute; top:0; left:0; height:100%; background:var(--accent-gradient); border-radius:2px; transition:width .4s var(--ease-out); }
        .race-marker{ position:absolute; top:50%; width:14px; height:14px; border-radius:50%; transform:translate(-50%,-50%); transition:left .4s var(--ease-out); display:flex; align-items:center; justify-content:center; }
        .race-marker--attested{ background:var(--accent-gradient); box-shadow:0 0 0 5px rgba(0,255,198,.28); }
        .race-marker--attested.is-done{ box-shadow:0 0 0 6px rgba(0,255,198,.34); }
        .race-marker--source{ right:-7px; left:auto !important; transform:translateY(-50%); background:var(--bg); border:2px solid var(--text-faint); }
        .race-marker--source.is-done{ opacity:0; }

        .race-gap{ display:flex; align-items:baseline; justify-content:center; gap:10px; padding-top:12px; }
        .race-gap-n{ font-family:var(--font-display); font-size:44px; font-weight:800; color:var(--accent-bright); line-height:1; }
        .race-gap-k{ font-size:13.5px; color:var(--text-soft); max-width:16ch; line-height:1.4; }
        .race-note{ text-align:center; font-size:12px; color:var(--text-faint); margin-top:18px; line-height:1.55; max-width:52ch; margin-left:auto; margin-right:auto; }

        /* STAGE RAIL: a horizontal timeline with real weight, not a
           cramped vertical dot list borrowed from another product. */
        .rail{ width:100%; max-width:640px; position:relative; }
        .rail-track{ position:relative; height:2px; background:var(--line); border-radius:2px; margin:0 22px 20px; }
        .rail-fill{ position:absolute; top:0; left:0; height:100%; background:var(--accent-gradient); border-radius:2px; transition:width .5s var(--ease-in-out); }
        .rail-stops{ display:flex; justify-content:space-between; }
        .rail-stop{ display:flex; flex-direction:column; align-items:center; gap:10px; flex:1; }
        .rail-dot{ width:24px; height:24px; border-radius:50%; border:2px solid var(--line); background:var(--bg);
          display:flex; align-items:center; justify-content:center; transition:border-color .2s var(--ease-out), background .2s var(--ease-out); }
        .rail-stop.is-done .rail-dot{ background:var(--accent-gradient); border-color:transparent; }
        .rail-stop.is-active .rail-dot{ border-color:var(--accent-bright); }
        .rail-spin{ width:14px; height:14px; border-radius:50%; border:2px solid transparent; border-top-color:var(--accent-bright); border-right-color:var(--accent-bright); animation:r-spin .9s linear infinite; }
        @keyframes r-spin{ to{ transform:rotate(360deg); } }
        .rail-label{ font-size:12.5px; color:var(--text-faint); text-align:center; transition:color .2s var(--ease-out); }
        .rail-stop.is-active .rail-label, .rail-stop.is-done .rail-label{ color:var(--text); font-weight:500; }

        .v-footnote{ font-size:12.5px; color:var(--text-faint); text-align:center; margin-top:48px; max-width:48ch; line-height:1.6; }

        @media (prefers-reduced-motion: reduce){ .rail-spin{ animation:none; border-color:var(--accent-bright); } }
        @media (max-width:640px){ .race-chip{ width:96px; } .race-chip-value{ font-size:13px; } .rail-label{ font-size:10.5px; } }
      `}</style>

      <div className="v-glow" />

      <div className="v-top">
        <button className="v-back" onClick={() => navigate("events")}><ArrowLeft /> Verified Events</button>
        <div className="v-brand"><button className="v-brand-btn" onClick={() => navigate("landing")} aria-label="Back to home"><TruMark size={20} /> TRU</button></div>
      </div>

      <div className="v-stage">
        <div className="v-layout">
          <div className="v-main">
            <span className="v-eyebrow">{selectedEvent ? refLabel : "Network attestation"}</span>
            <h1 className="v-headline">{eventDone || done ? "Verification complete" : att.loading ? "Reading attestation…" : att.data === undefined ? "Attestation unavailable" : "Attestation is catching up"}</h1>
            <p className="v-sub">
              {eventDone
                ? "Attestcoin confirmed this event and Creditcoin recorded it. The numbers below are the live attestation head, shown for transparency."
                : selectedEvent
                  ? "Attestcoin hasn't reached this event's block yet. The estimate below tracks the live attestation head and refreshes automatically."
                  : "Live gap between Ethereum Sepolia's head and where Attestcoin has attested through so far. Select an event to track it specifically."}
            </p>

        <div className="race">
          <div className="race-row">
            <div className="race-chip"><div className="race-chip-label">Attested through</div><div className="race-chip-value">{attested !== null ? attested.toLocaleString() : "…"}</div></div>
            <div className="race-track">
              <div className="race-fill" style={{ width: `${progressPct}%` }} />
              <div className={`race-marker race-marker--attested ${done || eventDone ? "is-done" : ""}`} style={{ left: `${progressPct}%` }}>
                {(done || eventDone) && <CheckGlyph size={9} color="var(--bg)" />}
              </div>
              <div className={`race-marker race-marker--source ${done || eventDone ? "is-done" : ""}`} />
            </div>
            <div className="race-chip" style={{ textAlign: "left" }}><div className="race-chip-label">{selectedEvent ? "Event block" : "Sepolia head"}</div><div className="race-chip-value">{target !== null ? target.toLocaleString() : "…"}</div></div>
          </div>

          {!(done || eventDone) ? (
            <div className="race-gap">
              <span className="race-gap-n">~{gap !== null ? minutesRemaining : "…"}</span>
              <span className="race-gap-k">minutes remaining · {gap !== null ? `${gap.toLocaleString()} blocks behind` : "reading live gap"}, refreshing</span>
            </div>
          ) : (
            <div className="race-gap">
              <span className="race-gap-n"><CheckGlyph size={30} color="var(--accent-bright)" /></span>
              <span className="race-gap-k">Fully caught up</span>
            </div>
          )}
          <p className="race-note">It comes from the gap between Ethereum Sepolia's current height and where Attestcoin has attested through so far.</p>
        </div>

            <div className="rail">
              <div className="rail-track"><div className="rail-fill" style={{ width: `${(completed / STAGES.length) * 100}%` }} /></div>
              <div className="rail-stops">
                {STAGES.map((s, i) => (
                  <div key={s.key} className={`rail-stop ${i < completed ? "is-done" : i === activeIndex && !done ? "is-active" : ""}`}>
                    <span className="rail-dot">{i < completed ? <CheckGlyph size={11} /> : i === activeIndex && !done ? <span className="rail-spin" /> : null}</span>
                    <span className="rail-label">{s.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <p className="v-footnote">The wait belongs to Attestcoin gathering real confirmations on Sepolia. TRU can't speed it up, so it shows the wait directly instead of hiding it behind a spinner.</p>
          </div>

          <aside className="v-side">
            <div className="side-panel">
              <div className="side-title">{selectedEvent ? "Event Details" : "Network status"}</div>
              {selectedEvent ? (
                <>
                  <div className="side-row"><span className="side-k">{selectedEvent.refKind === "obligation" ? "Obligation" : "Loan"} ID</span><span className="side-v">{selectedEvent.ref}</span></div>
                  <div className="side-row"><span className="side-k">{selectedEvent.refKind === "obligation" ? "Executor" : "Borrower"}</span><span className="side-v">{truncateAddress(viewer)}</span></div>
                  <div className="side-row"><span className="side-k">Amount</span><span className="side-v">{selectedEvent.amount}</span></div>
                  <div className="side-row"><span className="side-k">Event</span><span className="side-v">{selectedEvent.event}</span></div>
                  <div className="side-row"><span className="side-k">Source chain</span><span className="side-v">Ethereum Sepolia</span></div>
                  <div className="side-row"><span className="side-k">Source tx</span><span className="side-v">{selectedEvent.tx}</span></div>
                  <div className="side-row"><span className="side-k">Source block</span><span className="side-v">{selectedEvent.sourceBlock ?? "n/a"}</span></div>
                </>
              ) : (
                <>
                  <div className="side-row"><span className="side-k">Sepolia head</span><span className="side-v">{att.data !== null ? att.data.sepoliaHead.toLocaleString() : "…"}</span></div>
                  <div className="side-row"><span className="side-k">Attested through</span><span className="side-v">{attested !== null ? attested.toLocaleString() : "…"}</span></div>
                  <div className="side-row"><span className="side-k">Source chain</span><span className="side-v">Ethereum Sepolia</span></div>
                </>
              )}
            </div>
            <div className="side-panel side-panel--note">
              <div className="side-title">Why this takes time</div>
              <p className="side-note-body">Attestcoin needs enough confirmations on Sepolia before it will attest to an event. That wait is what makes the resulting record verifiable.</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function OverviewScreen({ navigate, active, account, onSelectEvent }: ScreenProps) {
  const [collapsed, setCollapsed] = useState(false);
  const viewer = account ?? SAMPLE_ACTOR_ADDRESS;
  const history = useAsyncData(() => fetchVerifiedHistory(viewer), [viewer]);
  const entries = history.data ?? [];
  const summary = summarizeHistory(entries);
  const buckets = bucketByMonth(entries);
  const bucketMax = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="app-root">
      <style>{`
        ${TOKENS}
        *{ box-sizing:border-box; }
        html,body{ margin:0; padding:0; background:var(--bg); }
        .app-root{ min-height:100vh; background:var(--bg); color:var(--text); font-family:var(--font-body); display:flex; position:relative; }
        .dither{ position:fixed; inset:0; pointer-events:none; z-index:0; opacity:.04;
          background-image:radial-gradient(circle at 1px 1px, var(--accent-bright) 1px, transparent 0);
          background-size:5px 5px; }
        .sidebar, .main{ position:relative; z-index:1; }
        @media (max-width:860px){ .app-root{ display:block; } }

        /* SIDEBAR */
        .sidebar{ border-right:1px solid var(--line-soft); display:flex; flex-direction:column; padding:20px 14px; position:sticky; top:0;
          height:100vh; flex:none; width:236px; transition:width .32s var(--ease-in-out), padding .32s var(--ease-in-out); overflow:hidden; }
        .sidebar.is-collapsed{ width:68px; padding:20px 10px; }
        @media (max-width:860px){ .sidebar{ display:none; } }
        .sb-label{ display:inline-block; white-space:nowrap; transition:opacity .18s var(--ease-out), max-width .28s var(--ease-in-out); opacity:1; max-width:160px; overflow:hidden; }
        .sidebar.is-collapsed .sb-label{ opacity:0; max-width:0; }

        /* Header row: logo + toggle live together, properly */
        .sb-header{ display:flex; align-items:center; justify-content:space-between; padding:6px 8px 26px; }
        .sidebar.is-collapsed .sb-header{ flex-direction:column; justify-content:center; gap:14px; padding:6px 0 22px; }
        .sb-brand{ display:flex; align-items:center; gap:9px; overflow:hidden; background:none; border:none; cursor:pointer; padding:0; color:inherit; font:inherit; text-align:left; transition:gap .3s var(--ease-in-out); }
        .sb-brand svg{ flex:none; }
        .sidebar.is-collapsed .sb-brand{ justify-content:center; gap:0; }
        .sb-brand-word{ font-family:var(--font-display); font-size:16px; font-weight:700; }
        .sb-toggle{ flex:none; width:28px; height:28px; border-radius:8px; border:none; background:transparent;
          display:flex; align-items:center; justify-content:center; color:var(--text-faint); cursor:pointer;
          transition:background .15s var(--ease-out), color .15s var(--ease-out); }
        .sb-toggle:hover{ background:var(--bg-elevated); color:var(--accent-bright); }

        .sb-section-label{ font-family:var(--font-mono); font-size:9.5px; letter-spacing:.08em; text-transform:uppercase;
          color:var(--text-faint); padding:0 12px 8px; }
        .sidebar.is-collapsed .sb-section-label{ opacity:0; height:0; padding:0; overflow:hidden; }

        .sb-nav{ display:flex; flex-direction:column; gap:3px; flex:1; }
        .sb-link{ position:relative; display:flex; align-items:center; gap:11px; font-size:13.5px; color:var(--text-soft); text-decoration:none;
          padding:9px 12px; border-radius:9px; transition:background .15s var(--ease-out), color .15s var(--ease-out), border-color .15s var(--ease-out), gap .3s var(--ease-in-out);
          border:1px solid transparent; }
        .sb-link:hover{ background:var(--bg-elevated); color:var(--text); }
        .sb-link.is-active{ background:rgba(74,96,122,.18); border-color:rgba(74,96,122,.30); color:var(--accent-bright); }
        .sb-link svg{ flex:none; }
        .sidebar.is-collapsed .sb-link{ justify-content:center; gap:0; }

        /* Collapsed hover tooltip */
        .sb-tooltip{ position:absolute; left:calc(100% + 10px); top:50%; transform:translateY(-50%); z-index:30;
          background:var(--bg-elevated-2); border:1px solid var(--line); border-radius:8px; padding:6px 11px;
          font-size:12px; color:var(--text); white-space:nowrap; opacity:0; pointer-events:none; transition:opacity .15s var(--ease-out); }
        .sidebar.is-collapsed .sb-link:hover .sb-tooltip{ opacity:1; }

        .sb-foot{ display:flex; flex-direction:column; gap:2px; padding-top:12px; border-top:1px solid var(--line-soft); }
        .sb-wallet{ display:flex; align-items:center; gap:10px; padding:10px 12px; margin-top:8px; border:1px solid var(--line); border-radius:10px; transition:gap .3s var(--ease-in-out), padding .3s var(--ease-in-out); }
        .sidebar.is-collapsed .sb-wallet{ justify-content:center; padding:10px; gap:0; }
        .sidebar.is-collapsed .sb-wallet-text{ display:none; }
        .sb-wallet-dot{ width:7px; height:7px; border-radius:50%; background:var(--accent-bright); flex:none; }
        .sb-wallet-addr{ font-family:var(--font-mono); font-size:12px; color:var(--text); }
        .sb-wallet-net{ font-size:10.5px; color:var(--text-faint); }

        /* MAIN */
        .main{ flex:1; min-width:0; }
        .topbar{ display:flex; align-items:center; justify-content:flex-end; padding:22px 40px; border-bottom:1px solid var(--line-soft); gap:14px; }
        .net-chip{ display:flex; align-items:center; gap:7px; font-size:12.5px; color:var(--text-soft); border:1px solid var(--line); border-radius:100px; padding:6px 13px; }
        .net-dot{ width:6px; height:6px; border-radius:50%; background:#5fd88a; }
        .content{ padding:44px 40px 80px; max-width:1280px; margin:0 auto; position:relative; }

        .page-eyebrow{ font-family:var(--font-mono); font-size:11.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--accent-bright); margin-bottom:8px; }
        .page-title{ font-family:var(--font-display); font-size:clamp(26px,2.4vw,32px); font-weight:600; margin:0 0 32px; }

        .dash-grid{ display:grid; grid-template-columns:1fr 300px; gap:28px; align-items:start; }
        .dash-main{ display:flex; flex-direction:column; gap:24px; min-width:0; }
        .dash-side{ display:flex; flex-direction:column; gap:16px; position:sticky; top:96px; }
        @media (max-width:1000px){ .dash-grid{ grid-template-columns:1fr; } .dash-side{ position:static; } }

        /* CREDIT STATE: a glass ledger object with real depth, not a flat box */
        .credit-panel{ position:relative; border:1px solid var(--line); border-radius:16px; padding:32px 36px; background:var(--bg-elevated); overflow:hidden; }
        .credit-panel::before{ content:""; position:absolute; top:0; left:36px; right:36px; height:1px; background:var(--accent-gradient); opacity:.5; z-index:1; }
        .credit-glow{ position:absolute; top:-60%; right:-20%; width:340px; height:340px; border-radius:50%;
          background:radial-gradient(circle, rgba(74,96,122,.20), transparent 70%); pointer-events:none; }
        .credit-sheen{ position:absolute; inset:0; background:linear-gradient(120deg, rgba(255,255,255,.04) 0%, transparent 30%); pointer-events:none; }
        .credit-status-row{ position:relative; display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; }
        .credit-status-label{ font-size:12px; color:var(--text-soft); }
        .credit-verify-chip{ display:flex; align-items:center; gap:6px; font-size:11.5px; color:var(--accent-bright); font-family:var(--font-mono); }
        .credit-status-word{ position:relative; font-family:var(--font-display); font-size:clamp(30px,3.4vw,40px); font-weight:700; line-height:1; margin-bottom:22px; }
        .credit-highlight{ position:relative; display:flex; align-items:baseline; justify-content:space-between;
          background:linear-gradient(120deg, rgba(0,255,198,.14), rgba(0,255,198,.04));
          border:1px solid rgba(0,255,198,.28); border-radius:10px; padding:14px 18px; margin-bottom:20px; }
        .credit-highlight-k{ font-size:12.5px; color:var(--text-soft); }
        .credit-highlight-v{ font-family:var(--font-display); font-size:24px; font-weight:700; color:var(--accent-bright); }
        .credit-basis{ position:relative; font-size:13.5px; color:var(--text-soft); margin-bottom:22px; }
        .credit-derivation{ position:relative; font-size:12px; color:var(--text-faint); padding-top:20px; border-top:1px solid var(--line); line-height:1.6; }

        /* WIDGETS */
        .widget-row{ display:grid; grid-template-columns:1.4fr 1fr; gap:20px; }
        @media (max-width:700px){ .widget-row{ grid-template-columns:1fr; } }
        .widget{ border:1px solid var(--line); border-radius:14px; padding:22px 24px; background:var(--bg-elevated); }
        .widget-title{ font-family:var(--font-display); font-size:14px; font-weight:600; }
        .widget-sub{ font-size:11.5px; color:var(--text-faint); margin-top:2px; }
        .chart-bars{ display:flex; align-items:flex-end; gap:10px; height:90px; margin-top:20px; }
        .chart-bar-wrap{ flex:1; display:flex; align-items:flex-end; height:100%; }
        .chart-bar{ width:100%; background:var(--accent-gradient); border-radius:4px 4px 1px 1px; }
        .chart-bar.is-empty{ background:var(--line); }
        .chart-labels{ display:flex; justify-content:space-between; margin-top:8px; font-size:9.5px; color:var(--text-faint); font-family:var(--font-mono); letter-spacing:.03em; }
        .widget--gauge{ display:flex; flex-direction:column; }
        .gauge-wrap{ display:flex; justify-content:center; margin-top:8px; }

        /* SIDEBAR WIDGETS */
        .side-widget{ border:1px solid var(--line); border-radius:14px; padding:20px 22px; background:var(--bg-elevated); }
        /* Quick actions live in the sidebar on desktop: show this card only
           where the sidebar is hidden (small screens), as a fallback nav. */
        .side-widget--qa{ display:none; }
        @media (max-width:860px){ .side-widget--qa{ display:block; } }
        .identity-widget{ display:flex; flex-direction:column; align-items:center; text-align:center; gap:4px; }
        .identicon{ display:grid; grid-template-columns:repeat(4,9px); grid-template-rows:repeat(4,9px); gap:2px; margin-bottom:14px; padding:8px; border-radius:10px; background:var(--bg); border:1px solid var(--line); }
        .identicon-cell{ border-radius:1.5px; background:transparent; }
        .identicon-cell.is-on{ background:var(--accent-gradient); }
        .identity-addr{ font-family:var(--font-mono); font-size:13px; color:var(--text); }
        .identity-net{ font-size:11.5px; color:var(--text-soft); margin-top:2px; }
        .identity-since{ font-size:10.5px; color:var(--text-faint); margin-top:8px; }

        .quick-actions{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:16px; }
        .qa-btn{ display:flex; flex-direction:column; align-items:center; gap:7px; padding:12px 4px; border-radius:10px; border:1px solid var(--line);
          background:var(--bg); color:var(--text-soft); text-decoration:none; cursor:pointer; font-size:10px; transition:border-color .15s var(--ease-out), color .15s var(--ease-out); }
        .qa-btn:hover{ border-color:rgba(0,255,198,.35); color:var(--accent-bright); }

        .mini-entry{ display:flex; align-items:flex-start; gap:10px; padding:12px 0; border-top:1px solid var(--line); }
        .mini-entry:first-of-type{ border-top:none; padding-top:16px; }
        .mini-entry-dot{ width:7px; height:7px; border-radius:50%; background:var(--accent-gradient); margin-top:5px; flex:none; }
        .mini-entry-text{ display:flex; flex-direction:column; gap:2px; min-width:0; }
        .mini-entry-event{ font-size:12.5px; color:var(--text); }
        .mini-entry-meta{ font-size:11px; color:var(--text-faint); font-family:var(--font-mono); }

        /* SECTION HEAD */
        .section-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
        .section-title{ font-family:var(--font-display); font-size:17px; font-weight:600; }
        .section-link{ font-size:12.5px; color:var(--text-soft); text-decoration:none; display:flex; align-items:center; gap:5px; }
        .section-link:hover{ color:var(--accent-bright); }
        .section-sub{ font-size:12.5px; color:var(--text-faint); margin-bottom:22px; }

        /* LEDGER: stamped entries, not a card grid */
        .ledger{ border-top:1px solid var(--line); }
        .ledger-row{ display:flex; align-items:center; gap:20px; padding:22px 4px; border-bottom:1px solid var(--line); }
        .seal{ position:relative; flex:none; border-radius:50%;
          background:repeating-conic-gradient(rgba(255,255,255,.4) 0deg 1.6deg, rgba(0,0,0,.35) 1.6deg 3.2deg); }
        .seal-core{ position:absolute; inset:4px; border-radius:50%;
          background:radial-gradient(circle at 32% 28%, #C9FFF2 0%, #4A607A 52%, #22303F 100%);
          display:flex; align-items:center; justify-content:center;
          box-shadow:0 2px 5px rgba(0,0,0,.35), inset 0 1px 1px rgba(255,255,255,.5), inset 0 -2px 3px rgba(0,0,0,.25); }
        .ledger-body{ flex:1; min-width:0; }
        .ledger-top{ display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:5px; }
        .ledger-event{ font-family:var(--font-display); font-size:15px; font-weight:600; }
        .ledger-amount{ font-family:var(--font-mono); font-size:14.5px; color:var(--accent-bright); flex:none; }
        .ledger-meta{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:11.5px; color:var(--text-faint); }
        .ledger-chain-path{ display:flex; align-items:center; gap:5px; font-family:var(--font-mono); }
        .ledger-chain-path b{ color:var(--text-soft); font-weight:500; }
        .ledger-proof{ font-family:var(--font-mono); color:var(--text-soft); }
        .ledger-dot{ width:2px; height:2px; border-radius:50%; background:var(--text-faint); }
        .ledger-view{ flex:none; font-size:12px; color:var(--text-soft); background:none; border:1px solid var(--line); border-radius:8px; padding:7px 12px; cursor:pointer; transition:border-color .15s var(--ease-out), color .15s var(--ease-out); }
        .ledger-view:hover{ border-color:rgba(0,255,198,.40); color:var(--accent-bright); }

        @media (max-width:700px){
          .content{ padding:32px 20px 60px; }
          .credit-panel{ padding:24px 22px; }
          .widget-row{ grid-template-columns:1fr; }
          .quick-actions{ grid-template-columns:repeat(2,1fr); }
          .ledger-row{ flex-wrap:wrap; gap:14px; }
          .ledger-view{ display:none; }
        }
      `}</style>

      <div className="dither" />

      <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
        <div className="sb-header">
          <button className="sb-brand" onClick={() => navigate("landing")} aria-label="Back to home">
            <TruMark size={20} />
            <span className="sb-brand-word sb-label">TRU</span>
          </button>
          <button className="sb-toggle" onClick={() => setCollapsed((c) => !c)} aria-label="Toggle sidebar">
            <SidebarToggleIcon />
          </button>
        </div>

        <span className="sb-section-label">Navigation</span>
        <nav className="sb-nav">
          <a className={`sb-link ${active === "overview" ? "is-active" : ""}`} href="#overview" onClick={(e) => { e.preventDefault(); navigate("overview"); }}>
            <OverviewIcon /> <span className="sb-label">Overview</span>
            {collapsed && <span className="sb-tooltip">Overview</span>}
          </a>
          <a className="sb-link" href="#credit" onClick={(e) => { e.preventDefault(); navigate("credit"); }}>
            <CreditIcon /> <span className="sb-label">Economic Actor</span>
            {collapsed && <span className="sb-tooltip">Economic Actor</span>}
          </a>
          <a className="sb-link" href="#events" onClick={(e) => { e.preventDefault(); navigate("events"); }}>
            <EventsIcon /> <span className="sb-label">Verified Events</span>
            {collapsed && <span className="sb-tooltip">Verified Events</span>}
          </a>
          <a className="sb-link" href="#protocol" onClick={(e) => { e.preventDefault(); navigate("protocol"); }}>
            <ProtocolIcon /> <span className="sb-label">Protocol</span>
            {collapsed && <span className="sb-tooltip">Protocol</span>}
          </a>
        </nav>

        <div className="sb-foot">
          <a className="sb-link" href="#settings">
            <SettingsIcon /> <span className="sb-label">Settings</span>
            {collapsed && <span className="sb-tooltip">Settings</span>}
          </a>
          <button className="sb-wallet" onClick={() => navigate("connect")} aria-label="Connect wallet">
            <span className="sb-wallet-dot" />
            <div className="sb-wallet-text"><div className="sb-wallet-addr">{account ? truncateAddress(account) : "Not connected"}</div><div className="sb-wallet-net">Ethereum Sepolia</div></div>
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <button className="topbar-brand" onClick={() => navigate("landing")} aria-label="Back to home"><TruMark size={18} /><span>TRU</span></button>
          <span className="net-chip"><span className="net-dot" /> Sepolia</span>
          <button className="net-chip net-chip--btn" onClick={() => navigate("connect")}>{account ? truncateAddress(account) : "Not connected"}</button>
        </div>

        <div className="content">
          <span className="page-eyebrow">Overview</span>
          <h1 className="page-title">{account ? "Your verified history" : "Verified history: demo profile"}</h1>

          <div className="dash-grid">
            <div className="dash-main">
              <div className="credit-panel">
                <div className="credit-glow" />
                <div className="credit-sheen" />
                <div className="credit-status-row">
                  <span className="credit-status-label">Verified economic history</span>
                  <span className="credit-verify-chip"><CheckGlyph size={11} color="var(--accent-bright)" /> Verified</span>
                </div>
                <div className="credit-status-word">Verified</div>
                <div className="credit-highlight">
                  <span className="credit-highlight-k">Verified events</span>
                  <span className="credit-highlight-v">{history.loading ? "…" : summary.verifiedEvents}</span>
                </div>
                <div className="credit-basis">{history.loading ? "Loading verified events…" : history.error ? "Couldn't load on-chain history. Check your connection and retry." : `${summary.verifiedEvents} verified events · ${summary.verifiedObligations} obligations · ${summary.completedObligations} completions.`}</div>
                <div className="credit-derivation">
                  {!account && "Demo data · Ethereum Sepolia. "}Every figure derives from verified on-chain events recorded through TRU, not assigned. Open a ledger entry below to see the source transaction and attestation behind it.
                </div>
              </div>

              <div className="widget-row">
                <div className="widget">
                  <div className="widget-title">Verification activity</div>
                  <div className="widget-sub">{history.loading ? "Loading…" : "Verified events by month"}</div>
                  <div className="chart-bars">
                    {buckets.map((m) => (
                      <div className="chart-bar-wrap" key={m.label}>
                        <div className={`chart-bar ${m.count === 0 ? "is-empty" : ""}`} style={{ height: `${Math.max(4, (m.count / bucketMax) * 78)}px` }} />
                      </div>
                    ))}
                  </div>
                  <div className="chart-labels">{buckets.map((m) => <span key={m.label}>{m.label}</span>)}</div>
                </div>

                <div className="widget widget--gauge">
                  <div className="widget-title">Completion rate</div>
                  <div className="widget-sub">{summary.completedObligations} of {summary.verifiedObligations} completed</div>
                  <div className="gauge-wrap"><RateGauge pct={summary.completionRatePct} caption="completed" /></div>
                </div>
              </div>

              <div className="widget-row">
                <div className="widget">
                  <div className="widget-title">Obligations</div>
                  <div className="widget-sub">Verified obligation lifecycle</div>
                  <div className="mini-entry">
                    <span className="mini-entry-dot" />
                    <div className="mini-entry-text">
                      <span className="mini-entry-event">{summary.completedObligations} completed</span>
                      <span className="mini-entry-meta">verified completions</span>
                    </div>
                  </div>
                  <div className="mini-entry">
                    <span className="mini-entry-dot" />
                    <div className="mini-entry-text">
                      <span className="mini-entry-event">{summary.activeObligations} active</span>
                      <span className="mini-entry-meta">open obligations</span>
                    </div>
                  </div>
                </div>

                <div className="widget">
                  <div className="widget-title">Settlement</div>
                  <div className="widget-sub">Value and reach</div>
                  <div className="mini-entry">
                    <span className="mini-entry-dot" />
                    <div className="mini-entry-text">
                        <span className="mini-entry-event">{formatUnits(summary.settlementVolumeUnits)}</span>
                        <span className="mini-entry-meta">settlement volume</span>
                    </div>
                  </div>
                  <div className="mini-entry">
                    <span className="mini-entry-dot" />
                    <div className="mini-entry-text">
                      <span className="mini-entry-event">{summary.completionRatePct}% completion</span>
                      <span className="mini-entry-meta">{summary.completedObligations} of {summary.verifiedObligations} verified obligations</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="section-head">
                <span className="section-title">Recent Verified Activity</span>
                <a className="section-link" href="#events" onClick={(e) => { e.preventDefault(); navigate("events"); }}>View all <ArrowUpRight /></a>
              </div>
              <p className="section-sub">Financial events and obligation events, under one verified-history system.</p>

              <div className="ledger">
                {history.loading && <div className="ledger-row"><div className="ledger-body"><div className="ledger-top"><span className="ledger-event">Loading verified events…</span></div></div></div>}
                {!history.loading && entries.length === 0 && <div className="ledger-row"><div className="ledger-body"><div className="ledger-top"><span className="ledger-event">No verified events yet</span></div><div className="ledger-meta"><span>{history.error ? "Couldn't load on-chain history." : "Complete an obligation or repay a loan on Sepolia to start history."}</span></div></div></div>}
                {entries.map((e, i) => (
                  <div className="ledger-row" key={i}>
                    {e.status === "verified" ? <Seal size={40} /> : <PendingMark size={40} />}
                    <div className="ledger-body">
                      <div className="ledger-top">
                        <span className="ledger-event">{e.event}</span>
                        <span className="ledger-amount">{e.amount}</span>
                      </div>
                      <div className="ledger-meta">
                        <span className="ledger-chain-path"><b>Ethereum</b> → <b>Attestcoin</b> → <b>Creditcoin</b></span>
                        <span className="ledger-dot" />
                        <span>{e.refKind === "obligation" ? "Obligation" : "Loan"} {e.ref}</span>
                        <span className="ledger-dot" />
                        <span>{e.date}</span>
                        <span className="ledger-dot" />
                        <span className="ledger-proof">{e.tx}</span>
                      </div>
                    </div>
                    <button className="ledger-view" onClick={() => { onSelectEvent?.(e); navigate(e.status === "verified" ? "event-detail" : "verifying"); }}>{e.status === "verified" ? "View proof" : "Track status"}</button>
                  </div>
                ))}
              </div>

              <div className="section-head" style={{ marginTop: 40 }}>
                <span className="section-title">Financial History</span>
                <a className="section-link" href="#events" onClick={(e) => { e.preventDefault(); navigate("events"); }}>View all <ArrowUpRight /></a>
              </div>
              <p className="section-sub">Loans are one category of verified history.</p>

              <div className="ledger">
                {entries.filter((e) => e.refKind === "loan").map((e, i) => (
                  <div className="ledger-row" key={i}>
                    {e.status === "verified" ? <Seal size={40} /> : <PendingMark size={40} />}
                    <div className="ledger-body">
                      <div className="ledger-top">
                        <span className="ledger-event">{e.event}</span>
                        <span className="ledger-amount">{e.amount}</span>
                      </div>
                      <div className="ledger-meta">
                        <span className="ledger-chain-path"><b>Ethereum</b> → <b>Attestcoin</b> → <b>Creditcoin</b></span>
                        <span className="ledger-dot" />
                        <span>Loan {e.ref}</span>
                        <span className="ledger-dot" />
                        <span>{e.date}</span>
                        <span className="ledger-dot" />
                        <span className="ledger-proof">{e.tx}</span>
                      </div>
                    </div>
                    <button className="ledger-view" onClick={() => { onSelectEvent?.(e); navigate(e.status === "verified" ? "event-detail" : "verifying"); }}>{e.status === "verified" ? "View proof" : "Track status"}</button>
                  </div>
                ))}
              </div>
            </div>

            <aside className="dash-side">
              <div className="side-widget identity-widget">
                <Identicon addr={account ?? SAMPLE_ACTOR_ADDRESS} />
                <div className="identity-addr">{account ? truncateAddress(account) : "Demo profile"}</div>
                <div className="identity-net">Ethereum Sepolia</div>
                <div className="identity-since">{account ? "Connected wallet" : "Demo profile: connect a wallet for live history"}</div>
              </div>

              <div className="side-widget side-widget--qa">
                <div className="widget-title">Quick actions</div>
                <div className="quick-actions">
                  <a className="qa-btn" href="#events" onClick={(e) => { e.preventDefault(); navigate("events"); }}><EventsIcon /><span>Events</span></a>
                  <a className="qa-btn" href="#protocol" onClick={(e) => { e.preventDefault(); navigate("protocol"); }}><ProtocolIcon /><span>Protocol</span></a>
                  <a className="qa-btn" href="#credit" onClick={(e) => { e.preventDefault(); navigate("credit"); }}><CreditIcon /><span>Profile</span></a>
                  <button className="qa-btn"><ExportIcon /><span>Export</span></button>
                </div>
              </div>

              <div className="side-widget">
                <div className="widget-title">Recent activity</div>
                {entries.slice(0, 2).map((e, i) => (
                  <div className="mini-entry" key={i}>
                    <span className="mini-entry-dot" />
                    <div className="mini-entry-text">
                      <span className="mini-entry-event">{e.event}</span>
                      <span className="mini-entry-meta">{e.amount} · {e.date}</span>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}

function CreditProfileScreen({ navigate, active, account, onSelectEvent }: ScreenProps) {
  const [whyOpen, setWhyOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const viewer = account ?? SAMPLE_ACTOR_ADDRESS;
  const history = useAsyncData(() => fetchVerifiedHistory(viewer), [viewer]);
  const entries = history.data ?? [];
  const summary = summarizeHistory(entries);
  const evidence = useAsyncData(() => fetchCreditEvidence(viewer), [viewer]);
  const passport = useAsyncData(() => fetchAgentPassport(viewer), [viewer]);
  const openCount = useAsyncData(() => fetchOutstandingObligations(viewer), [viewer]);
  const ev = evidence.data;
  const pp = passport.data;
  const stateName = ev ? ["New", "Building", "Established", "Verified"][ev.creditState] ?? "Unknown" : "…";
  const strip = entries.slice(0, 8).reverse();
  return (
    <div className="app-root">
      <style>{`
        ${TOKENS}
        *{ box-sizing:border-box; }
        html,body{ margin:0; padding:0; background:var(--bg); }
        .app-root{ min-height:100vh; background:var(--bg); color:var(--text); font-family:var(--font-body); display:flex; position:relative; }
        .dither{ position:fixed; inset:0; pointer-events:none; z-index:0; opacity:.04;
          background-image:radial-gradient(circle at 1px 1px, var(--accent-bright) 1px, transparent 0);
          background-size:5px 5px; }
        .sidebar, .main{ position:relative; z-index:1; }
        @media (max-width:860px){ .app-root{ display:block; } }

        /* SIDEBAR */
        .sidebar{ border-right:1px solid var(--line-soft); display:flex; flex-direction:column; padding:20px 14px; position:sticky; top:0;
          height:100vh; flex:none; width:236px; transition:width .32s var(--ease-in-out), padding .32s var(--ease-in-out); overflow:hidden; }
        .sidebar.is-collapsed{ width:68px; padding:20px 10px; }
        @media (max-width:860px){ .sidebar{ display:none; } }
        .sb-label{ display:inline-block; white-space:nowrap; transition:opacity .18s var(--ease-out), max-width .28s var(--ease-in-out); opacity:1; max-width:160px; overflow:hidden; }
        .sidebar.is-collapsed .sb-label{ opacity:0; max-width:0; }

        /* Header row: logo + toggle live together, properly */
        .sb-header{ display:flex; align-items:center; justify-content:space-between; padding:6px 8px 26px; }
        .sidebar.is-collapsed .sb-header{ flex-direction:column; justify-content:center; gap:14px; padding:6px 0 22px; }
        .sb-brand{ display:flex; align-items:center; gap:9px; overflow:hidden; background:none; border:none; cursor:pointer; padding:0; color:inherit; font:inherit; text-align:left; transition:gap .3s var(--ease-in-out); }
        .sb-brand svg{ flex:none; }
        .sidebar.is-collapsed .sb-brand{ justify-content:center; gap:0; }
        .sb-brand-word{ font-family:var(--font-display); font-size:16px; font-weight:700; }
        .sb-toggle{ flex:none; width:28px; height:28px; border-radius:8px; border:none; background:transparent;
          display:flex; align-items:center; justify-content:center; color:var(--text-faint); cursor:pointer;
          transition:background .15s var(--ease-out), color .15s var(--ease-out); }
        .sb-toggle:hover{ background:var(--bg-elevated); color:var(--accent-bright); }

        .sb-section-label{ font-family:var(--font-mono); font-size:9.5px; letter-spacing:.08em; text-transform:uppercase;
          color:var(--text-faint); padding:0 12px 8px; }
        .sidebar.is-collapsed .sb-section-label{ opacity:0; height:0; padding:0; overflow:hidden; }

        .sb-nav{ display:flex; flex-direction:column; gap:3px; flex:1; }
        .sb-link{ position:relative; display:flex; align-items:center; gap:11px; font-size:13.5px; color:var(--text-soft); text-decoration:none;
          padding:9px 12px; border-radius:9px; transition:background .15s var(--ease-out), color .15s var(--ease-out), border-color .15s var(--ease-out), gap .3s var(--ease-in-out);
          border:1px solid transparent; }
        .sb-link:hover{ background:var(--bg-elevated); color:var(--text); }
        .sb-link.is-active{ background:rgba(74,96,122,.18); border-color:rgba(74,96,122,.30); color:var(--accent-bright); }
        .sb-link svg{ flex:none; }
        .sidebar.is-collapsed .sb-link{ justify-content:center; gap:0; }

        /* Collapsed hover tooltip */
        .sb-tooltip{ position:absolute; left:calc(100% + 10px); top:50%; transform:translateY(-50%); z-index:30;
          background:var(--bg-elevated-2); border:1px solid var(--line); border-radius:8px; padding:6px 11px;
          font-size:12px; color:var(--text); white-space:nowrap; opacity:0; pointer-events:none; transition:opacity .15s var(--ease-out); }
        .sidebar.is-collapsed .sb-link:hover .sb-tooltip{ opacity:1; }

        .sb-foot{ display:flex; flex-direction:column; gap:2px; padding-top:12px; border-top:1px solid var(--line-soft); }
        .sb-wallet{ display:flex; align-items:center; gap:10px; padding:10px 12px; margin-top:8px; border:1px solid var(--line); border-radius:10px; transition:gap .3s var(--ease-in-out), padding .3s var(--ease-in-out); }
        .sidebar.is-collapsed .sb-wallet{ justify-content:center; padding:10px; gap:0; }
        .sidebar.is-collapsed .sb-wallet-text{ display:none; }
        .sb-wallet-dot{ width:7px; height:7px; border-radius:50%; background:var(--accent-bright); flex:none; }
        .sb-wallet-addr{ font-family:var(--font-mono); font-size:12px; color:var(--text); }
        .sb-wallet-net{ font-size:10.5px; color:var(--text-faint); }

        /* MAIN */
        .main{ flex:1; min-width:0; }
        .topbar{ display:flex; align-items:center; justify-content:flex-end; padding:22px 40px; border-bottom:1px solid var(--line-soft); gap:14px; }
        .net-chip{ display:flex; align-items:center; gap:7px; font-size:12.5px; color:var(--text-soft); border:1px solid var(--line); border-radius:100px; padding:6px 13px; }
        .net-dot{ width:6px; height:6px; border-radius:50%; background:#5fd88a; }
        .content{ padding:44px 40px 80px; max-width:1280px; margin:0 auto; position:relative; }

        .page-eyebrow{ font-family:var(--font-mono); font-size:11.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--accent-bright); margin-bottom:8px; }
        .page-title{ font-family:var(--font-display); font-size:clamp(26px,2.4vw,32px); font-weight:600; margin:0 0 32px; }

        .dash-grid{ display:grid; grid-template-columns:1fr 300px; gap:28px; align-items:start; }
        .dash-main{ display:flex; flex-direction:column; gap:24px; min-width:0; }
        .dash-side{ display:flex; flex-direction:column; gap:16px; position:sticky; top:96px; }
        @media (max-width:1000px){ .dash-grid{ grid-template-columns:1fr; } .dash-side{ position:static; } }

        /* CREDIT STATE: a glass ledger object with real depth, not a flat box */
        .credit-panel{ position:relative; border:1px solid var(--line); border-radius:16px; padding:32px 36px; background:var(--bg-elevated); overflow:hidden; }
        .credit-panel::before{ content:""; position:absolute; top:0; left:36px; right:36px; height:1px; background:var(--accent-gradient); opacity:.5; z-index:1; }
        .credit-glow{ position:absolute; top:-60%; right:-20%; width:340px; height:340px; border-radius:50%;
          background:radial-gradient(circle, rgba(74,96,122,.20), transparent 70%); pointer-events:none; }
        .credit-sheen{ position:absolute; inset:0; background:linear-gradient(120deg, rgba(255,255,255,.04) 0%, transparent 30%); pointer-events:none; }
        .credit-status-row{ position:relative; display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; }
        .credit-status-label{ font-size:12px; color:var(--text-soft); }
        .credit-verify-chip{ display:flex; align-items:center; gap:6px; font-size:11.5px; color:var(--accent-bright); font-family:var(--font-mono); }
        .credit-status-word{ position:relative; font-family:var(--font-display); font-size:clamp(30px,3.4vw,40px); font-weight:700; line-height:1; margin-bottom:22px; }
        .credit-highlight{ position:relative; display:flex; align-items:baseline; justify-content:space-between;
          background:linear-gradient(120deg, rgba(0,255,198,.14), rgba(0,255,198,.04));
          border:1px solid rgba(0,255,198,.28); border-radius:10px; padding:14px 18px; margin-bottom:20px; }
        .credit-highlight-k{ font-size:12.5px; color:var(--text-soft); }
        .credit-highlight-v{ font-family:var(--font-display); font-size:24px; font-weight:700; color:var(--accent-bright); }
        .credit-basis{ position:relative; font-size:13.5px; color:var(--text-soft); margin-bottom:22px; }
        .credit-derivation{ position:relative; font-size:12px; color:var(--text-faint); padding-top:20px; border-top:1px solid var(--line); line-height:1.6; }

        /* WIDGETS */
        .widget-row{ display:grid; grid-template-columns:1.4fr 1fr; gap:20px; }
        @media (max-width:700px){ .widget-row{ grid-template-columns:1fr; } }
        .widget{ border:1px solid var(--line); border-radius:14px; padding:22px 24px; background:var(--bg-elevated); }
        .widget-title{ font-family:var(--font-display); font-size:14px; font-weight:600; }
        .widget-sub{ font-size:11.5px; color:var(--text-faint); margin-top:2px; }
        .chart-bars{ display:flex; align-items:flex-end; gap:10px; height:90px; margin-top:20px; }
        .chart-bar-wrap{ flex:1; display:flex; align-items:flex-end; height:100%; }
        .chart-bar{ width:100%; background:var(--accent-gradient); border-radius:4px 4px 1px 1px; }
        .chart-bar.is-empty{ background:var(--line); }
        .chart-labels{ display:flex; justify-content:space-between; margin-top:8px; font-size:9.5px; color:var(--text-faint); font-family:var(--font-mono); letter-spacing:.03em; }
        .widget--gauge{ display:flex; flex-direction:column; }
        .gauge-wrap{ display:flex; justify-content:center; margin-top:8px; }

        /* SIDEBAR WIDGETS */
        .side-widget{ border:1px solid var(--line); border-radius:14px; padding:20px 22px; background:var(--bg-elevated); }
        /* Quick actions live in the sidebar on desktop: show this card only
           where the sidebar is hidden (small screens), as a fallback nav. */
        .side-widget--qa{ display:none; }
        @media (max-width:860px){ .side-widget--qa{ display:block; } }
        .identity-widget{ display:flex; flex-direction:column; align-items:center; text-align:center; gap:4px; }
        .identicon{ display:grid; grid-template-columns:repeat(4,9px); grid-template-rows:repeat(4,9px); gap:2px; margin-bottom:14px; padding:8px; border-radius:10px; background:var(--bg); border:1px solid var(--line); }
        .identicon-cell{ border-radius:1.5px; background:transparent; }
        .identicon-cell.is-on{ background:var(--accent-gradient); }
        .identity-addr{ font-family:var(--font-mono); font-size:13px; color:var(--text); }
        .identity-net{ font-size:11.5px; color:var(--text-soft); margin-top:2px; }
        .identity-since{ font-size:10.5px; color:var(--text-faint); margin-top:8px; }

        .quick-actions{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:16px; }
        .qa-btn{ display:flex; flex-direction:column; align-items:center; gap:7px; padding:12px 4px; border-radius:10px; border:1px solid var(--line);
          background:var(--bg); color:var(--text-soft); text-decoration:none; cursor:pointer; font-size:10px; transition:border-color .15s var(--ease-out), color .15s var(--ease-out); }
        .qa-btn:hover{ border-color:rgba(0,255,198,.35); color:var(--accent-bright); }

        .mini-entry{ display:flex; align-items:flex-start; gap:10px; padding:12px 0; border-top:1px solid var(--line); }
        .mini-entry:first-of-type{ border-top:none; padding-top:16px; }
        .mini-entry-dot{ width:7px; height:7px; border-radius:50%; background:var(--accent-gradient); margin-top:5px; flex:none; }
        .mini-entry-text{ display:flex; flex-direction:column; gap:2px; min-width:0; }
        .mini-entry-event{ font-size:12.5px; color:var(--text); }
        .mini-entry-meta{ font-size:11px; color:var(--text-faint); font-family:var(--font-mono); }

        /* FACTORS PANEL */
        .factors-panel{ border:1px solid var(--line); border-radius:14px; padding:22px 24px; background:var(--bg-elevated); }
        .factors-list{ margin-top:18px; }
        .factor-row{ display:flex; align-items:center; justify-content:space-between; padding:13px 0; border-top:1px solid var(--line); gap:16px; }
        .factor-row:first-child{ border-top:none; padding-top:16px; }
        .factor-text{ display:flex; flex-direction:column; gap:2px; min-width:0; }
        .factor-k{ font-size:13.5px; color:var(--text); }
        .factor-note{ font-size:11.5px; color:var(--text-faint); }
        .factor-v{ font-family:var(--font-mono); font-size:15px; color:var(--accent-bright); font-weight:600; flex:none; }

        /* WHY-THIS-STATE (expandable, not hidden by default) */
        .why-panel{ border:1px solid var(--line); border-radius:14px; background:var(--bg-elevated); overflow:hidden; }
        .why-toggle{ width:100%; display:flex; align-items:center; justify-content:space-between; padding:18px 22px;
          background:none; border:none; color:var(--text); font-family:var(--font-display); font-size:14.5px; font-weight:600; cursor:pointer; }
        .why-toggle svg{ color:var(--text-faint); flex:none; }
        .why-body{ padding:0 22px 22px; display:flex; flex-direction:column; gap:12px; }
        .why-body p{ font-size:13px; color:var(--text-soft); line-height:1.65; margin:0; }

        /* HISTORY STRIP */
        .history-strip{ position:relative; height:70px; margin-top:20px; }
        .history-line{ position:absolute; top:8px; left:2%; right:2%; height:1px; background:var(--line); }
        .history-point{ position:absolute; top:0; display:flex; flex-direction:column; align-items:center; gap:10px; transform:translateX(-50%); }
        .history-dot{ width:9px; height:9px; border-radius:50%; background:var(--accent-gradient); box-shadow:0 0 0 3px var(--bg-elevated); }
        .history-label{ font-family:var(--font-mono); font-size:10.5px; color:var(--text-faint); white-space:nowrap; }

        /* SECTION HEAD */
        .section-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
        .section-title{ font-family:var(--font-display); font-size:17px; font-weight:600; }
        .section-link{ font-size:12.5px; color:var(--text-soft); text-decoration:none; display:flex; align-items:center; gap:5px; }
        .section-link:hover{ color:var(--accent-bright); }
        .section-sub{ font-size:12.5px; color:var(--text-faint); margin-bottom:22px; }

        /* LEDGER: stamped entries, not a card grid */
        .ledger{ border-top:1px solid var(--line); }
        .ledger-row{ display:flex; align-items:center; gap:20px; padding:22px 4px; border-bottom:1px solid var(--line); }
        .seal{ position:relative; flex:none; border-radius:50%;
          background:repeating-conic-gradient(rgba(255,255,255,.4) 0deg 1.6deg, rgba(0,0,0,.35) 1.6deg 3.2deg); }
        .seal-core{ position:absolute; inset:4px; border-radius:50%;
          background:radial-gradient(circle at 32% 28%, #C9FFF2 0%, #4A607A 52%, #22303F 100%);
          display:flex; align-items:center; justify-content:center;
          box-shadow:0 2px 5px rgba(0,0,0,.35), inset 0 1px 1px rgba(255,255,255,.5), inset 0 -2px 3px rgba(0,0,0,.25); }
        .ledger-body{ flex:1; min-width:0; }
        .ledger-top{ display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:5px; }
        .ledger-event{ font-family:var(--font-display); font-size:15px; font-weight:600; }
        .ledger-amount{ font-family:var(--font-mono); font-size:14.5px; color:var(--accent-bright); flex:none; }
        .ledger-meta{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:11.5px; color:var(--text-faint); }
        .ledger-chain-path{ display:flex; align-items:center; gap:5px; font-family:var(--font-mono); }
        .ledger-chain-path b{ color:var(--text-soft); font-weight:500; }
        .ledger-proof{ font-family:var(--font-mono); color:var(--text-soft); }
        .ledger-dot{ width:2px; height:2px; border-radius:50%; background:var(--text-faint); }
        .ledger-view{ flex:none; font-size:12px; color:var(--text-soft); background:none; border:1px solid var(--line); border-radius:8px; padding:7px 12px; cursor:pointer; transition:border-color .15s var(--ease-out), color .15s var(--ease-out); }
        .ledger-view:hover{ border-color:rgba(0,255,198,.40); color:var(--accent-bright); }

        @media (max-width:700px){
          .content{ padding:32px 20px 60px; }
          .credit-panel{ padding:24px 22px; }
          .widget-row{ grid-template-columns:1fr; }
          .quick-actions{ grid-template-columns:repeat(2,1fr); }
          .ledger-row{ flex-wrap:wrap; gap:14px; }
          .ledger-view{ display:none; }
        }
      `}</style>

      <div className="dither" />

      <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
        <div className="sb-header">
          <button className="sb-brand" onClick={() => navigate("landing")} aria-label="Back to home">
            <TruMark size={20} />
            <span className="sb-brand-word sb-label">TRU</span>
          </button>
          <button className="sb-toggle" onClick={() => setCollapsed((c) => !c)} aria-label="Toggle sidebar">
            <SidebarToggleIcon />
          </button>
        </div>

        <span className="sb-section-label">Navigation</span>
        <nav className="sb-nav">
          <a className={`sb-link ${active === "overview" ? "is-active" : ""}`} href="#overview" onClick={(e) => { e.preventDefault(); navigate("overview"); }}>
            <OverviewIcon /> <span className="sb-label">Overview</span>
            {collapsed && <span className="sb-tooltip">Overview</span>}
          </a>
          <a className={`sb-link ${active === "credit" ? "is-active" : ""}`} href="#credit" onClick={(e) => { e.preventDefault(); navigate("credit"); }}>
            <CreditIcon /> <span className="sb-label">Economic Actor</span>
            {collapsed && <span className="sb-tooltip">Economic Actor</span>}
          </a>
          <a className="sb-link" href="#events" onClick={(e) => { e.preventDefault(); navigate("events"); }}>
            <EventsIcon /> <span className="sb-label">Verified Events</span>
            {collapsed && <span className="sb-tooltip">Verified Events</span>}
          </a>
          <a className="sb-link" href="#protocol" onClick={(e) => { e.preventDefault(); navigate("protocol"); }}>
            <ProtocolIcon /> <span className="sb-label">Protocol</span>
            {collapsed && <span className="sb-tooltip">Protocol</span>}
          </a>
        </nav>

        <div className="sb-foot">
          <a className="sb-link" href="#settings">
            <SettingsIcon /> <span className="sb-label">Settings</span>
            {collapsed && <span className="sb-tooltip">Settings</span>}
          </a>
          <button className="sb-wallet" onClick={() => navigate("connect")} aria-label="Connect wallet">
            <span className="sb-wallet-dot" />
            <div className="sb-wallet-text"><div className="sb-wallet-addr">{account ? truncateAddress(account) : "Not connected"}</div><div className="sb-wallet-net">Ethereum Sepolia</div></div>
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <button className="topbar-brand" onClick={() => navigate("landing")} aria-label="Back to home"><TruMark size={18} /><span>TRU</span></button>
          <span className="net-chip"><span className="net-dot" /> Sepolia</span>
          <button className="net-chip net-chip--btn" onClick={() => navigate("connect")}>{account ? truncateAddress(account) : "Not connected"}</button>
        </div>

        <div className="content">
          <span className="page-eyebrow">Economic Actor</span>
          <h1 className="page-title">What this actor can prove</h1>

          <div className="dash-grid">
            <div className="dash-main">
              <div className="credit-panel">
                <div className="credit-glow" />
                <div className="credit-sheen" />
                <div className="credit-status-row">
                  <span className="credit-status-label">Agent Passport</span>
                  <span className="credit-verify-chip"><CheckGlyph size={11} color="var(--accent-bright)" /> Verified</span>
                </div>
                <div className="credit-status-word">Verified economic history</div>
                <div className="credit-highlight">
                  <span className="credit-highlight-k">Verified obligations</span>
                  <span className="credit-highlight-v">{pp ? pp.verifiedObligations.toString() : "…"}</span>
                </div>
                <div className="credit-basis">{passport.loading ? "Loading Agent Passport…" : pp ? `${summary.verifiedEvents} verified events · ${pp.verifiedObligations} obligations · ${pp.completedObligations} completions.` : "Couldn't load on-chain passport. Check your connection and retry."}</div>
                <div className="credit-derivation">
                  {!account && "Demo data · Ethereum Sepolia. "}Every figure derives from verified on-chain events recorded through TRU, not assigned.
                </div>
              </div>

              <div className="factors-panel">
                <div className="widget-title">Obligation history</div>
                <div className="widget-sub">Deterministic counts from verified obligation events, with no score and no judgment.</div>
                <div className="factors-list">
                  <div className="factor-row">
                    <div className="factor-text"><span className="factor-k">Verified obligations</span><span className="factor-note">Each one attested by Attestcoin independently</span></div>
                    <span className="factor-v">{pp ? pp.verifiedObligations.toString() : "…"}</span>
                  </div>
                  <div className="factor-row">
                    <div className="factor-text"><span className="factor-k">Completed</span><span className="factor-note">Verified completions by this actor</span></div>
                    <span className="factor-v">{pp ? pp.completedObligations.toString() : "…"}</span>
                  </div>
                  <div className="factor-row">
                    <div className="factor-text"><span className="factor-k">Active</span><span className="factor-note">Verified but not yet completed</span></div>
                    <span className="factor-v">{pp ? pp.activeObligations.toString() : "…"}</span>
                  </div>
                  <div className="factor-row">
                    <div className="factor-text"><span className="factor-k">Settlement volume</span><span className="factor-note">Sum of this actor's verified completions, in agreed units</span></div>
                    <span className="factor-v">{pp ? formatUnits(pp.verifiedSettlementVolume) : "…"}</span>
                  </div>
                  <div className="factor-row">
                    <div className="factor-text"><span className="factor-k">Completion rate</span><span className="factor-note">Completed ÷ verified × 10000, in basis points</span></div>
                    <span className="factor-v">{pp ? pp.completionRateBps.toString() : "…"}</span>
                  </div>
                  <div className="factor-row">
                    <div className="factor-text"><span className="factor-k">Source chains</span><span className="factor-note">Distinct chains with verified events</span></div>
                    <span className="factor-v">{pp ? pp.verifiedSourceChains.length : "…"}</span>
                  </div>
                </div>
              </div>

              <div className="section-head">
                <span className="section-title">Verified Obligation History</span>
                <a className="section-link" href="#events" onClick={(e) => { e.preventDefault(); navigate("events"); }}>Full ledger <ArrowUpRight /></a>
              </div>
              <p className="section-sub">Created and completed, each with its status, chain, value, and verification state.</p>

              <div className="ledger">
                {history.loading && <div className="ledger-row"><div className="ledger-body"><div className="ledger-top"><span className="ledger-event">Loading verified obligations…</span></div></div></div>}
                {!history.loading && entries.filter((e) => e.refKind === "obligation").length === 0 && <div className="ledger-row"><div className="ledger-body"><div className="ledger-top"><span className="ledger-event">No verified obligations yet</span></div></div></div>}
                {entries.filter((e) => e.refKind === "obligation").map((e, i) => (
                  <div className="ledger-row" key={i}>
                    {e.status === "verified" ? <Seal size={40} /> : <PendingMark size={40} />}
                    <div className="ledger-body">
                      <div className="ledger-top">
                        <span className="ledger-event">{e.event}</span>
                        <span className="ledger-amount">{e.amount}</span>
                      </div>
                      <div className="ledger-meta">
                        <span className="ledger-chain-path"><b>Ethereum</b> → <b>Attestcoin</b> → <b>Creditcoin</b></span>
                        <span className="ledger-dot" />
                        <span>Obligation {e.ref}</span>
                        <span className="ledger-dot" />
                        <span>{e.date}</span>
                        <span className="ledger-dot" />
                        <span className="ledger-proof">{e.tx}</span>
                      </div>
                    </div>
                    <button className="ledger-view" onClick={() => { onSelectEvent?.(e); navigate(e.status === "verified" ? "event-detail" : "verifying"); }}>{e.status === "verified" ? "View proof" : "Track status"}</button>
                  </div>
                ))}
              </div>

              <div className="section-head" style={{ marginTop: 40 }}>
                <span className="section-title">Evidence, not judgment</span>
              </div>
              <p className="section-sub">An Agent Passport does not assign a trust score. It exposes verified economic events so applications and agents can make their own decisions.</p>

              <div className="factors-panel">
                <div className="widget-title">Same verification primitive</div>
                <div className="widget-sub">One infrastructure serving different economic actors.</div>
                <div className="factors-list">
                  <div className="factor-row">
                    <div className="factor-text"><span className="factor-k">Human financial event</span><span className="factor-note">Loan originated, loan repaid</span></div>
                    <span className="factor-v">→ verified history</span>
                  </div>
                  <div className="factor-row">
                    <div className="factor-text"><span className="factor-k">Agent obligation</span><span className="factor-note">Obligation created, obligation completed</span></div>
                    <span className="factor-v">→ verified history</span>
                  </div>
                </div>
              </div>

              <div className="section-head" style={{ marginTop: 40 }}>
                <span className="section-title">Financial History</span>
                <a className="section-link" href="#events" onClick={(e) => { e.preventDefault(); navigate("events"); }}>Full ledger <ArrowUpRight /></a>
              </div>
              <p className="section-sub">Loans are one category of verified history.</p>

              <div className="factors-panel">
                <div className="widget-title">Contributing factors</div>
                <div className="widget-sub">Every figure below traces to a specific verified event, not an estimate.</div>
                <div className="factors-list">
                  <div className="factor-row">
                    <div className="factor-text"><span className="factor-k">Verified repayments</span><span className="factor-note">Each one attested by Attestcoin independently</span></div>
                    <span className="factor-v">{ev ? ev.repayments.toString() : "…"}</span>
                  </div>
                  <div className="factor-row">
                    <div className="factor-text"><span className="factor-k">Distinct loans repaid</span><span className="factor-note">Replay-protected: each loan credited once</span></div>
                    <span className="factor-v">{ev ? ev.distinctLoansRepaid.toString() : "…"}</span>
                  </div>
                  <div className="factor-row">
                    <div className="factor-text"><span className="factor-k">Total repaid</span><span className="factor-note">Sum of all verified repayment events</span></div>
                    <span className="factor-v">{ev ? formatLoanAmount(ev.totalRepaid.toString()).text : "…"}</span>
                  </div>
                  <div className="factor-row">
                    <div className="factor-text"><span className="factor-k">Credit limit</span><span className="factor-note">0 + 100 per verified repayment, fixed rule</span></div>
                    <span className="factor-v">{ev ? ev.creditLimit.toString() : "…"}</span>
                  </div>
                  <div className="factor-row">
                    <div className="factor-text"><span className="factor-k">Outstanding obligations</span><span className="factor-note">Open obligations for this actor</span></div>
                    <span className="factor-v">{openCount.data !== null ? openCount.data.toString() : "…"}</span>
                  </div>
                </div>
              </div>

              <div className="why-panel">
                <button className="why-toggle" onClick={() => setWhyOpen((o) => !o)}>
                  <span>Why this state, specifically?</span>
                  <ExpandIcon open={whyOpen} />
                </button>
                {whyOpen && (
                  <div className="why-body">
                    <p>TRU doesn't assign "{stateName}" as a label someone chose. It's the output of a fixed rule: 0 verified repayments → New, 1–2 → Building, 3–5 → Established, 6+ → Verified. {ev ? `This profile counts ${ev.repayments} verified repayment${ev.repayments === 1n ? "" : "s"}.` : ""} The rate of repayment plays no part in the rule.</p>
                    <p>Capacity{ev ? ` is ${ev.creditLimit}` : ""}, calculated as 0 + verified repayments × 100, the contract's fixed rule. It rises automatically as more repayments verify, not on request. The same verified-events principle covers obligations: completions ÷ verified × 10000 gives{pp ? ` ${pp.completionRateBps}` : ""} basis points, with no score assigned by anyone.</p>
                  </div>
                )}
              </div>

              <div className="section-head">
                <span className="section-title">History</span>
                <a className="section-link" href="#events" onClick={(e) => { e.preventDefault(); navigate("events"); }}>Full ledger <ArrowUpRight /></a>
              </div>
              <p className="section-sub">Each mark is a verified event, placed by date.</p>
              <div className="history-strip">
                <div className="history-line" />
                {history.loading && <span className="history-label" style={{ left: "8%" }}>Loading…</span>}
                {strip.map((e, i, arr) => (
                  <div className="history-point" key={i} style={{ left: `${arr.length > 1 ? 8 + (i * 84) / (arr.length - 1) : 50}%` }}>
                    <span className="history-dot" />
                    <span className="history-label">{e.date.replace(", 2026", "")}</span>
                  </div>
                ))}
              </div>
            </div>

            <aside className="dash-side">
              <div className="side-widget identity-widget">
                <Identicon addr={account ?? SAMPLE_ACTOR_ADDRESS} />
                <div className="identity-addr">{account ? truncateAddress(account) : "Demo profile"}</div>
                <div className="identity-net">Ethereum Sepolia</div>
                <div className="identity-since">{account ? "Connected wallet" : "Demo profile: connect a wallet for live history"}</div>
              </div>

              <div className="side-widget side-widget--qa">
                <div className="widget-title">Quick actions</div>
                <div className="quick-actions">
                  <a className="qa-btn" href="#events" onClick={(e) => { e.preventDefault(); navigate("events"); }}><EventsIcon /><span>Events</span></a>
                  <a className="qa-btn" href="#protocol" onClick={(e) => { e.preventDefault(); navigate("protocol"); }}><ProtocolIcon /><span>Protocol</span></a>
                  <a className="qa-btn" href="#overview" onClick={(e) => { e.preventDefault(); navigate("overview"); }}><OverviewIcon /><span>Overview</span></a>
                  <button className="qa-btn"><ExportIcon /><span>Export</span></button>
                </div>
              </div>

              <div className="side-widget">
                <div className="widget-title">Completion rate</div>
                <div className="gauge-wrap"><RateGauge pct={summary.completionRatePct} size={104} caption="completed" /></div>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}

type EventFilter = "all" | "loans" | "obligations" | "pending";

function VerifiedEventsScreen({ navigate, active, account, onSelectEvent }: ScreenProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<EventFilter>("all");
  const viewer = account ?? SAMPLE_ACTOR_ADDRESS;
  const history = useAsyncData(() => fetchVerifiedHistory(viewer), [viewer]);
  const entries = history.data ?? [];
  const verifiedCount = entries.filter((e) => e.status === "verified").length;
  const visible = entries.filter((e) => {
    if (filter === "loans" && e.refKind !== "loan") return false;
    if (filter === "obligations" && e.refKind !== "obligation") return false;
    if (filter === "pending" && e.status !== "pending") return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [e.event, e.amount, e.ref, e.tx, e.date, e.chain].some((v) =>
      v.toLowerCase().includes(q)
    );
  });
  return (
    <div className="app-root">
      <style>{`
        ${TOKENS}
        *{ box-sizing:border-box; }
        html,body{ margin:0; padding:0; background:var(--bg); }
        .app-root{ min-height:100vh; background:var(--bg); color:var(--text); font-family:var(--font-body); display:flex; position:relative; }
        .dither{ position:fixed; inset:0; pointer-events:none; z-index:0; opacity:.04;
          background-image:radial-gradient(circle at 1px 1px, var(--accent-bright) 1px, transparent 0);
          background-size:5px 5px; }
        .sidebar, .main{ position:relative; z-index:1; }
        @media (max-width:860px){ .app-root{ display:block; } }

        /* SIDEBAR */
        .sidebar{ border-right:1px solid var(--line-soft); display:flex; flex-direction:column; padding:20px 14px; position:sticky; top:0;
          height:100vh; flex:none; width:236px; transition:width .32s var(--ease-in-out), padding .32s var(--ease-in-out); overflow:hidden; }
        .sidebar.is-collapsed{ width:68px; padding:20px 10px; }
        @media (max-width:860px){ .sidebar{ display:none; } }
        .sb-label{ display:inline-block; white-space:nowrap; transition:opacity .18s var(--ease-out), max-width .28s var(--ease-in-out); opacity:1; max-width:160px; overflow:hidden; }
        .sidebar.is-collapsed .sb-label{ opacity:0; max-width:0; }

        /* Header row: logo + toggle live together, properly */
        .sb-header{ display:flex; align-items:center; justify-content:space-between; padding:6px 8px 26px; }
        .sidebar.is-collapsed .sb-header{ flex-direction:column; justify-content:center; gap:14px; padding:6px 0 22px; }
        .sb-brand{ display:flex; align-items:center; gap:9px; overflow:hidden; background:none; border:none; cursor:pointer; padding:0; color:inherit; font:inherit; text-align:left; transition:gap .3s var(--ease-in-out); }
        .sb-brand svg{ flex:none; }
        .sidebar.is-collapsed .sb-brand{ justify-content:center; gap:0; }
        .sb-brand-word{ font-family:var(--font-display); font-size:16px; font-weight:700; }
        .sb-toggle{ flex:none; width:28px; height:28px; border-radius:8px; border:none; background:transparent;
          display:flex; align-items:center; justify-content:center; color:var(--text-faint); cursor:pointer;
          transition:background .15s var(--ease-out), color .15s var(--ease-out); }
        .sb-toggle:hover{ background:var(--bg-elevated); color:var(--accent-bright); }

        .sb-section-label{ font-family:var(--font-mono); font-size:9.5px; letter-spacing:.08em; text-transform:uppercase;
          color:var(--text-faint); padding:0 12px 8px; }
        .sidebar.is-collapsed .sb-section-label{ opacity:0; height:0; padding:0; overflow:hidden; }

        .sb-nav{ display:flex; flex-direction:column; gap:3px; flex:1; }
        .sb-link{ position:relative; display:flex; align-items:center; gap:11px; font-size:13.5px; color:var(--text-soft); text-decoration:none;
          padding:9px 12px; border-radius:9px; transition:background .15s var(--ease-out), color .15s var(--ease-out), border-color .15s var(--ease-out), gap .3s var(--ease-in-out);
          border:1px solid transparent; }
        .sb-link:hover{ background:var(--bg-elevated); color:var(--text); }
        .sb-link.is-active{ background:rgba(74,96,122,.18); border-color:rgba(74,96,122,.30); color:var(--accent-bright); }
        .sb-link svg{ flex:none; }
        .sidebar.is-collapsed .sb-link{ justify-content:center; gap:0; }

        /* Collapsed hover tooltip */
        .sb-tooltip{ position:absolute; left:calc(100% + 10px); top:50%; transform:translateY(-50%); z-index:30;
          background:var(--bg-elevated-2); border:1px solid var(--line); border-radius:8px; padding:6px 11px;
          font-size:12px; color:var(--text); white-space:nowrap; opacity:0; pointer-events:none; transition:opacity .15s var(--ease-out); }
        .sidebar.is-collapsed .sb-link:hover .sb-tooltip{ opacity:1; }

        .sb-foot{ display:flex; flex-direction:column; gap:2px; padding-top:12px; border-top:1px solid var(--line-soft); }
        .sb-wallet{ display:flex; align-items:center; gap:10px; padding:10px 12px; margin-top:8px; border:1px solid var(--line); border-radius:10px; transition:gap .3s var(--ease-in-out), padding .3s var(--ease-in-out); }
        .sidebar.is-collapsed .sb-wallet{ justify-content:center; padding:10px; gap:0; }
        .sidebar.is-collapsed .sb-wallet-text{ display:none; }
        .sb-wallet-dot{ width:7px; height:7px; border-radius:50%; background:var(--accent-bright); flex:none; }
        .sb-wallet-addr{ font-family:var(--font-mono); font-size:12px; color:var(--text); }
        .sb-wallet-net{ font-size:10.5px; color:var(--text-faint); }

        /* MAIN */
        .main{ flex:1; min-width:0; }
        .topbar{ display:flex; align-items:center; justify-content:flex-end; padding:22px 40px; border-bottom:1px solid var(--line-soft); gap:14px; }
        .net-chip{ display:flex; align-items:center; gap:7px; font-size:12.5px; color:var(--text-soft); border:1px solid var(--line); border-radius:100px; padding:6px 13px; }
        .net-dot{ width:6px; height:6px; border-radius:50%; background:#5fd88a; }
        .content{ padding:44px 40px 80px; max-width:1280px; margin:0 auto; position:relative; }

        .page-eyebrow{ font-family:var(--font-mono); font-size:11.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--accent-bright); margin-bottom:8px; }
        .page-title{ font-family:var(--font-display); font-size:clamp(26px,2.4vw,32px); font-weight:600; margin:0 0 32px; }

        .dash-grid{ display:grid; grid-template-columns:1fr 300px; gap:28px; align-items:start; }
        .dash-main{ display:flex; flex-direction:column; gap:24px; min-width:0; }
        .dash-side{ display:flex; flex-direction:column; gap:16px; position:sticky; top:96px; }
        @media (max-width:1000px){ .dash-grid{ grid-template-columns:1fr; } .dash-side{ position:static; } }

        /* CREDIT STATE: a glass ledger object with real depth, not a flat box */
        .credit-panel{ position:relative; border:1px solid var(--line); border-radius:16px; padding:32px 36px; background:var(--bg-elevated); overflow:hidden; }
        .credit-panel::before{ content:""; position:absolute; top:0; left:36px; right:36px; height:1px; background:var(--accent-gradient); opacity:.5; z-index:1; }
        .credit-glow{ position:absolute; top:-60%; right:-20%; width:340px; height:340px; border-radius:50%;
          background:radial-gradient(circle, rgba(74,96,122,.20), transparent 70%); pointer-events:none; }
        .credit-sheen{ position:absolute; inset:0; background:linear-gradient(120deg, rgba(255,255,255,.04) 0%, transparent 30%); pointer-events:none; }
        .credit-status-row{ position:relative; display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; }
        .credit-status-label{ font-size:12px; color:var(--text-soft); }
        .credit-verify-chip{ display:flex; align-items:center; gap:6px; font-size:11.5px; color:var(--accent-bright); font-family:var(--font-mono); }
        .credit-status-word{ position:relative; font-family:var(--font-display); font-size:clamp(30px,3.4vw,40px); font-weight:700; line-height:1; margin-bottom:22px; }
        .credit-highlight{ position:relative; display:flex; align-items:baseline; justify-content:space-between;
          background:linear-gradient(120deg, rgba(0,255,198,.14), rgba(0,255,198,.04));
          border:1px solid rgba(0,255,198,.28); border-radius:10px; padding:14px 18px; margin-bottom:20px; }
        .credit-highlight-k{ font-size:12.5px; color:var(--text-soft); }
        .credit-highlight-v{ font-family:var(--font-display); font-size:24px; font-weight:700; color:var(--accent-bright); }
        .credit-basis{ position:relative; font-size:13.5px; color:var(--text-soft); margin-bottom:22px; }
        .credit-derivation{ position:relative; font-size:12px; color:var(--text-faint); padding-top:20px; border-top:1px solid var(--line); line-height:1.6; }

        /* WIDGETS */
        .widget-row{ display:grid; grid-template-columns:1.4fr 1fr; gap:20px; }
        @media (max-width:700px){ .widget-row{ grid-template-columns:1fr; } }
        .widget{ border:1px solid var(--line); border-radius:14px; padding:22px 24px; background:var(--bg-elevated); }
        .widget-title{ font-family:var(--font-display); font-size:14px; font-weight:600; }
        .widget-sub{ font-size:11.5px; color:var(--text-faint); margin-top:2px; }
        .chart-bars{ display:flex; align-items:flex-end; gap:10px; height:90px; margin-top:20px; }
        .chart-bar-wrap{ flex:1; display:flex; align-items:flex-end; height:100%; }
        .chart-bar{ width:100%; background:var(--accent-gradient); border-radius:4px 4px 1px 1px; }
        .chart-bar.is-empty{ background:var(--line); }
        .chart-labels{ display:flex; justify-content:space-between; margin-top:8px; font-size:9.5px; color:var(--text-faint); font-family:var(--font-mono); letter-spacing:.03em; }
        .widget--gauge{ display:flex; flex-direction:column; }
        .gauge-wrap{ display:flex; justify-content:center; margin-top:8px; }

        /* SIDEBAR WIDGETS */
        .side-widget{ border:1px solid var(--line); border-radius:14px; padding:20px 22px; background:var(--bg-elevated); }
        /* Quick actions live in the sidebar on desktop: show this card only
           where the sidebar is hidden (small screens), as a fallback nav. */
        .side-widget--qa{ display:none; }
        @media (max-width:860px){ .side-widget--qa{ display:block; } }
        .identity-widget{ display:flex; flex-direction:column; align-items:center; text-align:center; gap:4px; }
        .identicon{ display:grid; grid-template-columns:repeat(4,9px); grid-template-rows:repeat(4,9px); gap:2px; margin-bottom:14px; padding:8px; border-radius:10px; background:var(--bg); border:1px solid var(--line); }
        .identicon-cell{ border-radius:1.5px; background:transparent; }
        .identicon-cell.is-on{ background:var(--accent-gradient); }
        .identity-addr{ font-family:var(--font-mono); font-size:13px; color:var(--text); }
        .identity-net{ font-size:11.5px; color:var(--text-soft); margin-top:2px; }
        .identity-since{ font-size:10.5px; color:var(--text-faint); margin-top:8px; }

        .quick-actions{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:16px; }
        .qa-btn{ display:flex; flex-direction:column; align-items:center; gap:7px; padding:12px 4px; border-radius:10px; border:1px solid var(--line);
          background:var(--bg); color:var(--text-soft); text-decoration:none; cursor:pointer; font-size:10px; transition:border-color .15s var(--ease-out), color .15s var(--ease-out); }
        .qa-btn:hover{ border-color:rgba(0,255,198,.35); color:var(--accent-bright); }

        .mini-entry{ display:flex; align-items:flex-start; gap:10px; padding:12px 0; border-top:1px solid var(--line); }
        .mini-entry:first-of-type{ border-top:none; padding-top:16px; }
        .mini-entry-dot{ width:7px; height:7px; border-radius:50%; background:var(--accent-gradient); margin-top:5px; flex:none; }
        .mini-entry-text{ display:flex; flex-direction:column; gap:2px; min-width:0; }
        .mini-entry-event{ font-size:12.5px; color:var(--text); }
        .mini-entry-meta{ font-size:11px; color:var(--text-faint); font-family:var(--font-mono); }

        /* FACTORS PANEL */
        .factors-panel{ border:1px solid var(--line); border-radius:14px; padding:22px 24px; background:var(--bg-elevated); }
        .factors-list{ margin-top:18px; }
        .factor-row{ display:flex; align-items:center; justify-content:space-between; padding:13px 0; border-top:1px solid var(--line); gap:16px; }
        .factor-row:first-child{ border-top:none; padding-top:16px; }
        .factor-text{ display:flex; flex-direction:column; gap:2px; min-width:0; }
        .factor-k{ font-size:13.5px; color:var(--text); }
        .factor-note{ font-size:11.5px; color:var(--text-faint); }
        .factor-v{ font-family:var(--font-mono); font-size:15px; color:var(--accent-bright); font-weight:600; flex:none; }

        /* WHY-THIS-STATE (expandable, not hidden by default) */
        .why-panel{ border:1px solid var(--line); border-radius:14px; background:var(--bg-elevated); overflow:hidden; }
        .why-toggle{ width:100%; display:flex; align-items:center; justify-content:space-between; padding:18px 22px;
          background:none; border:none; color:var(--text); font-family:var(--font-display); font-size:14.5px; font-weight:600; cursor:pointer; }
        .why-toggle svg{ color:var(--text-faint); flex:none; }
        .why-body{ padding:0 22px 22px; display:flex; flex-direction:column; gap:12px; }
        .why-body p{ font-size:13px; color:var(--text-soft); line-height:1.65; margin:0; }

        /* HISTORY STRIP */
        .history-strip{ position:relative; height:70px; margin-top:20px; }
        .history-line{ position:absolute; top:8px; left:2%; right:2%; height:1px; background:var(--line); }
        .history-point{ position:absolute; top:0; display:flex; flex-direction:column; align-items:center; gap:10px; transform:translateX(-50%); }
        .history-dot{ width:9px; height:9px; border-radius:50%; background:var(--accent-gradient); box-shadow:0 0 0 3px var(--bg-elevated); }
        .history-label{ font-family:var(--font-mono); font-size:10.5px; color:var(--text-faint); white-space:nowrap; }

        /* EVENTS TOOLBAR */
        .events-toolbar{ display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:20px; flex-wrap:wrap; }
        .events-search{ display:flex; align-items:center; gap:9px; flex:1; min-width:220px; border:1px solid var(--line); border-radius:10px;
          padding:10px 14px; background:var(--bg-elevated); color:var(--text-faint); }
        .events-search-input{ flex:1; background:none; border:none; outline:none; color:var(--text); font-size:13.5px; font-family:var(--font-body); }
        .events-search-input::placeholder{ color:var(--text-faint); }
        .events-filters{ display:flex; gap:6px; }
        .filter-chip{ font-size:12.5px; color:var(--text-soft); background:var(--bg-elevated); border:1px solid var(--line);
          border-radius:100px; padding:8px 15px; cursor:pointer; transition:border-color .15s var(--ease-out), color .15s var(--ease-out); }
        .filter-chip:hover{ color:var(--text); }
        .filter-chip.is-active{ color:var(--accent-bright); border-color:rgba(0,255,198,.32); background:rgba(0,255,198,.08); }

        .ledger--full{ margin-top:0; }

        /* PENDING MARK: distinct from a verified seal, honest in-progress state */
        .pending-mark{ position:relative; flex:none; border-radius:50%; border:1.5px dashed var(--line);
          background:var(--bg); display:flex; align-items:center; justify-content:center; }
        .pending-spin{ animation:pend-spin .9s linear infinite; }
        @keyframes pend-spin{ to{ transform:rotate(360deg); } }
        @media (prefers-reduced-motion: reduce){ .pending-spin{ animation:none; } }

        /* SUMMARY ROWS */
        .summary-row{ display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-top:1px solid var(--line); font-size:13px; color:var(--text-soft); }
        .summary-row:first-of-type{ border-top:none; padding-top:14px; }
        .summary-v{ font-family:var(--font-mono); color:var(--text); font-weight:600; }

        /* SECTION HEAD */
        .section-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
        .section-title{ font-family:var(--font-display); font-size:17px; font-weight:600; }
        .section-link{ font-size:12.5px; color:var(--text-soft); text-decoration:none; display:flex; align-items:center; gap:5px; }
        .section-link:hover{ color:var(--accent-bright); }
        .section-sub{ font-size:12.5px; color:var(--text-faint); margin-bottom:22px; }

        /* LEDGER: stamped entries, not a card grid */
        .ledger{ border-top:1px solid var(--line); }
        .ledger-row{ display:flex; align-items:center; gap:20px; padding:22px 4px; border-bottom:1px solid var(--line); }
        .seal{ position:relative; flex:none; border-radius:50%;
          background:repeating-conic-gradient(rgba(255,255,255,.4) 0deg 1.6deg, rgba(0,0,0,.35) 1.6deg 3.2deg); }
        .seal-core{ position:absolute; inset:4px; border-radius:50%;
          background:radial-gradient(circle at 32% 28%, #C9FFF2 0%, #4A607A 52%, #22303F 100%);
          display:flex; align-items:center; justify-content:center;
          box-shadow:0 2px 5px rgba(0,0,0,.35), inset 0 1px 1px rgba(255,255,255,.5), inset 0 -2px 3px rgba(0,0,0,.25); }
        .ledger-body{ flex:1; min-width:0; }
        .ledger-top{ display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:5px; }
        .ledger-event{ font-family:var(--font-display); font-size:15px; font-weight:600; }
        .ledger-amount{ font-family:var(--font-mono); font-size:14.5px; color:var(--accent-bright); flex:none; }
        .ledger-meta{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:11.5px; color:var(--text-faint); }
        .ledger-chain-path{ display:flex; align-items:center; gap:5px; font-family:var(--font-mono); }
        .ledger-chain-path b{ color:var(--text-soft); font-weight:500; }
        .ledger-proof{ font-family:var(--font-mono); color:var(--text-soft); }
        .ledger-dot{ width:2px; height:2px; border-radius:50%; background:var(--text-faint); }
        .ledger-view{ flex:none; font-size:12px; color:var(--text-soft); background:none; border:1px solid var(--line); border-radius:8px; padding:7px 12px; cursor:pointer; transition:border-color .15s var(--ease-out), color .15s var(--ease-out); }
        .ledger-view:hover{ border-color:rgba(0,255,198,.40); color:var(--accent-bright); }

        @media (max-width:700px){
          .content{ padding:32px 20px 60px; }
          .credit-panel{ padding:24px 22px; }
          .widget-row{ grid-template-columns:1fr; }
          .quick-actions{ grid-template-columns:repeat(2,1fr); }
          .ledger-row{ flex-wrap:wrap; gap:14px; }
          .ledger-view{ display:none; }
        }
      `}</style>

      <div className="dither" />

      <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
        <div className="sb-header">
          <button className="sb-brand" onClick={() => navigate("landing")} aria-label="Back to home">
            <TruMark size={20} />
            <span className="sb-brand-word sb-label">TRU</span>
          </button>
          <button className="sb-toggle" onClick={() => setCollapsed((c) => !c)} aria-label="Toggle sidebar">
            <SidebarToggleIcon />
          </button>
        </div>

        <span className="sb-section-label">Navigation</span>
        <nav className="sb-nav">
          <a className={`sb-link ${active === "overview" ? "is-active" : ""}`} href="#overview" onClick={(e) => { e.preventDefault(); navigate("overview"); }}>
            <OverviewIcon /> <span className="sb-label">Overview</span>
            {collapsed && <span className="sb-tooltip">Overview</span>}
          </a>
          <a className={`sb-link ${active === "credit" ? "is-active" : ""}`} href="#credit" onClick={(e) => { e.preventDefault(); navigate("credit"); }}>
            <CreditIcon /> <span className="sb-label">Economic Actor</span>
            {collapsed && <span className="sb-tooltip">Economic Actor</span>}
          </a>
          <a className={`sb-link ${active === "events" ? "is-active" : ""}`} href="#events" onClick={(e) => { e.preventDefault(); navigate("events"); }}>
            <EventsIcon /> <span className="sb-label">Verified Events</span>
            {collapsed && <span className="sb-tooltip">Verified Events</span>}
          </a>
          <a className="sb-link" href="#protocol" onClick={(e) => { e.preventDefault(); navigate("protocol"); }}>
            <ProtocolIcon /> <span className="sb-label">Protocol</span>
            {collapsed && <span className="sb-tooltip">Protocol</span>}
          </a>
        </nav>

        <div className="sb-foot">
          <a className="sb-link" href="#settings">
            <SettingsIcon /> <span className="sb-label">Settings</span>
            {collapsed && <span className="sb-tooltip">Settings</span>}
          </a>
          <button className="sb-wallet" onClick={() => navigate("connect")} aria-label="Connect wallet">
            <span className="sb-wallet-dot" />
            <div className="sb-wallet-text"><div className="sb-wallet-addr">{account ? truncateAddress(account) : "Not connected"}</div><div className="sb-wallet-net">Ethereum Sepolia</div></div>
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <button className="topbar-brand" onClick={() => navigate("landing")} aria-label="Back to home"><TruMark size={18} /><span>TRU</span></button>
          <span className="net-chip"><span className="net-dot" /> Sepolia</span>
          <button className="net-chip net-chip--btn" onClick={() => navigate("connect")}>{account ? truncateAddress(account) : "Not connected"}</button>
        </div>

        <div className="content">
          <span className="page-eyebrow">Verified Events</span>
          <h1 className="page-title">Every event, traced to its proof</h1>

          <div className="dash-grid">
            <div className="dash-main">
              <div className="events-toolbar">
                <div className="events-search">
                  <SearchIcon />
                  <input
                    className="events-search-input"
                    placeholder="Search by loan ID, obligation ID, tx hash, or amount"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="events-filters">
                  {(
                    [
                      ["all", "All"],
                      ["loans", "Loans"],
                      ["obligations", "Obligations"],
                      ["pending", "Pending"],
                    ] as [EventFilter, string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      className={`filter-chip ${filter === key ? "is-active" : ""}`}
                      onClick={() => setFilter(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="ledger ledger--full">
                {history.loading && <div className="ledger-row"><div className="ledger-body"><span className="ledger-event">Loading verified events…</span></div></div>}
                {!history.loading && visible.map((e, i) => (
                  <div className="ledger-row" key={i}>
                    {e.status === "verified" ? <Seal size={40} /> : <PendingMark size={40} />}
                    <div className="ledger-body">
                      <div className="ledger-top">
                        <span className="ledger-event">{e.event}</span>
                        <span className="ledger-amount">{e.amount}</span>
                      </div>
                      <div className="ledger-meta">
                        <span className="ledger-chain-path"><b>Ethereum</b> → <b>Attestcoin</b> → <b>Creditcoin</b></span>
                        <span className="ledger-dot" />
                        <span>{e.refKind === "obligation" ? "Obligation" : "Loan"} {e.ref}</span>
                        <span className="ledger-dot" />
                        <span>{e.date}</span>
                        <span className="ledger-dot" />
                        <span className="ledger-proof">{e.tx}</span>
                      </div>
                    </div>
                    <button className="ledger-view" onClick={() => { onSelectEvent?.(e); navigate(e.status === "verified" ? "event-detail" : "verifying"); }}>{e.status === "verified" ? "View proof" : "Track status"}</button>
                  </div>
                ))}
                {!history.loading && visible.length === 0 && (
                  <div className="ledger-row">
                    <div className="ledger-body">
                      <span className="ledger-event">{history.error ? "Couldn't load on-chain history" : entries.length === 0 ? "No verified events yet" : "No matching events"}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <aside className="dash-side">
              <div className="side-widget identity-widget">
                <Identicon addr={account ?? SAMPLE_ACTOR_ADDRESS} />
                <div className="identity-addr">{account ? truncateAddress(account) : "Demo profile"}</div>
                <div className="identity-net">Ethereum Sepolia</div>
                <div className="identity-since">{account ? "Connected wallet" : "Demo profile: connect a wallet for live history"}</div>
              </div>

              <div className="side-widget">
                <div className="widget-title">Event summary</div>
                <div className="summary-row"><span>Total events</span><span className="summary-v">{history.loading ? "…" : entries.length}</span></div>
                <div className="summary-row"><span>Verified</span><span className="summary-v" style={{ color: "var(--accent-bright)" }}>{history.loading ? "…" : verifiedCount}</span></div>
                <div className="summary-row"><span>Pending attestation</span><span className="summary-v">{history.loading ? "…" : entries.length - verifiedCount}</span></div>
              </div>

              <div className="side-widget side-widget--qa">
                <div className="widget-title">Quick actions</div>
                <div className="quick-actions">
                  <a className="qa-btn" href="#overview" onClick={(e) => { e.preventDefault(); navigate("overview"); }}><OverviewIcon /><span>Overview</span></a>
                  <a className="qa-btn" href="#credit" onClick={(e) => { e.preventDefault(); navigate("credit"); }}><CreditIcon /><span>Profile</span></a>
                  <a className="qa-btn" href="#protocol" onClick={(e) => { e.preventDefault(); navigate("protocol"); }}><ProtocolIcon /><span>Protocol</span></a>
                  <button className="qa-btn"><ExportIcon /><span>Export</span></button>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}

function EventDetailScreen({ navigate, active, account, selectedEvent }: ScreenProps) {
  const [collapsed, setCollapsed] = useState(false);
  const viewer = account ?? SAMPLE_ACTOR_ADDRESS;
  const history = useAsyncData(() => fetchVerifiedHistory(viewer), [viewer]);
  const att = useAsyncData(() => fetchAttestationStatus(), []);
  const fallback = (history.data ?? []).find((e) => e.status === "verified") ?? null;
  const e = selectedEvent ?? fallback;
  const isLoan = e?.refKind === "loan";
  const solidityEvent = !e ? "" : e.kind === "repayment" ? "LoanRepaid" : e.kind === "origination" ? "LoanCreated" : e.kind === "obligation-completed" ? "ObligationCompleted" : "ObligationCreated";
  const sourceContract = isLoan ? LOAN_MARKET_ADDRESS : OBLIGATION_MARKET_ADDRESS;
  const attested = att.data !== null && e?.sourceBlock !== undefined && att.data.attestedHeight >= Number(e.sourceBlock);
  return (
    <div className="app-root">
      <style>{`
        ${TOKENS}
        *{ box-sizing:border-box; }
        html,body{ margin:0; padding:0; background:var(--bg); }
        .app-root{ min-height:100vh; background:var(--bg); color:var(--text); font-family:var(--font-body); display:flex; position:relative; }
        .dither{ position:fixed; inset:0; pointer-events:none; z-index:0; opacity:.04;
          background-image:radial-gradient(circle at 1px 1px, var(--accent-bright) 1px, transparent 0);
          background-size:5px 5px; }
        .sidebar, .main{ position:relative; z-index:1; }
        @media (max-width:860px){ .app-root{ display:block; } }

        /* SIDEBAR */
        .sidebar{ border-right:1px solid var(--line-soft); display:flex; flex-direction:column; padding:20px 14px; position:sticky; top:0;
          height:100vh; flex:none; width:236px; transition:width .32s var(--ease-in-out), padding .32s var(--ease-in-out); overflow:hidden; }
        .sidebar.is-collapsed{ width:68px; padding:20px 10px; }
        @media (max-width:860px){ .sidebar{ display:none; } }
        .sb-label{ display:inline-block; white-space:nowrap; transition:opacity .18s var(--ease-out), max-width .28s var(--ease-in-out); opacity:1; max-width:160px; overflow:hidden; }
        .sidebar.is-collapsed .sb-label{ opacity:0; max-width:0; }

        /* Header row: logo + toggle live together, properly */
        .sb-header{ display:flex; align-items:center; justify-content:space-between; padding:6px 8px 26px; }
        .sidebar.is-collapsed .sb-header{ flex-direction:column; justify-content:center; gap:14px; padding:6px 0 22px; }
        .sb-brand{ display:flex; align-items:center; gap:9px; overflow:hidden; background:none; border:none; cursor:pointer; padding:0; color:inherit; font:inherit; text-align:left; transition:gap .3s var(--ease-in-out); }
        .sb-brand svg{ flex:none; }
        .sidebar.is-collapsed .sb-brand{ justify-content:center; gap:0; }
        .sb-brand-word{ font-family:var(--font-display); font-size:16px; font-weight:700; }
        .sb-toggle{ flex:none; width:28px; height:28px; border-radius:8px; border:none; background:transparent;
          display:flex; align-items:center; justify-content:center; color:var(--text-faint); cursor:pointer;
          transition:background .15s var(--ease-out), color .15s var(--ease-out); }
        .sb-toggle:hover{ background:var(--bg-elevated); color:var(--accent-bright); }

        .sb-section-label{ font-family:var(--font-mono); font-size:9.5px; letter-spacing:.08em; text-transform:uppercase;
          color:var(--text-faint); padding:0 12px 8px; }
        .sidebar.is-collapsed .sb-section-label{ opacity:0; height:0; padding:0; overflow:hidden; }

        .sb-nav{ display:flex; flex-direction:column; gap:3px; flex:1; }
        .sb-link{ position:relative; display:flex; align-items:center; gap:11px; font-size:13.5px; color:var(--text-soft); text-decoration:none;
          padding:9px 12px; border-radius:9px; transition:background .15s var(--ease-out), color .15s var(--ease-out), border-color .15s var(--ease-out), gap .3s var(--ease-in-out);
          border:1px solid transparent; }
        .sb-link:hover{ background:var(--bg-elevated); color:var(--text); }
        .sb-link.is-active{ background:rgba(74,96,122,.18); border-color:rgba(74,96,122,.30); color:var(--accent-bright); }
        .sb-link svg{ flex:none; }
        .sidebar.is-collapsed .sb-link{ justify-content:center; gap:0; }

        /* Collapsed hover tooltip */
        .sb-tooltip{ position:absolute; left:calc(100% + 10px); top:50%; transform:translateY(-50%); z-index:30;
          background:var(--bg-elevated-2); border:1px solid var(--line); border-radius:8px; padding:6px 11px;
          font-size:12px; color:var(--text); white-space:nowrap; opacity:0; pointer-events:none; transition:opacity .15s var(--ease-out); }
        .sidebar.is-collapsed .sb-link:hover .sb-tooltip{ opacity:1; }

        .sb-foot{ display:flex; flex-direction:column; gap:2px; padding-top:12px; border-top:1px solid var(--line-soft); }
        .sb-wallet{ display:flex; align-items:center; gap:10px; padding:10px 12px; margin-top:8px; border:1px solid var(--line); border-radius:10px; transition:gap .3s var(--ease-in-out), padding .3s var(--ease-in-out); }
        .sidebar.is-collapsed .sb-wallet{ justify-content:center; padding:10px; gap:0; }
        .sidebar.is-collapsed .sb-wallet-text{ display:none; }
        .sb-wallet-dot{ width:7px; height:7px; border-radius:50%; background:var(--accent-bright); flex:none; }
        .sb-wallet-addr{ font-family:var(--font-mono); font-size:12px; color:var(--text); }
        .sb-wallet-net{ font-size:10.5px; color:var(--text-faint); }

        /* MAIN */
        .main{ flex:1; min-width:0; }
        .topbar{ display:flex; align-items:center; justify-content:flex-end; padding:22px 40px; border-bottom:1px solid var(--line-soft); gap:14px; }
        .net-chip{ display:flex; align-items:center; gap:7px; font-size:12.5px; color:var(--text-soft); border:1px solid var(--line); border-radius:100px; padding:6px 13px; }
        .net-dot{ width:6px; height:6px; border-radius:50%; background:#5fd88a; }
        .content{ padding:44px 40px 80px; max-width:1280px; margin:0 auto; position:relative; }

        .page-eyebrow{ font-family:var(--font-mono); font-size:11.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--accent-bright); margin-bottom:8px; }
        .page-title{ font-family:var(--font-display); font-size:clamp(26px,2.4vw,32px); font-weight:600; margin:0 0 32px; }

        .dash-grid{ display:grid; grid-template-columns:1fr 300px; gap:28px; align-items:start; }
        .dash-main{ display:flex; flex-direction:column; gap:24px; min-width:0; }
        .dash-side{ display:flex; flex-direction:column; gap:16px; position:sticky; top:96px; }
        @media (max-width:1000px){ .dash-grid{ grid-template-columns:1fr; } .dash-side{ position:static; } }

        /* CREDIT STATE: a glass ledger object with real depth, not a flat box */
        .credit-panel{ position:relative; border:1px solid var(--line); border-radius:16px; padding:32px 36px; background:var(--bg-elevated); overflow:hidden; }
        .credit-panel::before{ content:""; position:absolute; top:0; left:36px; right:36px; height:1px; background:var(--accent-gradient); opacity:.5; z-index:1; }
        .credit-glow{ position:absolute; top:-60%; right:-20%; width:340px; height:340px; border-radius:50%;
          background:radial-gradient(circle, rgba(74,96,122,.20), transparent 70%); pointer-events:none; }
        .credit-sheen{ position:absolute; inset:0; background:linear-gradient(120deg, rgba(255,255,255,.04) 0%, transparent 30%); pointer-events:none; }
        .credit-status-row{ position:relative; display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; }
        .credit-status-label{ font-size:12px; color:var(--text-soft); }
        .credit-verify-chip{ display:flex; align-items:center; gap:6px; font-size:11.5px; color:var(--accent-bright); font-family:var(--font-mono); }
        .credit-status-word{ position:relative; font-family:var(--font-display); font-size:clamp(30px,3.4vw,40px); font-weight:700; line-height:1; margin-bottom:22px; }
        .credit-highlight{ position:relative; display:flex; align-items:baseline; justify-content:space-between;
          background:linear-gradient(120deg, rgba(0,255,198,.14), rgba(0,255,198,.04));
          border:1px solid rgba(0,255,198,.28); border-radius:10px; padding:14px 18px; margin-bottom:20px; }
        .credit-highlight-k{ font-size:12.5px; color:var(--text-soft); }
        .credit-highlight-v{ font-family:var(--font-display); font-size:24px; font-weight:700; color:var(--accent-bright); }
        .credit-basis{ position:relative; font-size:13.5px; color:var(--text-soft); margin-bottom:22px; }
        .credit-derivation{ position:relative; font-size:12px; color:var(--text-faint); padding-top:20px; border-top:1px solid var(--line); line-height:1.6; }

        /* WIDGETS */
        .widget-row{ display:grid; grid-template-columns:1.4fr 1fr; gap:20px; }
        @media (max-width:700px){ .widget-row{ grid-template-columns:1fr; } }
        .widget{ border:1px solid var(--line); border-radius:14px; padding:22px 24px; background:var(--bg-elevated); }
        .widget-title{ font-family:var(--font-display); font-size:14px; font-weight:600; }
        .widget-sub{ font-size:11.5px; color:var(--text-faint); margin-top:2px; }
        .chart-bars{ display:flex; align-items:flex-end; gap:10px; height:90px; margin-top:20px; }
        .chart-bar-wrap{ flex:1; display:flex; align-items:flex-end; height:100%; }
        .chart-bar{ width:100%; background:var(--accent-gradient); border-radius:4px 4px 1px 1px; }
        .chart-bar.is-empty{ background:var(--line); }
        .chart-labels{ display:flex; justify-content:space-between; margin-top:8px; font-size:9.5px; color:var(--text-faint); font-family:var(--font-mono); letter-spacing:.03em; }
        .widget--gauge{ display:flex; flex-direction:column; }
        .gauge-wrap{ display:flex; justify-content:center; margin-top:8px; }

        /* SIDEBAR WIDGETS */
        .side-widget{ border:1px solid var(--line); border-radius:14px; padding:20px 22px; background:var(--bg-elevated); }
        /* Quick actions live in the sidebar on desktop: show this card only
           where the sidebar is hidden (small screens), as a fallback nav. */
        .side-widget--qa{ display:none; }
        @media (max-width:860px){ .side-widget--qa{ display:block; } }
        .identity-widget{ display:flex; flex-direction:column; align-items:center; text-align:center; gap:4px; }
        .identicon{ display:grid; grid-template-columns:repeat(4,9px); grid-template-rows:repeat(4,9px); gap:2px; margin-bottom:14px; padding:8px; border-radius:10px; background:var(--bg); border:1px solid var(--line); }
        .identicon-cell{ border-radius:1.5px; background:transparent; }
        .identicon-cell.is-on{ background:var(--accent-gradient); }
        .identity-addr{ font-family:var(--font-mono); font-size:13px; color:var(--text); }
        .identity-net{ font-size:11.5px; color:var(--text-soft); margin-top:2px; }
        .identity-since{ font-size:10.5px; color:var(--text-faint); margin-top:8px; }

        .quick-actions{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:16px; }
        .qa-btn{ display:flex; flex-direction:column; align-items:center; gap:7px; padding:12px 4px; border-radius:10px; border:1px solid var(--line);
          background:var(--bg); color:var(--text-soft); text-decoration:none; cursor:pointer; font-size:10px; transition:border-color .15s var(--ease-out), color .15s var(--ease-out); }
        .qa-btn:hover{ border-color:rgba(0,255,198,.35); color:var(--accent-bright); }

        .mini-entry{ display:flex; align-items:flex-start; gap:10px; padding:12px 0; border-top:1px solid var(--line); }
        .mini-entry:first-of-type{ border-top:none; padding-top:16px; }
        .mini-entry-dot{ width:7px; height:7px; border-radius:50%; background:var(--accent-gradient); margin-top:5px; flex:none; }
        .mini-entry-text{ display:flex; flex-direction:column; gap:2px; min-width:0; }
        .mini-entry-event{ font-size:12.5px; color:var(--text); }
        .mini-entry-meta{ font-size:11px; color:var(--text-faint); font-family:var(--font-mono); }

        /* FACTORS PANEL */
        .factors-panel{ border:1px solid var(--line); border-radius:14px; padding:22px 24px; background:var(--bg-elevated); }
        .factors-list{ margin-top:18px; }
        .factor-row{ display:flex; align-items:center; justify-content:space-between; padding:13px 0; border-top:1px solid var(--line); gap:16px; }
        .factor-row:first-child{ border-top:none; padding-top:16px; }
        .factor-text{ display:flex; flex-direction:column; gap:2px; min-width:0; }
        .factor-k{ font-size:13.5px; color:var(--text); }
        .factor-note{ font-size:11.5px; color:var(--text-faint); }
        .factor-v{ font-family:var(--font-mono); font-size:15px; color:var(--accent-bright); font-weight:600; flex:none; }

        /* WHY-THIS-STATE (expandable, not hidden by default) */
        .why-panel{ border:1px solid var(--line); border-radius:14px; background:var(--bg-elevated); overflow:hidden; }
        .why-toggle{ width:100%; display:flex; align-items:center; justify-content:space-between; padding:18px 22px;
          background:none; border:none; color:var(--text); font-family:var(--font-display); font-size:14.5px; font-weight:600; cursor:pointer; }
        .why-toggle svg{ color:var(--text-faint); flex:none; }
        .why-body{ padding:0 22px 22px; display:flex; flex-direction:column; gap:12px; }
        .why-body p{ font-size:13px; color:var(--text-soft); line-height:1.65; margin:0; }

        /* HISTORY STRIP */
        .history-strip{ position:relative; height:70px; margin-top:20px; }
        .history-line{ position:absolute; top:8px; left:2%; right:2%; height:1px; background:var(--line); }
        .history-point{ position:absolute; top:0; display:flex; flex-direction:column; align-items:center; gap:10px; transform:translateX(-50%); }
        .history-dot{ width:9px; height:9px; border-radius:50%; background:var(--accent-gradient); box-shadow:0 0 0 3px var(--bg-elevated); }
        .history-label{ font-family:var(--font-mono); font-size:10.5px; color:var(--text-faint); white-space:nowrap; }

        /* EVENTS TOOLBAR */
        .events-toolbar{ display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:20px; flex-wrap:wrap; }
        .events-search{ display:flex; align-items:center; gap:9px; flex:1; min-width:220px; border:1px solid var(--line); border-radius:10px;
          padding:10px 14px; background:var(--bg-elevated); color:var(--text-faint); }
        .events-search-input{ flex:1; background:none; border:none; outline:none; color:var(--text); font-size:13.5px; font-family:var(--font-body); }
        .events-search-input::placeholder{ color:var(--text-faint); }
        .events-filters{ display:flex; gap:6px; }
        .filter-chip{ font-size:12.5px; color:var(--text-soft); background:var(--bg-elevated); border:1px solid var(--line);
          border-radius:100px; padding:8px 15px; cursor:pointer; transition:border-color .15s var(--ease-out), color .15s var(--ease-out); }
        .filter-chip:hover{ color:var(--text); }
        .filter-chip.is-active{ color:var(--accent-bright); border-color:rgba(0,255,198,.32); background:rgba(0,255,198,.08); }

        .ledger--full{ margin-top:0; }

        /* PENDING MARK: distinct from a verified seal, honest in-progress state */
        .pending-mark{ position:relative; flex:none; border-radius:50%; border:1.5px dashed var(--line);
          background:var(--bg); display:flex; align-items:center; justify-content:center; }
        .pending-spin{ animation:pend-spin .9s linear infinite; }
        @keyframes pend-spin{ to{ transform:rotate(360deg); } }
        @media (prefers-reduced-motion: reduce){ .pending-spin{ animation:none; } }

        /* SUMMARY ROWS */
        .summary-row{ display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-top:1px solid var(--line); font-size:13px; color:var(--text-soft); }
        .summary-row:first-of-type{ border-top:none; padding-top:14px; }
        .summary-v{ font-family:var(--font-mono); color:var(--text); font-weight:600; }

        /* EVENT DETAIL */
        .back-link{ display:inline-flex; align-items:center; gap:7px; font-size:13px; color:var(--text-soft); text-decoration:none; margin-bottom:22px; }
        .back-link:hover{ color:var(--text); }
        .detail-head{ margin-bottom:28px; }
        .detail-status{ display:inline-flex; align-items:center; gap:6px; font-size:12px; font-family:var(--font-mono); color:var(--accent-bright); }

        .proof-chain{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; border:1px solid var(--line); border-radius:14px;
          padding:20px 22px; background:var(--bg-elevated); margin-bottom:24px; }
        .proof-node{ display:flex; align-items:center; gap:8px; font-family:var(--font-mono); font-size:12.5px; color:var(--text-soft);
          border:1px solid var(--line); border-radius:9px; padding:9px 13px; }
        .proof-node.is-done{ background:var(--accent-gradient); color:var(--bg); border-color:transparent; font-weight:600; }
        .proof-arrow{ color:var(--text-faint); font-size:13px; }

        .detail-panel{ border:1px solid var(--line); border-radius:14px; padding:20px 24px; background:var(--bg-elevated); margin-bottom:16px; }
        .detail-panel-title{ font-family:var(--font-mono); font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--accent-bright); margin-bottom:14px; }
        .detail-row{ display:flex; justify-content:space-between; align-items:baseline; padding:9px 0; border-top:1px solid var(--line); font-size:13px; gap:16px; }
        .detail-row:first-of-type{ border-top:none; padding-top:0; }
        .detail-k{ color:var(--text-soft); flex:none; }
        .detail-v{ font-family:var(--font-mono); color:var(--text); text-align:right; }
        .detail-v--ok{ color:var(--accent-bright); display:inline-flex; align-items:center; gap:6px; }
        .detail-link{ display:inline-flex; align-items:center; gap:6px; color:var(--accent-bright); text-decoration:none; }
        .detail-link:hover{ text-decoration:underline; }

        .checklist{ display:flex; flex-direction:column; gap:11px; }
        .checklist-item{ display:flex; align-items:center; gap:9px; font-size:13.5px; color:var(--text); }

        .security-note{ display:flex; align-items:flex-start; gap:12px; border:1px solid rgba(74,96,122,.30); border-radius:14px;
          padding:18px 22px; background:rgba(74,96,122,.07); margin-top:8px; }
        .security-note svg{ flex:none; color:var(--accent-bright); margin-top:2px; }
        .security-note p{ font-size:12.5px; color:var(--text-soft); line-height:1.6; margin:0; }

        /* SECTION HEAD */
        .section-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
        .section-title{ font-family:var(--font-display); font-size:17px; font-weight:600; }
        .section-link{ font-size:12.5px; color:var(--text-soft); text-decoration:none; display:flex; align-items:center; gap:5px; }
        .section-link:hover{ color:var(--accent-bright); }
        .section-sub{ font-size:12.5px; color:var(--text-faint); margin-bottom:22px; }

        /* LEDGER: stamped entries, not a card grid */
        .ledger{ border-top:1px solid var(--line); }
        .ledger-row{ display:flex; align-items:center; gap:20px; padding:22px 4px; border-bottom:1px solid var(--line); }
        .seal{ position:relative; flex:none; border-radius:50%;
          background:repeating-conic-gradient(rgba(255,255,255,.4) 0deg 1.6deg, rgba(0,0,0,.35) 1.6deg 3.2deg); }
        .seal-core{ position:absolute; inset:4px; border-radius:50%;
          background:radial-gradient(circle at 32% 28%, #C9FFF2 0%, #4A607A 52%, #22303F 100%);
          display:flex; align-items:center; justify-content:center;
          box-shadow:0 2px 5px rgba(0,0,0,.35), inset 0 1px 1px rgba(255,255,255,.5), inset 0 -2px 3px rgba(0,0,0,.25); }
        .ledger-body{ flex:1; min-width:0; }
        .ledger-top{ display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:5px; }
        .ledger-event{ font-family:var(--font-display); font-size:15px; font-weight:600; }
        .ledger-amount{ font-family:var(--font-mono); font-size:14.5px; color:var(--accent-bright); flex:none; }
        .ledger-meta{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:11.5px; color:var(--text-faint); }
        .ledger-chain-path{ display:flex; align-items:center; gap:5px; font-family:var(--font-mono); }
        .ledger-chain-path b{ color:var(--text-soft); font-weight:500; }
        .ledger-proof{ font-family:var(--font-mono); color:var(--text-soft); }
        .ledger-dot{ width:2px; height:2px; border-radius:50%; background:var(--text-faint); }
        .ledger-view{ flex:none; font-size:12px; color:var(--text-soft); background:none; border:1px solid var(--line); border-radius:8px; padding:7px 12px; cursor:pointer; transition:border-color .15s var(--ease-out), color .15s var(--ease-out); }
        .ledger-view:hover{ border-color:rgba(0,255,198,.40); color:var(--accent-bright); }

        @media (max-width:700px){
          .content{ padding:32px 20px 60px; }
          .credit-panel{ padding:24px 22px; }
          .widget-row{ grid-template-columns:1fr; }
          .quick-actions{ grid-template-columns:repeat(2,1fr); }
          .ledger-row{ flex-wrap:wrap; gap:14px; }
          .ledger-view{ display:none; }
        }
      `}</style>

      <div className="dither" />

      <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
        <div className="sb-header">
          <button className="sb-brand" onClick={() => navigate("landing")} aria-label="Back to home">
            <TruMark size={20} />
            <span className="sb-brand-word sb-label">TRU</span>
          </button>
          <button className="sb-toggle" onClick={() => setCollapsed((c) => !c)} aria-label="Toggle sidebar">
            <SidebarToggleIcon />
          </button>
        </div>

        <span className="sb-section-label">Navigation</span>
        <nav className="sb-nav">
          <a className={`sb-link ${active === "overview" ? "is-active" : ""}`} href="#overview" onClick={(e) => { e.preventDefault(); navigate("overview"); }}>
            <OverviewIcon /> <span className="sb-label">Overview</span>
            {collapsed && <span className="sb-tooltip">Overview</span>}
          </a>
          <a className={`sb-link ${active === "credit" ? "is-active" : ""}`} href="#credit" onClick={(e) => { e.preventDefault(); navigate("credit"); }}>
            <CreditIcon /> <span className="sb-label">Economic Actor</span>
            {collapsed && <span className="sb-tooltip">Economic Actor</span>}
          </a>
          <a className={`sb-link ${active === "events" ? "is-active" : ""}`} href="#events" onClick={(e) => { e.preventDefault(); navigate("events"); }}>
            <EventsIcon /> <span className="sb-label">Verified Events</span>
            {collapsed && <span className="sb-tooltip">Verified Events</span>}
          </a>
          <a className="sb-link" href="#protocol" onClick={(e) => { e.preventDefault(); navigate("protocol"); }}>
            <ProtocolIcon /> <span className="sb-label">Protocol</span>
            {collapsed && <span className="sb-tooltip">Protocol</span>}
          </a>
        </nav>

        <div className="sb-foot">
          <a className="sb-link" href="#settings">
            <SettingsIcon /> <span className="sb-label">Settings</span>
            {collapsed && <span className="sb-tooltip">Settings</span>}
          </a>
          <button className="sb-wallet" onClick={() => navigate("connect")} aria-label="Connect wallet">
            <span className="sb-wallet-dot" />
            <div className="sb-wallet-text"><div className="sb-wallet-addr">{account ? truncateAddress(account) : "Not connected"}</div><div className="sb-wallet-net">Ethereum Sepolia</div></div>
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <button className="topbar-brand" onClick={() => navigate("landing")} aria-label="Back to home"><TruMark size={18} /><span>TRU</span></button>
          <span className="net-chip"><span className="net-dot" /> Sepolia</span>
          <button className="net-chip net-chip--btn" onClick={() => navigate("connect")}>{account ? truncateAddress(account) : "Not connected"}</button>
        </div>

        <div className="content">
          <a className="back-link" href="#events" onClick={(e) => { e.preventDefault(); navigate("events"); }}><ArrowLeft /> Verified Events</a>

          <div className="detail-head">
            <div>
              <span className="page-eyebrow">{e ? `${isLoan ? (e.kind === "origination" ? "Loan Origination" : "Loan Repayment") : "Obligation"} ${e.ref}` : "Event"}</span>
              <h1 className="page-title" style={{ marginBottom: 6 }}>{history.loading && !e ? "Loading…" : e ? e.amount : "No event selected"}</h1>
              {e && <span className="detail-status"><CheckGlyph size={11} color="var(--accent-bright)" /> Verified</span>}
            </div>
          </div>

          {!e && !history.loading && (
            <div className="detail-panel">
              <div className="detail-row"><span className="detail-k">Nothing to show</span><span className="detail-v">Open an entry from Verified Events to trace it to its proof.</span></div>
            </div>
          )}

          {e && (
          <div className="dash-grid">
            <div className="dash-main">
              {/* Chain: same node language as the rest of the product, now shown complete */}
              <div className="proof-chain">
                <div className="proof-node"><ShieldGlyph size={16} /><span>Ethereum Sepolia</span></div>
                <span className="proof-arrow">→</span>
                <div className="proof-node"><ShieldGlyph size={16} /><span>Attestcoin</span></div>
                <span className="proof-arrow">→</span>
                <div className="proof-node"><TruMark size={14} color="var(--accent-bright)" /><span>TRU</span></div>
                <span className="proof-arrow">→</span>
                <div className="proof-node is-done"><CheckGlyph size={13} color="var(--bg)" /><span>Creditcoin</span></div>
              </div>

              <div className="detail-panel">
                <div className="detail-panel-title">Source</div>
                <div className="detail-row"><span className="detail-k">Chain</span><span className="detail-v">Ethereum Sepolia</span></div>
                <div className="detail-row"><span className="detail-k">Event</span><span className="detail-v">{solidityEvent}</span></div>
                <div className="detail-row"><span className="detail-k">Source contract</span><span className="detail-v">{truncateHash(sourceContract)}</span></div>
                <div className="detail-row"><span className="detail-k">Source block</span><span className="detail-v">{e.sourceBlock}</span></div>
                <div className="detail-row">
                  <span className="detail-k">Source transaction</span>
                  {e.fullTxHash ? (
                    <a className="detail-v detail-link" href={`https://sepolia.etherscan.io/tx/${e.fullTxHash}`} target="_blank" rel="noreferrer">{e.tx} <ExternalLink /></a>
                  ) : (
                    <span className="detail-v">{e.tx}</span>
                  )}
                </div>
              </div>

              <div className="detail-panel">
                <div className="detail-panel-title">Attestation</div>
                <div className="detail-row"><span className="detail-k">Provider</span><span className="detail-v">Attestcoin</span></div>
                <div className="detail-row"><span className="detail-k">Status</span><span className="detail-v detail-v--ok"><CheckGlyph size={11} /> {att.loading ? "Checking…" : attested ? "Verified" : "Confirming on proof builder"}</span></div>
                <div className="detail-row"><span className="detail-k">Attested through block</span><span className="detail-v">{att.data !== null ? att.data.attestedHeight.toString() : "…"}</span></div>
              </div>

              <div className="detail-panel">
                <div className="detail-panel-title">TRU verification</div>
                <div className="checklist">
                  {["Source contract verified", "Event verified", isLoan ? "Borrower verified" : "Executor verified", isLoan ? "Loan ID verified" : "Obligation ID verified", "Replay protection passed"].map((c) => (
                    <div className="checklist-item" key={c}><CheckGlyph size={13} color="var(--accent-bright)" /> {c}</div>
                  ))}
                </div>
              </div>

              <div className="detail-panel">
                <div className="detail-panel-title">Creditcoin</div>
                <div className="detail-row"><span className="detail-k">{isLoan ? "Credit state" : "Passport"}</span><span className="detail-v detail-v--ok"><CheckGlyph size={11} /> Updated</span></div>
                <div className="detail-row"><span className="detail-k">Registry record</span><span className="detail-v">Recorded on Creditcoin</span></div>
              </div>

              <div className="security-note">
                <ShieldGlyph size={16} />
                <p>TRU didn't trust a submitted {isLoan ? "borrower" : "executor"}, amount, or {isLoan ? "loan" : "obligation"} ID for this event. The contract read all three directly from the verified source-chain transaction, not from anything typed into a form.</p>
              </div>
            </div>

            <aside className="dash-side">
              <div className="side-widget">
                <div className="widget-title">This event</div>
                <div className="summary-row"><span>{isLoan ? "Loan" : "Obligation"}</span><span className="summary-v">{e.ref}</span></div>
                <div className="summary-row"><span>Date</span><span className="summary-v">{e.date}</span></div>
                <div className="summary-row"><span>Source block</span><span className="summary-v">{e.sourceBlock ?? "n/a"}</span></div>
              </div>

              <div className="side-widget side-widget--qa">
                <div className="widget-title">Quick actions</div>
                <div className="quick-actions">
                  <a className="qa-btn" href="#events" onClick={(ev) => { ev.preventDefault(); navigate("events"); }}><EventsIcon /><span>Events</span></a>
                  <a className="qa-btn" href="#credit" onClick={(ev) => { ev.preventDefault(); navigate("credit"); }}><CreditIcon /><span>Profile</span></a>
                  <a className="qa-btn" href="#overview" onClick={(ev) => { ev.preventDefault(); navigate("overview"); }}><OverviewIcon /><span>Overview</span></a>
                  <button className="qa-btn"><ExportIcon /><span>Export</span></button>
                </div>
              </div>
            </aside>
          </div>
          )}
        </div>
      </main>
    </div>
  );
}

function ProtocolScreen({ navigate, active, account }: ScreenProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="app-root">
      <style>{`
        ${TOKENS}
        *{ box-sizing:border-box; }
        html,body{ margin:0; padding:0; background:var(--bg); }
        .app-root{ min-height:100vh; background:var(--bg); color:var(--text); font-family:var(--font-body); display:flex; position:relative; }
        .dither{ position:fixed; inset:0; pointer-events:none; z-index:0; opacity:.04;
          background-image:radial-gradient(circle at 1px 1px, var(--accent-bright) 1px, transparent 0);
          background-size:5px 5px; }
        .sidebar, .main{ position:relative; z-index:1; }
        @media (max-width:860px){ .app-root{ display:block; } }

        /* SIDEBAR */
        .sidebar{ border-right:1px solid var(--line-soft); display:flex; flex-direction:column; padding:20px 14px; position:sticky; top:0;
          height:100vh; flex:none; width:236px; transition:width .32s var(--ease-in-out), padding .32s var(--ease-in-out); overflow:hidden; }
        .sidebar.is-collapsed{ width:68px; padding:20px 10px; }
        @media (max-width:860px){ .sidebar{ display:none; } }
        .sb-label{ display:inline-block; white-space:nowrap; transition:opacity .18s var(--ease-out), max-width .28s var(--ease-in-out); opacity:1; max-width:160px; overflow:hidden; }
        .sidebar.is-collapsed .sb-label{ opacity:0; max-width:0; }

        /* Header row: logo + toggle live together, properly */
        .sb-header{ display:flex; align-items:center; justify-content:space-between; padding:6px 8px 26px; }
        .sidebar.is-collapsed .sb-header{ flex-direction:column; justify-content:center; gap:14px; padding:6px 0 22px; }
        .sb-brand{ display:flex; align-items:center; gap:9px; overflow:hidden; background:none; border:none; cursor:pointer; padding:0; color:inherit; font:inherit; text-align:left; transition:gap .3s var(--ease-in-out); }
        .sb-brand svg{ flex:none; }
        .sidebar.is-collapsed .sb-brand{ justify-content:center; gap:0; }
        .sb-brand-word{ font-family:var(--font-display); font-size:16px; font-weight:700; }
        .sb-toggle{ flex:none; width:28px; height:28px; border-radius:8px; border:none; background:transparent;
          display:flex; align-items:center; justify-content:center; color:var(--text-faint); cursor:pointer;
          transition:background .15s var(--ease-out), color .15s var(--ease-out); }
        .sb-toggle:hover{ background:var(--bg-elevated); color:var(--accent-bright); }

        .sb-section-label{ font-family:var(--font-mono); font-size:9.5px; letter-spacing:.08em; text-transform:uppercase;
          color:var(--text-faint); padding:0 12px 8px; }
        .sidebar.is-collapsed .sb-section-label{ opacity:0; height:0; padding:0; overflow:hidden; }

        .sb-nav{ display:flex; flex-direction:column; gap:3px; flex:1; }
        .sb-link{ position:relative; display:flex; align-items:center; gap:11px; font-size:13.5px; color:var(--text-soft); text-decoration:none;
          padding:9px 12px; border-radius:9px; transition:background .15s var(--ease-out), color .15s var(--ease-out), border-color .15s var(--ease-out), gap .3s var(--ease-in-out);
          border:1px solid transparent; }
        .sb-link:hover{ background:var(--bg-elevated); color:var(--text); }
        .sb-link.is-active{ background:rgba(74,96,122,.18); border-color:rgba(74,96,122,.30); color:var(--accent-bright); }
        .sb-link svg{ flex:none; }
        .sidebar.is-collapsed .sb-link{ justify-content:center; gap:0; }

        /* Collapsed hover tooltip */
        .sb-tooltip{ position:absolute; left:calc(100% + 10px); top:50%; transform:translateY(-50%); z-index:30;
          background:var(--bg-elevated-2); border:1px solid var(--line); border-radius:8px; padding:6px 11px;
          font-size:12px; color:var(--text); white-space:nowrap; opacity:0; pointer-events:none; transition:opacity .15s var(--ease-out); }
        .sidebar.is-collapsed .sb-link:hover .sb-tooltip{ opacity:1; }

        .sb-foot{ display:flex; flex-direction:column; gap:2px; padding-top:12px; border-top:1px solid var(--line-soft); }
        .sb-wallet{ display:flex; align-items:center; gap:10px; padding:10px 12px; margin-top:8px; border:1px solid var(--line); border-radius:10px; transition:gap .3s var(--ease-in-out), padding .3s var(--ease-in-out); }
        .sidebar.is-collapsed .sb-wallet{ justify-content:center; padding:10px; gap:0; }
        .sidebar.is-collapsed .sb-wallet-text{ display:none; }
        .sb-wallet-dot{ width:7px; height:7px; border-radius:50%; background:var(--accent-bright); flex:none; }
        .sb-wallet-addr{ font-family:var(--font-mono); font-size:12px; color:var(--text); }
        .sb-wallet-net{ font-size:10.5px; color:var(--text-faint); }

        /* MAIN */
        .main{ flex:1; min-width:0; }
        .topbar{ display:flex; align-items:center; justify-content:flex-end; padding:22px 40px; border-bottom:1px solid var(--line-soft); gap:14px; }
        .net-chip{ display:flex; align-items:center; gap:7px; font-size:12.5px; color:var(--text-soft); border:1px solid var(--line); border-radius:100px; padding:6px 13px; }
        .net-dot{ width:6px; height:6px; border-radius:50%; background:#5fd88a; }
        .content{ padding:44px 40px 80px; max-width:1280px; margin:0 auto; position:relative; }

        .page-eyebrow{ font-family:var(--font-mono); font-size:11.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--accent-bright); margin-bottom:8px; }
        .page-title{ font-family:var(--font-display); font-size:clamp(26px,2.4vw,32px); font-weight:600; margin:0 0 32px; }

        .dash-grid{ display:grid; grid-template-columns:1fr 300px; gap:28px; align-items:start; }
        .dash-main{ display:flex; flex-direction:column; gap:24px; min-width:0; }
        .dash-side{ display:flex; flex-direction:column; gap:16px; position:sticky; top:96px; }
        @media (max-width:1000px){ .dash-grid{ grid-template-columns:1fr; } .dash-side{ position:static; } }

        /* CREDIT STATE: a glass ledger object with real depth, not a flat box */
        .credit-panel{ position:relative; border:1px solid var(--line); border-radius:16px; padding:32px 36px; background:var(--bg-elevated); overflow:hidden; }
        .credit-panel::before{ content:""; position:absolute; top:0; left:36px; right:36px; height:1px; background:var(--accent-gradient); opacity:.5; z-index:1; }
        .credit-glow{ position:absolute; top:-60%; right:-20%; width:340px; height:340px; border-radius:50%;
          background:radial-gradient(circle, rgba(74,96,122,.20), transparent 70%); pointer-events:none; }
        .credit-sheen{ position:absolute; inset:0; background:linear-gradient(120deg, rgba(255,255,255,.04) 0%, transparent 30%); pointer-events:none; }
        .credit-status-row{ position:relative; display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; }
        .credit-status-label{ font-size:12px; color:var(--text-soft); }
        .credit-verify-chip{ display:flex; align-items:center; gap:6px; font-size:11.5px; color:var(--accent-bright); font-family:var(--font-mono); }
        .credit-status-word{ position:relative; font-family:var(--font-display); font-size:clamp(30px,3.4vw,40px); font-weight:700; line-height:1; margin-bottom:22px; }
        .credit-highlight{ position:relative; display:flex; align-items:baseline; justify-content:space-between;
          background:linear-gradient(120deg, rgba(0,255,198,.14), rgba(0,255,198,.04));
          border:1px solid rgba(0,255,198,.28); border-radius:10px; padding:14px 18px; margin-bottom:20px; }
        .credit-highlight-k{ font-size:12.5px; color:var(--text-soft); }
        .credit-highlight-v{ font-family:var(--font-display); font-size:24px; font-weight:700; color:var(--accent-bright); }
        .credit-basis{ position:relative; font-size:13.5px; color:var(--text-soft); margin-bottom:22px; }
        .credit-derivation{ position:relative; font-size:12px; color:var(--text-faint); padding-top:20px; border-top:1px solid var(--line); line-height:1.6; }

        /* WIDGETS */
        .widget-row{ display:grid; grid-template-columns:1.4fr 1fr; gap:20px; }
        @media (max-width:700px){ .widget-row{ grid-template-columns:1fr; } }
        .widget{ border:1px solid var(--line); border-radius:14px; padding:22px 24px; background:var(--bg-elevated); }
        .widget-title{ font-family:var(--font-display); font-size:14px; font-weight:600; }
        .widget-sub{ font-size:11.5px; color:var(--text-faint); margin-top:2px; }
        .chart-bars{ display:flex; align-items:flex-end; gap:10px; height:90px; margin-top:20px; }
        .chart-bar-wrap{ flex:1; display:flex; align-items:flex-end; height:100%; }
        .chart-bar{ width:100%; background:var(--accent-gradient); border-radius:4px 4px 1px 1px; }
        .chart-bar.is-empty{ background:var(--line); }
        .chart-labels{ display:flex; justify-content:space-between; margin-top:8px; font-size:9.5px; color:var(--text-faint); font-family:var(--font-mono); letter-spacing:.03em; }
        .widget--gauge{ display:flex; flex-direction:column; }
        .gauge-wrap{ display:flex; justify-content:center; margin-top:8px; }

        /* SIDEBAR WIDGETS */
        .side-widget{ border:1px solid var(--line); border-radius:14px; padding:20px 22px; background:var(--bg-elevated); }
        /* Quick actions live in the sidebar on desktop: show this card only
           where the sidebar is hidden (small screens), as a fallback nav. */
        .side-widget--qa{ display:none; }
        @media (max-width:860px){ .side-widget--qa{ display:block; } }
        .identity-widget{ display:flex; flex-direction:column; align-items:center; text-align:center; gap:4px; }
        .identicon{ display:grid; grid-template-columns:repeat(4,9px); grid-template-rows:repeat(4,9px); gap:2px; margin-bottom:14px; padding:8px; border-radius:10px; background:var(--bg); border:1px solid var(--line); }
        .identicon-cell{ border-radius:1.5px; background:transparent; }
        .identicon-cell.is-on{ background:var(--accent-gradient); }
        .identity-addr{ font-family:var(--font-mono); font-size:13px; color:var(--text); }
        .identity-net{ font-size:11.5px; color:var(--text-soft); margin-top:2px; }
        .identity-since{ font-size:10.5px; color:var(--text-faint); margin-top:8px; }

        .quick-actions{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:16px; }
        .qa-btn{ display:flex; flex-direction:column; align-items:center; gap:7px; padding:12px 4px; border-radius:10px; border:1px solid var(--line);
          background:var(--bg); color:var(--text-soft); text-decoration:none; cursor:pointer; font-size:10px; transition:border-color .15s var(--ease-out), color .15s var(--ease-out); }
        .qa-btn:hover{ border-color:rgba(0,255,198,.35); color:var(--accent-bright); }

        .mini-entry{ display:flex; align-items:flex-start; gap:10px; padding:12px 0; border-top:1px solid var(--line); }
        .mini-entry:first-of-type{ border-top:none; padding-top:16px; }
        .mini-entry-dot{ width:7px; height:7px; border-radius:50%; background:var(--accent-gradient); margin-top:5px; flex:none; }
        .mini-entry-text{ display:flex; flex-direction:column; gap:2px; min-width:0; }
        .mini-entry-event{ font-size:12.5px; color:var(--text); }
        .mini-entry-meta{ font-size:11px; color:var(--text-faint); font-family:var(--font-mono); }

        /* FACTORS PANEL */
        .factors-panel{ border:1px solid var(--line); border-radius:14px; padding:22px 24px; background:var(--bg-elevated); }
        .factors-list{ margin-top:18px; }
        .factor-row{ display:flex; align-items:center; justify-content:space-between; padding:13px 0; border-top:1px solid var(--line); gap:16px; }
        .factor-row:first-child{ border-top:none; padding-top:16px; }
        .factor-text{ display:flex; flex-direction:column; gap:2px; min-width:0; }
        .factor-k{ font-size:13.5px; color:var(--text); }
        .factor-note{ font-size:11.5px; color:var(--text-faint); }
        .factor-v{ font-family:var(--font-mono); font-size:15px; color:var(--accent-bright); font-weight:600; flex:none; }

        /* WHY-THIS-STATE (expandable, not hidden by default) */
        .why-panel{ border:1px solid var(--line); border-radius:14px; background:var(--bg-elevated); overflow:hidden; }
        .why-toggle{ width:100%; display:flex; align-items:center; justify-content:space-between; padding:18px 22px;
          background:none; border:none; color:var(--text); font-family:var(--font-display); font-size:14.5px; font-weight:600; cursor:pointer; }
        .why-toggle svg{ color:var(--text-faint); flex:none; }
        .why-body{ padding:0 22px 22px; display:flex; flex-direction:column; gap:12px; }
        .why-body p{ font-size:13px; color:var(--text-soft); line-height:1.65; margin:0; }

        /* HISTORY STRIP */
        .history-strip{ position:relative; height:70px; margin-top:20px; }
        .history-line{ position:absolute; top:8px; left:2%; right:2%; height:1px; background:var(--line); }
        .history-point{ position:absolute; top:0; display:flex; flex-direction:column; align-items:center; gap:10px; transform:translateX(-50%); }
        .history-dot{ width:9px; height:9px; border-radius:50%; background:var(--accent-gradient); box-shadow:0 0 0 3px var(--bg-elevated); }
        .history-label{ font-family:var(--font-mono); font-size:10.5px; color:var(--text-faint); white-space:nowrap; }

        /* EVENTS TOOLBAR */
        .events-toolbar{ display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:20px; flex-wrap:wrap; }
        .events-search{ display:flex; align-items:center; gap:9px; flex:1; min-width:220px; border:1px solid var(--line); border-radius:10px;
          padding:10px 14px; background:var(--bg-elevated); color:var(--text-faint); }
        .events-search-input{ flex:1; background:none; border:none; outline:none; color:var(--text); font-size:13.5px; font-family:var(--font-body); }
        .events-search-input::placeholder{ color:var(--text-faint); }
        .events-filters{ display:flex; gap:6px; }
        .filter-chip{ font-size:12.5px; color:var(--text-soft); background:var(--bg-elevated); border:1px solid var(--line);
          border-radius:100px; padding:8px 15px; cursor:pointer; transition:border-color .15s var(--ease-out), color .15s var(--ease-out); }
        .filter-chip:hover{ color:var(--text); }
        .filter-chip.is-active{ color:var(--accent-bright); border-color:rgba(0,255,198,.32); background:rgba(0,255,198,.08); }

        .ledger--full{ margin-top:0; }

        /* PENDING MARK: distinct from a verified seal, honest in-progress state */
        .pending-mark{ position:relative; flex:none; border-radius:50%; border:1.5px dashed var(--line);
          background:var(--bg); display:flex; align-items:center; justify-content:center; }
        .pending-spin{ animation:pend-spin .9s linear infinite; }
        @keyframes pend-spin{ to{ transform:rotate(360deg); } }
        @media (prefers-reduced-motion: reduce){ .pending-spin{ animation:none; } }

        /* SUMMARY ROWS */
        .summary-row{ display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-top:1px solid var(--line); font-size:13px; color:var(--text-soft); }
        .summary-row:first-of-type{ border-top:none; padding-top:14px; }
        .summary-v{ font-family:var(--font-mono); color:var(--text); font-weight:600; }

        /* EVENT DETAIL */
        .back-link{ display:inline-flex; align-items:center; gap:7px; font-size:13px; color:var(--text-soft); text-decoration:none; margin-bottom:22px; }
        .back-link:hover{ color:var(--text); }
        .detail-head{ margin-bottom:28px; }
        .detail-status{ display:inline-flex; align-items:center; gap:6px; font-size:12px; font-family:var(--font-mono); color:var(--accent-bright); }

        .proof-chain{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; border:1px solid var(--line); border-radius:14px;
          padding:20px 22px; background:var(--bg-elevated); margin-bottom:24px; }
        .proof-node{ display:flex; align-items:center; gap:8px; font-family:var(--font-mono); font-size:12.5px; color:var(--text-soft);
          border:1px solid var(--line); border-radius:9px; padding:9px 13px; }
        .proof-node.is-done{ background:var(--accent-gradient); color:var(--bg); border-color:transparent; font-weight:600; }
        .proof-arrow{ color:var(--text-faint); font-size:13px; }

        .detail-panel{ border:1px solid var(--line); border-radius:14px; padding:20px 24px; background:var(--bg-elevated); margin-bottom:16px; }
        .detail-panel-title{ font-family:var(--font-mono); font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--accent-bright); margin-bottom:14px; }
        .detail-row{ display:flex; justify-content:space-between; align-items:baseline; padding:9px 0; border-top:1px solid var(--line); font-size:13px; gap:16px; }
        .detail-row:first-of-type{ border-top:none; padding-top:0; }
        .detail-k{ color:var(--text-soft); flex:none; }
        .detail-v{ font-family:var(--font-mono); color:var(--text); text-align:right; }
        .detail-v--ok{ color:var(--accent-bright); display:inline-flex; align-items:center; gap:6px; }
        .detail-link{ display:inline-flex; align-items:center; gap:6px; color:var(--accent-bright); text-decoration:none; }
        .detail-link:hover{ text-decoration:underline; }

        .checklist{ display:flex; flex-direction:column; gap:11px; }
        .checklist-item{ display:flex; align-items:center; gap:9px; font-size:13.5px; color:var(--text); }

        .security-note{ display:flex; align-items:flex-start; gap:12px; border:1px solid rgba(74,96,122,.30); border-radius:14px;
          padding:18px 22px; background:rgba(74,96,122,.07); margin-top:8px; }
        .security-note svg{ flex:none; color:var(--accent-bright); margin-top:2px; }
        .security-note p{ font-size:12.5px; color:var(--text-soft); line-height:1.6; margin:0; }

        /* PROTOCOL */
        .protocol-lede{ font-size:14.5px; color:var(--text-soft); line-height:1.6; max-width:64ch; margin:0 0 24px; }
        .arch-stack{ display:flex; flex-direction:column; align-items:stretch; gap:0; }
        .arch-block{ display:flex; align-items:center; gap:14px; border:1px solid var(--line); border-radius:11px; padding:14px 18px; background:var(--bg); }
        .arch-block svg{ flex:none; color:var(--accent-bright); }
        .arch-block.is-done{ background:var(--accent-gradient); border-color:transparent; }
        .arch-block.is-done svg{ color:var(--bg); }
        .arch-block.is-done .arch-block-name, .arch-block.is-done .arch-block-desc{ color:var(--bg); }
        .arch-block-name{ font-family:var(--font-display); font-size:13.5px; font-weight:600; }
        .arch-block-desc{ font-size:11.5px; color:var(--text-faint); margin-top:2px; }
        .arch-arrow{ color:var(--text-faint); font-size:13px; text-align:center; padding:6px 0; }

        .dep-role{ font-family:var(--font-mono); font-size:10.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--accent-bright); margin-bottom:8px; }
        .dep-name{ font-family:var(--font-display); font-size:16px; font-weight:600; margin-bottom:8px; }
        .dep-body{ font-size:12.5px; color:var(--text-soft); line-height:1.55; margin:0; }

        .dev-flow{ display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:18px; }
        .dev-chip{ font-family:var(--font-mono); font-size:12.5px; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:8px 13px; }
        .dev-flow-arrow{ color:var(--text-faint); }
        .dev-snippet{ font-family:var(--font-mono); font-size:12px; color:var(--text-soft); background:var(--bg); border:1px solid var(--line);
          border-radius:10px; padding:16px 18px; line-height:1.7; margin-bottom:14px; }
        .dev-snippet .k{ color:var(--accent-bright); }
        .protocol-footnote{ font-size:12px; color:var(--text-faint); line-height:1.6; margin:0; }

        .chain-status{ font-family:var(--font-mono); font-size:11px; color:var(--text-faint); }
        .chain-status.is-live{ color:var(--accent-bright); }

        /* SECTION HEAD */
        .section-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
        .section-title{ font-family:var(--font-display); font-size:17px; font-weight:600; }
        .section-link{ font-size:12.5px; color:var(--text-soft); text-decoration:none; display:flex; align-items:center; gap:5px; }
        .section-link:hover{ color:var(--accent-bright); }
        .section-sub{ font-size:12.5px; color:var(--text-faint); margin-bottom:22px; }

        /* LEDGER: stamped entries, not a card grid */
        .ledger{ border-top:1px solid var(--line); }
        .ledger-row{ display:flex; align-items:center; gap:20px; padding:22px 4px; border-bottom:1px solid var(--line); }
        .seal{ position:relative; flex:none; border-radius:50%;
          background:repeating-conic-gradient(rgba(255,255,255,.4) 0deg 1.6deg, rgba(0,0,0,.35) 1.6deg 3.2deg); }
        .seal-core{ position:absolute; inset:4px; border-radius:50%;
          background:radial-gradient(circle at 32% 28%, #C9FFF2 0%, #4A607A 52%, #22303F 100%);
          display:flex; align-items:center; justify-content:center;
          box-shadow:0 2px 5px rgba(0,0,0,.35), inset 0 1px 1px rgba(255,255,255,.5), inset 0 -2px 3px rgba(0,0,0,.25); }
        .ledger-body{ flex:1; min-width:0; }
        .ledger-top{ display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:5px; }
        .ledger-event{ font-family:var(--font-display); font-size:15px; font-weight:600; }
        .ledger-amount{ font-family:var(--font-mono); font-size:14.5px; color:var(--accent-bright); flex:none; }
        .ledger-meta{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:11.5px; color:var(--text-faint); }
        .ledger-chain-path{ display:flex; align-items:center; gap:5px; font-family:var(--font-mono); }
        .ledger-chain-path b{ color:var(--text-soft); font-weight:500; }
        .ledger-proof{ font-family:var(--font-mono); color:var(--text-soft); }
        .ledger-dot{ width:2px; height:2px; border-radius:50%; background:var(--text-faint); }
        .ledger-view{ flex:none; font-size:12px; color:var(--text-soft); background:none; border:1px solid var(--line); border-radius:8px; padding:7px 12px; cursor:pointer; transition:border-color .15s var(--ease-out), color .15s var(--ease-out); }
        .ledger-view:hover{ border-color:rgba(0,255,198,.40); color:var(--accent-bright); }

        @media (max-width:700px){
          .content{ padding:32px 20px 60px; }
          .credit-panel{ padding:24px 22px; }
          .widget-row{ grid-template-columns:1fr; }
          .quick-actions{ grid-template-columns:repeat(2,1fr); }
          .ledger-row{ flex-wrap:wrap; gap:14px; }
          .ledger-view{ display:none; }
        }
      `}</style>

      <div className="dither" />

      <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
        <div className="sb-header">
          <button className="sb-brand" onClick={() => navigate("landing")} aria-label="Back to home">
            <TruMark size={20} />
            <span className="sb-brand-word sb-label">TRU</span>
          </button>
          <button className="sb-toggle" onClick={() => setCollapsed((c) => !c)} aria-label="Toggle sidebar">
            <SidebarToggleIcon />
          </button>
        </div>

        <span className="sb-section-label">Navigation</span>
        <nav className="sb-nav">
          <a className={`sb-link ${active === "overview" ? "is-active" : ""}`} href="#overview" onClick={(e) => { e.preventDefault(); navigate("overview"); }}>
            <OverviewIcon /> <span className="sb-label">Overview</span>
            {collapsed && <span className="sb-tooltip">Overview</span>}
          </a>
          <a className={`sb-link ${active === "credit" ? "is-active" : ""}`} href="#credit" onClick={(e) => { e.preventDefault(); navigate("credit"); }}>
            <CreditIcon /> <span className="sb-label">Economic Actor</span>
            {collapsed && <span className="sb-tooltip">Economic Actor</span>}
          </a>
          <a className={`sb-link ${active === "events" ? "is-active" : ""}`} href="#events" onClick={(e) => { e.preventDefault(); navigate("events"); }}>
            <EventsIcon /> <span className="sb-label">Verified Events</span>
            {collapsed && <span className="sb-tooltip">Verified Events</span>}
          </a>
          <a className={`sb-link ${active === "protocol" ? "is-active" : ""}`} href="#protocol" onClick={(e) => { e.preventDefault(); navigate("protocol"); }}>
            <ProtocolIcon /> <span className="sb-label">Protocol</span>
            {collapsed && <span className="sb-tooltip">Protocol</span>}
          </a>
        </nav>

        <div className="sb-foot">
          <a className="sb-link" href="#settings">
            <SettingsIcon /> <span className="sb-label">Settings</span>
            {collapsed && <span className="sb-tooltip">Settings</span>}
          </a>
          <button className="sb-wallet" onClick={() => navigate("connect")} aria-label="Connect wallet">
            <span className="sb-wallet-dot" />
            <div className="sb-wallet-text"><div className="sb-wallet-addr">{account ? truncateAddress(account) : "Not connected"}</div><div className="sb-wallet-net">Ethereum Sepolia</div></div>
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <button className="topbar-brand" onClick={() => navigate("landing")} aria-label="Back to home"><TruMark size={18} /><span>TRU</span></button>
          <span className="net-chip"><span className="net-dot" /> Sepolia</span>
          <button className="net-chip net-chip--btn" onClick={() => navigate("connect")}>{account ? truncateAddress(account) : "Not connected"}</button>
        </div>

        <div className="content">
          <span className="page-eyebrow">Protocol</span>
          <h1 className="page-title">How TRU is actually built</h1>

          <div className="dash-grid">
            <div className="dash-main">
              <p className="protocol-lede">TRU turns verified cross-chain economic events into consumable verified history. Lenders, RWA platforms, and autonomous agents can consume it. Everything below describes the real pipeline.</p>

              <div className="detail-panel">
                <div className="detail-panel-title">Architecture</div>
                <div className="arch-stack">
                  <div className="arch-block"><ShieldGlyph size={16} /><div><div className="arch-block-name">Source Chain</div><div className="arch-block-desc">Where the economic event happens</div></div></div>
                  <span className="arch-arrow">↓</span>
                  <div className="arch-block"><ShieldGlyph size={16} /><div><div className="arch-block-name">Attestation</div><div className="arch-block-desc">Evidence about the event</div></div></div>
                  <span className="arch-arrow">↓</span>
                  <div className="arch-block"><TruMark size={14} color="var(--accent-bright)" /><div><div className="arch-block-name">TRU Verification Layer</div><div className="arch-block-desc">Cryptographically verifies the event</div></div></div>
                  <span className="arch-arrow">↓</span>
                  <div className="arch-block"><CreditIcon size={16} /><div><div className="arch-block-name">Creditcoin</div><div className="arch-block-desc">Stores the verified economic history</div></div></div>
                  <span className="arch-arrow">↓</span>
                  <div className="arch-block is-done"><CheckGlyph size={13} color="var(--bg)" /><div><div className="arch-block-name">Applications & Agents</div><div className="arch-block-desc">Consume verified facts</div></div></div>
                </div>
              </div>

              <div className="detail-panel">
                <div className="detail-panel-title">What TRU verifies</div>
                <div className="factors-list">
                  <div className="factor-row">
                    <div className="factor-text"><span className="factor-k">Financial events</span><span className="factor-note">Loan origination · Loan repayment</span></div>
                  </div>
                  <div className="factor-row">
                    <div className="factor-text"><span className="factor-k">Obligation events</span><span className="factor-note">Obligation created · Obligation completed</span></div>
                  </div>
                </div>
                <p className="protocol-footnote" style={{ marginTop: 14 }}>Same verification primitive. Different economic events.</p>
              </div>

              <div className="widget-row">
                <div className="widget"><div className="dep-role">Proof</div><div className="dep-name">Attestcoin</div><p className="dep-body">Without it, TRU has no reliable way to know what happened on another chain.</p></div>
                <div className="widget"><div className="dep-role">Verification</div><div className="dep-name">TRU</div><p className="dep-body">Without it, an attested event stays raw data and never becomes verified, replay-guarded history.</p></div>
              </div>
              <div className="widget" style={{ marginBottom: 24 }}>
                <div className="dep-role">Record</div><div className="dep-name">Creditcoin</div>
                <p className="dep-body">Without it, TRU has nowhere to turn verified history into infrastructure other protocols can actually use.</p>
              </div>

              <div className="detail-panel">
                <div className="detail-panel-title">For developers</div>
                <div className="dev-flow">
                  <span className="dev-chip">VerifiedEvent</span><span className="dev-flow-arrow">→</span>
                  <span className="dev-chip">CreditEvent</span><span className="dev-flow-arrow">→</span>
                  <span className="dev-chip">CreditState</span>
                </div>
                <div className="dev-snippet">
                  <span className="k">getCreditEvidence</span>(address) →<br />
                  &nbsp;&nbsp;{"{"} creditState, repayments, creditLimit {"}"}
                </div>
                <p className="protocol-footnote">A developer doesn't need to understand cross-chain attestation to use this. They query one address and get back standardized, verifiable history.</p>
              </div>
            </div>

            <aside className="dash-side">
              <div className="side-widget">
                <div className="widget-title">Supported chains</div>
                <div className="summary-row"><span>Ethereum Sepolia</span><span className="chain-status is-live">Live</span></div>
                <div className="summary-row"><span>Base</span><span className="chain-status">Planned</span></div>
                <div className="summary-row"><span>Arbitrum</span><span className="chain-status">Planned</span></div>
              </div>

              <div className="side-widget">
                <div className="widget-title">Resources</div>
                <div className="quick-actions">
                  <a className="qa-btn" href="https://github.com/Shaydez-Defi/tru/tree/main/docs" target="_blank" rel="noreferrer"><EventsIcon /><span>Docs</span></a>
                  <a className="qa-btn" href="https://github.com/Shaydez-Defi/tru" target="_blank" rel="noreferrer"><ProtocolIcon /><span>GitHub</span></a>
                  <a className="qa-btn" href="#overview" onClick={(e) => { e.preventDefault(); navigate("overview"); }}><OverviewIcon /><span>Overview</span></a>
                  <a className="qa-btn" href="#credit" onClick={(e) => { e.preventDefault(); navigate("credit"); }}><CreditIcon /><span>Profile</span></a>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}

function listInjectedProviders(root: EIP1193Provider | undefined): EIP1193Provider[] {
  if (!root) return [];
  const out: EIP1193Provider[] = [];
  for (const p of root.providers ?? [root]) {
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}



function ConnectWalletScreen({ navigate, onConnect }: ScreenProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [connectingIndex, setConnectingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isMobile =
    typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const injected: EIP1193Provider[] =
    typeof window !== "undefined" ? listInjectedProviders(window.ethereum) : [];

  const connectWith = async (index: number) => {
    const target = injected[index];
    if (!target) return;
    setConnectingIndex(index);
    setError(null);
    try {
      const accounts = (await target.request({ method: "eth_requestAccounts" })) as string[];
      if (accounts && accounts.length > 0) {
        if (onConnect) onConnect(accounts[0]);
        navigate("overview");
      } else {
        setError("The wallet returned no accounts. Try again.");
      }
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Connection was rejected.");
    } finally {
      setConnectingIndex(null);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy failed. Long-press the address bar to copy the link manually.");
    }
  };

  return (
    <div className="app-root">
      <style>{`
        ${TOKENS}
        *{ box-sizing:border-box; }
        html,body{ margin:0; padding:0; background:var(--bg); }
        .app-root{ min-height:100vh; background:var(--bg); color:var(--text); font-family:var(--font-body); display:flex; position:relative; }
        .dither{ position:fixed; inset:0; pointer-events:none; z-index:0; opacity:.04;
          background-image:radial-gradient(circle at 1px 1px, var(--accent-bright) 1px, transparent 0);
          background-size:5px 5px; }
        .sidebar, .main{ position:relative; z-index:1; }
        @media (max-width:860px){ .app-root{ display:block; } }

        /* SIDEBAR */
        .sidebar{ border-right:1px solid var(--line-soft); display:flex; flex-direction:column; padding:20px 14px; position:sticky; top:0;
          height:100vh; flex:none; width:236px; transition:width .32s var(--ease-in-out), padding .32s var(--ease-in-out); overflow:hidden; }
        .sidebar.is-collapsed{ width:68px; padding:20px 10px; }
        @media (max-width:860px){ .sidebar{ display:none; } }
        .sb-label{ display:inline-block; white-space:nowrap; transition:opacity .18s var(--ease-out), max-width .28s var(--ease-in-out); opacity:1; max-width:160px; overflow:hidden; }
        .sidebar.is-collapsed .sb-label{ opacity:0; max-width:0; }
        .sb-header{ display:flex; align-items:center; justify-content:space-between; padding:6px 8px 26px; }
        .sidebar.is-collapsed .sb-header{ flex-direction:column; justify-content:center; gap:14px; padding:6px 0 22px; }
        .sb-brand{ display:flex; align-items:center; gap:9px; overflow:hidden; background:none; border:none; cursor:pointer; padding:0; color:inherit; font:inherit; text-align:left; transition:gap .3s var(--ease-in-out); }
        .sb-brand svg{ flex:none; }
        .sidebar.is-collapsed .sb-brand{ justify-content:center; gap:0; }
        .sb-brand-word{ font-family:var(--font-display); font-size:16px; font-weight:700; }
        .sb-toggle{ flex:none; width:28px; height:28px; border-radius:8px; border:none; background:transparent;
          display:flex; align-items:center; justify-content:center; color:var(--text-faint); cursor:pointer;
          transition:background .15s var(--ease-out), color .15s var(--ease-out); }
        .sb-toggle:hover{ background:var(--bg-elevated); color:var(--accent-bright); }
        .sb-section-label{ font-family:var(--font-mono); font-size:9.5px; letter-spacing:.08em; text-transform:uppercase;
          color:var(--text-faint); padding:0 12px 8px; }
        .sidebar.is-collapsed .sb-section-label{ opacity:0; height:0; padding:0; overflow:hidden; }
        .sb-nav{ display:flex; flex-direction:column; gap:3px; flex:1; }
        .sb-link{ position:relative; display:flex; align-items:center; gap:11px; font-size:13.5px; color:var(--text-soft); text-decoration:none;
          padding:9px 12px; border-radius:9px; transition:background .15s var(--ease-out), color .15s var(--ease-out), border-color .15s var(--ease-out), gap .3s var(--ease-in-out);
          border:1px solid transparent; }
        .sb-link:hover{ background:var(--bg-elevated); color:var(--text); }
        .sb-link.is-active{ background:rgba(74,96,122,.18); border-color:rgba(74,96,122,.30); color:var(--accent-bright); }
        .sb-link svg{ flex:none; }
        .sidebar.is-collapsed .sb-link{ justify-content:center; gap:0; }
        .sb-tooltip{ position:absolute; left:calc(100% + 10px); top:50%; transform:translateY(-50%); z-index:30;
          background:var(--bg-elevated-2); border:1px solid var(--line); border-radius:8px; padding:6px 11px;
          font-size:12px; color:var(--text); white-space:nowrap; opacity:0; pointer-events:none; transition:opacity .15s var(--ease-out); }
        .sidebar.is-collapsed .sb-link:hover .sb-tooltip{ opacity:1; }
        .sb-foot{ display:flex; flex-direction:column; gap:2px; padding-top:12px; border-top:1px solid var(--line-soft); }

        /* MAIN */
        .main{ flex:1; min-width:0; }
        .topbar{ display:flex; align-items:center; justify-content:flex-end; padding:22px 40px; border-bottom:1px solid var(--line-soft); gap:14px; }
        .net-chip{ display:flex; align-items:center; gap:7px; font-size:12.5px; color:var(--text-soft); border:1px solid var(--line); border-radius:100px; padding:6px 13px; }
        .net-dot{ width:6px; height:6px; border-radius:50%; background:#5fd88a; }
        .content{ padding:44px 40px 80px; max-width:1280px; margin:0 auto; position:relative; }
        .page-eyebrow{ font-family:var(--font-mono); font-size:11.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--accent-bright); margin-bottom:8px; }
        .page-title{ font-family:var(--font-display); font-size:clamp(26px,2.4vw,32px); font-weight:600; margin:0 0 32px; }
        .back-link{ display:inline-flex; align-items:center; gap:7px; font-size:13px; color:var(--text-soft); text-decoration:none; margin-bottom:22px; }
        .back-link:hover{ color:var(--text); }
        .connect-wrap .page-eyebrow{ display:block; }
        .connect-head{ display:flex; align-items:center; gap:16px; margin-bottom:22px; }
        .connect-head .back-link{ margin-bottom:0; flex:none; }
        .connect-head .page-eyebrow{ margin-bottom:0; }

        /* CONNECT */
        .connect-wrap{ max-width:620px; margin:0 auto; }
        .connect-lede{ font-size:14.5px; color:var(--text-soft); line-height:1.65; margin:0 0 28px; max-width:52ch; }
        .btn-primary{ display:inline-flex; align-items:center; gap:8px; font-size:14.5px; font-weight:600; color:#d9fff5;
          background:linear-gradient(135deg, #2a6a5c 0%, #2c4f66 58%, #2B3D52 100%);
          border:1px solid rgba(0,255,198,.28); border-radius:100px; padding:13px 22px; cursor:pointer; text-decoration:none;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.18), inset 0 -3px 7px rgba(0,0,0,.4), 0 0 0 1px rgba(0,0,0,.45), 0 10px 24px -14px rgba(0,0,0,.8);
          text-shadow:0 1px 2px rgba(0,0,0,.4);
          transition:transform .18s var(--ease-out), box-shadow .32s var(--ease-out), border-color .32s var(--ease-out); }
        .btn-primary:hover{ border-color:rgba(0,255,198,.5); }
        .btn-primary:active{ transform:translateY(1px) scale(.98); box-shadow:inset 0 3px 8px rgba(0,0,0,.5), 0 0 0 1px rgba(0,0,0,.45); }
        .btn-primary:disabled{ opacity:.45; cursor:not-allowed; box-shadow:none; }
        .btn-ghost{ display:inline-flex; align-items:center; gap:8px; font-size:14.5px; font-weight:600; color:var(--text); background:transparent;
          border:1px solid var(--line); border-radius:100px; padding:13px 22px; cursor:pointer; text-decoration:none;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.07), inset 0 -3px 6px rgba(0,0,0,.25);
          transition:border-color .3s var(--ease-out), background .3s var(--ease-out), color .3s var(--ease-out), box-shadow .3s var(--ease-out); }
        .btn-ghost:hover{ border-color:rgba(255,255,255,.28); background:rgba(255,255,255,.03); }
        .detail-panel{ border:1px solid var(--line); border-radius:14px; padding:20px 24px; background:var(--bg-elevated); margin-bottom:16px; }
        .detail-panel-title{ font-family:var(--font-mono); font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--accent-bright); margin-bottom:14px; }
        .detail-row{ display:flex; justify-content:space-between; align-items:baseline; padding:9px 0; border-top:1px solid var(--line); font-size:13px; gap:16px; }
        .detail-row:first-of-type{ border-top:none; padding-top:0; }
        .detail-k{ color:var(--text-soft); flex:none; }
        .detail-v{ font-family:var(--font-mono); color:var(--text); text-align:right; }
        .btn-row{ display:flex; gap:10px; margin-top:18px; flex-wrap:wrap; }
        .connect-divider{ display:flex; align-items:center; gap:14px; margin:26px 0; color:var(--text-faint); font-size:12px; font-family:var(--font-mono); }
        .connect-divider::before, .connect-divider::after{ content:""; flex:1; height:1px; background:var(--line); }
        .connect-steps{ display:flex; flex-direction:column; gap:11px; margin:16px 0 4px; }
        .connect-step{ display:flex; gap:12px; font-size:13.5px; color:var(--text-soft); line-height:1.6; }
        .connect-step-n{ font-family:var(--font-mono); font-size:12px; color:var(--accent-bright); flex:none; padding-top:2px; }
        .connect-note{ font-size:12.5px; color:var(--text-faint); line-height:1.6; margin:14px 0 0; }
        .connect-err{ font-size:12.5px; color:#e08a7a; margin:14px 0 0; line-height:1.55; }
        .security-note{ display:flex; align-items:flex-start; gap:12px; border:1px solid rgba(74,96,122,.30); border-radius:14px;
          padding:18px 22px; background:rgba(74,96,122,.07); margin-top:8px; }
        .security-note svg{ flex:none; color:var(--accent-bright); margin-top:2px; }
        .security-note p{ font-size:12.5px; color:var(--text-soft); line-height:1.6; margin:0; }

        @media (max-width:700px){
          .content{ padding:32px 20px 60px; }
        }
      `}</style>

      <div className="dither" />

      <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
        <div className="sb-header">
          <button className="sb-brand" onClick={() => navigate("landing")} aria-label="Back to home">
            <TruMark size={20} />
            <span className="sb-brand-word sb-label">TRU</span>
          </button>
          <button className="sb-toggle" onClick={() => setCollapsed((c) => !c)} aria-label="Toggle sidebar">
            <SidebarToggleIcon />
          </button>
        </div>

        <span className="sb-section-label">Navigation</span>
        <nav className="sb-nav">
          <a className="sb-link" href="#overview" onClick={(e) => { e.preventDefault(); navigate("overview"); }}>
            <OverviewIcon /> <span className="sb-label">Overview</span>
            {collapsed && <span className="sb-tooltip">Overview</span>}
          </a>
          <a className="sb-link" href="#credit" onClick={(e) => { e.preventDefault(); navigate("credit"); }}>
            <CreditIcon /> <span className="sb-label">Economic Actor</span>
            {collapsed && <span className="sb-tooltip">Economic Actor</span>}
          </a>
          <a className="sb-link" href="#events" onClick={(e) => { e.preventDefault(); navigate("events"); }}>
            <EventsIcon /> <span className="sb-label">Verified Events</span>
            {collapsed && <span className="sb-tooltip">Verified Events</span>}
          </a>
          <a className="sb-link" href="#protocol" onClick={(e) => { e.preventDefault(); navigate("protocol"); }}>
            <ProtocolIcon /> <span className="sb-label">Protocol</span>
            {collapsed && <span className="sb-tooltip">Protocol</span>}
          </a>
        </nav>

        <div className="sb-foot">
          <a className="sb-link" href="#settings">
            <SettingsIcon /> <span className="sb-label">Settings</span>
            {collapsed && <span className="sb-tooltip">Settings</span>}
          </a>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <button className="topbar-brand" onClick={() => navigate("landing")} aria-label="Back to home"><TruMark size={18} /><span>TRU</span></button>
          <span className="net-chip"><span className="net-dot" /> Sepolia</span>
        </div>

        <div className="content connect-wrap">
          <div className="connect-head">
            <a className="back-link" href="#product" onClick={(e) => { e.preventDefault(); navigate("landing"); }}><ArrowLeft /> Back</a>
            <span className="page-eyebrow">Wallet</span>
          </div>
          <h1 className="page-title">Connect your wallet</h1>
          <p className="connect-lede">Connection is local and read-only. TRU never sees your keys and never moves funds. It only reads the address you connect with.</p>

          <div className="detail-panel">
            <div className="detail-panel-title">Browser wallet · injected</div>
            <div className="detail-row"><span className="detail-k">Detected</span><span className="detail-v">{injected.length === 0 ? "None found" : `${injected.length} wallet${injected.length === 1 ? "" : "s"}`}</span></div>
            <div className="detail-row"><span className="detail-k">Network</span><span className="detail-v">Ethereum Sepolia</span></div>
            {injected.length === 0 ? (
              <p className="connect-note">No injected wallet found in this browser. Install one, or continue on mobile below.</p>
            ) : (
              <div className="btn-row">
                {injected.map((_, i) => (
                  <button key={i} className="btn-primary" onClick={() => connectWith(i)} disabled={connectingIndex !== null}>
                    <WalletGlyph size={14} /> {connectingIndex === i ? "Waiting for wallet…" : injected.length > 1 ? `Connect wallet ${i + 1}` : "Connect wallet"}
                  </button>
                ))}
              </div>
            )}
            {error && <p className="connect-err">{error}</p>}
          </div>

          <div className="connect-divider"><span>or</span></div>

          <div className="detail-panel">
            <div className="detail-panel-title">Mobile · wallet browser</div>
            {isMobile && (
              <p className="connect-note" style={{ marginTop: 0 }}>
                You are on mobile. Open this page inside your wallet's browser below.
              </p>
            )}
            <div className="connect-steps">
              <div className="connect-step"><span className="connect-step-n">01</span><span>Open your wallet app.</span></div>
              <div className="connect-step"><span className="connect-step-n">02</span><span>Open its built-in browser tab.</span></div>
              <div className="connect-step"><span className="connect-step-n">03</span><span>Copy this page's link and paste it into the wallet browser.</span></div>
            </div>
            <div className="btn-row">
              <button className="btn-ghost" onClick={copyLink}>{copied ? "Link copied" : "Copy page link"}</button>
            </div>
            <p className="connect-note">Desktop pages cannot reach a phone's wallets directly. The wallet's own browser injects the connection, and the step above then just works.</p>
          </div>

          <div className="security-note">
            <p>A connection here only reads your address for display. Verification happens on-chain: every history entry traces to an attested source-chain transaction, never to anything typed or claimed here.</p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function TruApp() {
  const [screen, setScreen] = useState<ScreenName>("landing");
  const [account, setAccount] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<LedgerEntry | null>(null);
  const [exiting, setExiting] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const navigate: NavigateFn = (s) => {
    if (s === screen || exiting) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setScreen(s);
      window.scrollTo(0, 0);
      return;
    }
    setExiting(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setScreen(s);
      setExiting(false);
      window.scrollTo(0, 0);
    }, 200);
  };
  const handleSelectEvent = (entry: LedgerEntry) => {
    setSelectedEvent(entry);
    navigate(entry.status === "verified" ? "event-detail" : "verifying");
  };

  let view;
  if (screen === "verifying") view = <VerifyingScreen navigate={navigate} account={account} selectedEvent={selectedEvent} onSelectEvent={handleSelectEvent} />;
  else if (screen === "overview") view = <OverviewScreen navigate={navigate} active="overview" account={account} selectedEvent={selectedEvent} onSelectEvent={handleSelectEvent} />;
  else if (screen === "credit") view = <CreditProfileScreen navigate={navigate} active="credit" account={account} selectedEvent={selectedEvent} onSelectEvent={handleSelectEvent} />;
  else if (screen === "events") view = <VerifiedEventsScreen navigate={navigate} active="events" account={account} selectedEvent={selectedEvent} onSelectEvent={handleSelectEvent} />;
  else if (screen === "event-detail") view = <EventDetailScreen navigate={navigate} active="events" account={account} selectedEvent={selectedEvent} onSelectEvent={handleSelectEvent} />;
  else if (screen === "protocol") view = <ProtocolScreen navigate={navigate} active="protocol" account={account} />;
  else if (screen === "connect") view = <ConnectWalletScreen navigate={navigate} account={account} onConnect={setAccount} />;
  else view = <LandingScreen navigate={navigate} account={account} />;
  return <div key={screen} className={`screen-anim${exiting ? " screen-exit" : ""}`}>{view}</div>;
}
