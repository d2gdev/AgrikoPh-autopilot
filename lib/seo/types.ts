// Shared types for the SEO pilot. The GSC/GA4 connectors store pre-formatted
// strings for ctr/position (e.g. "3.8%", "5.2") — see lib/connectors/gsc.ts.

export interface GscQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: string; // "3.8%"
  position: string; // "5.2"
}

export interface Ga4PageRow {
  page: string;
  sessions: number;
  bounceRate: string;
  conversionRate: string;
}

// GSC with dimensions: ["page"]
export interface GscPageRow {
  page: string;
  clicks: number;
  impressions: number;
  ctr: string;
  position: string;
}

// GSC with dimensions: ["query","page"]
export interface GscQueryPageRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  position: string;
}

export type OpportunityType =
  | "low_ctr" // ranks well but few clicks → rewrite title/meta
  | "striking_distance" // position 5–20 → on-page push to page 1
  | "high_impression_no_click"; // lots of impressions, ~0 clicks

export interface CtrOpportunity {
  query: string;
  impressions: number;
  clicks: number;
  ctr: number; // numeric fraction, 0–1
  position: number; // numeric
  type: OpportunityType;
  potentialClicks: number; // estimated extra clicks if CTR reached benchmark for its position
  reason: string;
  // B1 — landing-page attribution: best (highest-impression) page for this query.
  page?: string | null;
  pageClicks?: number | null;
  pageImpressions?: number | null;
  // B2 — composite opportunity scoring. `score` ranks the list; equals
  // potentialClicks when no research/intent data is supplied (neutral factors).
  score: number;
  volume: number | null; // avgMonthlySearches when known
  difficulty: number | null; // competitionIndex 0–100 when known
}

// B6 — opportunity clustering. Groups CtrOpportunity rows by shared landing
// page or high query-token overlap so the operator can fix related queries
// together.
export interface OpportunityCluster {
  id: string;
  label: string; // highest-score member's query, or the shared page
  page: string | null; // shared landing page when the cluster is page-based
  opportunities: CtrOpportunity[];
  totalPotentialClicks: number;
  topScore: number;
}

// B5 — snapshot history trend point (one per stored snapshot, oldest→newest).
export interface SnapshotTrendPoint {
  date: string; // ISO string from the snapshot's dateRangeEnd
  clicks: number;
  impressions: number;
  avgPosition: number;
  ctr: number; // numeric fraction 0–1
}

export interface QueryMover {
  query: string;
  clicks: number;
  clicksDelta: number;
  impressionsDelta: number;
  positionDelta: number; // negative = improved (moved toward #1)
  direction: "up" | "down";
}

export interface SeoTotals {
  clicks: number;
  impressions: number;
  avgCtr: number; // numeric fraction 0–1
  avgPosition: number;
}

export interface SeoTrends {
  current: SeoTotals;
  previous: SeoTotals | null;
  currentFetchedAt: string | null;
  previousFetchedAt: string | null;
  movers: QueryMover[]; // top risers + fallers by |clicksDelta|
}

// B3 — GA4 page-health: GSC landing-page performance joined with GA4 metrics.
export type PageHealthFlag =
  | "high-impressions-high-bounce"
  | "high-impressions-low-conversion";

export interface PageHealthRow {
  url: string; // normalized path (e.g. "/blogs/news/foo")
  rawUrl: string; // original GSC page value (may be absolute)
  // GSC
  impressions: number;
  clicks: number;
  position: number;
  // GA4 (null when no matching GA4 row)
  sessions: number | null;
  bounceRate: number | null; // numeric fraction 0–1
  conversionRate: number | null; // numeric fraction 0–1
  // Derived
  flag: PageHealthFlag | null;
  flags: PageHealthFlag[];
  severity: number; // higher = worse; 0 when no flag
}

// ── helpers for parsing the connector's string fields ──

export function parsePercent(v: string | number | undefined | null): number {
  if (typeof v === "number") return v;
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n / 100 : 0; // "3.8%" → 0.038
}

export function parseNum(v: string | number | undefined | null): number {
  if (typeof v === "number") return v;
  if (v === undefined || v === null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
