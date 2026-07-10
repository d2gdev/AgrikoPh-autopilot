// ── response types ──
export interface Query { query: string; clicks: number; impressions: number; ctr: string; position: string }
export interface PageRow { page: string; sessions: number; [key: string]: unknown }
export interface Totals { clicks: number; impressions: number; avgCtr: number; avgPosition: number }
export interface Mover { query: string; clicks: number; clicksDelta: number; impressionsDelta: number; positionDelta: number; direction: "up" | "down" }
export interface Trends { current: Totals; previous: Totals | null; currentFetchedAt: string | null; previousFetchedAt: string | null; movers: Mover[] }
export interface Opportunity { query: string; impressions: number; clicks: number; ctr: number; position: number; type: string; potentialClicks: number; reason: string; page?: string | null; pageClicks?: number | null; pageImpressions?: number | null; score?: number; volume?: number | null; difficulty?: number | null }
export interface OpportunityCluster { id: string; label: string; page: string | null; opportunities: Opportunity[]; totalPotentialClicks: number; topScore: number }
export interface SnapshotTrendPoint { date: string; clicks: number; impressions: number; avgPosition: number; ctr: number }
export interface PageHealthRow { url: string; rawUrl: string; impressions: number; clicks: number; position: number; sessions: number | null; bounceRate: number | null; conversionRate: number | null; flag: "high-impressions-high-bounce" | "high-impressions-low-conversion" | null; severity: number }
export interface GscPage { page: string; clicks: number; impressions: number; ctr: string; position: string }
export interface QueryPagePair { query: string; page: string; clicks: number; impressions: number; position: string }
export interface SeoData {
  topQueries: Query[]; topPages: PageRow[]; gscFetchedAt: string | null; ga4FetchedAt: string | null;
  trends: Trends | null; opportunities: Opportunity[];
  gscPages: GscPage[]; queryPagePairs: QueryPagePair[];
  pageHealth?: PageHealthRow[];
  clusters?: OpportunityCluster[];
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
export interface Cluster { topic: string; articleCount: number; keywordCount: number; gapScore: number }

export const gapKey = (g: { query: string; suggestedTitle: string }) => `${g.query}::${g.suggestedTitle}`;
export const opportunityKey = (o: Pick<Opportunity, "query" | "page" | "type">) => JSON.stringify([o.query, o.page ?? "", o.type]);

// fractions 0–1 → "x.x%", null → "—"
export const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
