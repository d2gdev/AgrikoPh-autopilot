// ── response types ──
export interface Query { query: string; clicks: number; impressions: number; ctr: string; position: string }
export interface PageRow { page: string; sessions: number; [key: string]: unknown }
export interface Totals { clicks: number; impressions: number; avgCtr: number; avgPosition: number }
export interface Mover { query: string; clicks: number; clicksDelta: number; impressionsDelta: number; positionDelta: number; direction: "up" | "down" }
export interface Trends { current: Totals; previous: Totals | null; currentFetchedAt: string | null; previousFetchedAt: string | null; movers: Mover[] }
export interface Opportunity { query: string; impressions: number; clicks: number; ctr: number; position: number; type: string; potentialClicks: number; reason: string; page?: string | null; pageClicks?: number | null; pageImpressions?: number | null; score?: number; volume?: number | null; difficulty?: number | null }
export interface OpportunityCluster { id: string; label: string; page: string | null; opportunities: Opportunity[]; totalPotentialClicks: number; topScore: number }
export interface SnapshotTrendPoint { date: string; clicks: number; impressions: number; avgPosition: number; ctr: number }
export interface PageHealthRow { url: string; rawUrl: string; impressions: number; clicks: number; position: number; sessions: number | null; bounceRate: number | null; conversionRate: number | null; flag: "high-impressions-high-bounce" | "high-impressions-low-conversion" | null; flags: Array<"high-impressions-high-bounce" | "high-impressions-low-conversion">; severity: number }
export interface GscPage { page: string; clicks: number; impressions: number; ctr: string; position: string }
export interface QueryPagePair { query: string; page: string; clicks: number; impressions: number; position: string }
export interface GscFreshness {
  selectedSource: "normalized" | "rawSnapshot" | "none";
  selectedCapturedAt: string | null;
  selectedDateRangeStart: string | null;
  selectedDateRangeEnd: string | null;
  normalizedCapturedAt: string | null;
  normalizedDateRangeStart: string | null;
  normalizedDateRangeEnd: string | null;
  rawCapturedAt: string | null;
  rawDateRangeStart: string | null;
  rawDateRangeEnd: string | null;
  fallbackReason: "normalized_missing" | "raw_newer_than_normalized" | null;
}
export interface SeoData {
  topQueries: Query[]; topPages: PageRow[]; gscFetchedAt: string | null; ga4FetchedAt: string | null;
  trends: Trends | null; opportunities: Opportunity[];
  gscPages: GscPage[]; queryPagePairs: QueryPagePair[];
  pageHealth?: PageHealthRow[];
  clusters?: OpportunityCluster[];
  gscFreshness?: GscFreshness;
  ga4Freshness?: { selectedSource: "normalized" | "rawSnapshot" | "none"; selectedCapturedAt: string | null; normalizedCapturedAt: string | null; rawCapturedAt: string | null; fallbackReason: "normalized_missing" | "normalized_empty" | "raw_newer_than_normalized" | null };
}
export interface ContentGap {
  query: string;
  impressions: number;
  position: number;
  suggestedTitle: string;
  issue?: "missing-meta" | "thin-content";
  articleHandle?: string;
  wordCount?: number | null;
}
export interface Analysis {
  aiStatus?: "complete" | "partial";
  aiError?: string;
  summary?: string;
  quickWins?: string[];
  quickWinEvidence?: string[];
  contentGaps?: ContentGap[];
  recommendations?: string[];
  recommendationEvidence?: string[];
  limits?: SeoAnalysisLimits;
}
export interface SeoAnalysisLimits { queriesTotal: number; queriesAnalyzed: number; articlesTotalLowerBound: number; articlesAnalyzed: number; articlesTruncated: boolean }
export interface HealthTotals { total: number; missingMeta: number; thinContent: number; noInternalLinks: number; lowHeadings: number; orphan: number; titleLengthOff?: number; descLengthOff?: number; missingDesc?: number; missingH1?: number; duplicateTitle?: number }
export interface HealthOffender { handle: string; title: string; wordCount: number; issues: string[] }
export interface HealthLimits { articlesTotalLowerBound: number; articlesAnalyzed: number; articlesTruncated: boolean }
export interface Health { totals: HealthTotals; worstOffenders: HealthOffender[]; limits?: HealthLimits }
export interface KeywordRow { keyword: string; position: number | null; clicks: number; impressions: number; positionDelta: number | null; status: string; alert: boolean }
export const trackedKeywordSet = (keywords: KeywordRow[]) => new Set(keywords.map((row) => row.keyword.trim().toLowerCase()));
export function mergeTrackedKeywordPlaceholder(keywords: KeywordRow[], keyword: string): KeywordRow[] {
  const normalized = keyword.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized || keywords.some((row) => row.keyword.trim().toLowerCase().replace(/\s+/g, " ") === normalized)) return keywords;
  return [...keywords, { keyword: normalized, position: null, clicks: 0, impressions: 0, positionDelta: null, status: "tracked", alert: false }];
}
export function analysisCompletionToast(analysis: Pick<Analysis, "aiStatus" | "contentGaps">): string {
  const gapCount = analysis.contentGaps?.length ?? 0;
  if (analysis.aiStatus === "partial") {
    return gapCount > 0
      ? `Partial analysis — ${gapCount} deterministic content gap${gapCount === 1 ? "" : "s"} found; AI strategy is incomplete.`
      : "Partial analysis — deterministic checks completed, but AI strategy is incomplete.";
  }
  return gapCount > 0
    ? `Analysis complete — ${gapCount} content gap${gapCount === 1 ? "" : "s"} found.`
    : "Analysis complete — no content gaps found with current data.";
}
export interface Cluster { topic: string; articleCount: number; keywordCount: number; gapScore: number }

export interface StrategyEvidenceGate {
  gateId: string;
  ruleId: string;
  mandatory: boolean;
  status: "current" | "missing" | "stale";
  maxAgeDays: number;
  ageDays: number | null;
  blockingReason: string | null;
}

export interface StrategyPackageOverview {
  state: "loading" | "unavailable" | "empty" | "partial" | "ready";
  message?: string;
  activeVersionId?: string | null;
  packages?: Array<{
    id: string; packageId: string; strategyVersion: string; packageSha256: string;
    lifecycle: string; validationStatus: string; evidenceDate: string;
    compiledRuleCount: number;
    validationIssues: Array<{ code: string; severity: string; blocking: boolean; ruleId: string | null; sourceArtifactId: string | null }>;
    evidenceGates: StrategyEvidenceGate[];
    compliance: { counts: Record<string, number>; recent: Array<{ result: string; matchedRuleIds: string[]; evidenceGates: string[]; sourceArtifactIds: string[] }> };
    auditTimeline: Array<{ action: string; occurredAt: string; actor: string | null; reason: string | null }>;
    lifecycleControls: { canActivate: boolean; canRollback: boolean; reason: string };
  }>;
}

export const gapKey = (g: { query: string; suggestedTitle: string }) => `${g.query}::${g.suggestedTitle}`;
export const opportunityKey = (o: Pick<Opportunity, "query" | "page" | "type">) => JSON.stringify([o.query, o.page ?? "", o.type]);

// fractions 0–1 → "x.x%", null → "—"
export const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
