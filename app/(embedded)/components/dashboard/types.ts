export interface PerJobHealth {
  jobName: string;
  label?: string;
  manualTriggerEnabled?: boolean;
  manualTriggerDisabledReason?: string | null;
  lastStatus: string | null;
  lastStartedAt: string | null;
  lastSuccessAt: string | null;
  queuedCount?: number;
  oldestQueuedAt?: string | null;
  errorExcerpt: string | null;
}

export interface GscMover {
  query: string;
  clicks: number;
  clicksDelta: number;
  impressionsDelta: number;
  positionDelta: number;
  direction: "up" | "down";
}

export interface DashboardData {
  pendingCount: number;
  outcomeWinRate: { improved: number; worsened: number; total: number } | null;
  revenueVsMeta: {
    shopifyRevenue: number;
    metaConversionValue: number | null;
    periodStart: string;
    periodEnd: string;
    daysCovered: number;
    currency: string;
  } | null;
  hardBlockedCount: number;
  executedThisMonth: number;
  failedCount: number;
  overrideCount: number;
  lastJobRun: { jobName: string; status: string; startedAt: string; summary: Record<string, unknown> | null } | null;
  perJobHealth: PerJobHealth[];
  contentPilotStats: { pending: number; drafting: number; publishedThisMonth: number };
  adSpendSummary: { current: number; previous: number; delta: number; deltaPct: number | null };
  recsByActionType: Array<{ actionType: string; count: number }>;
  estimatedValueExecuted: number | null;
  latestInsights?: Array<{ insightType: string; skillId: string; createdAt: string; items: unknown[] }>;
  openOpportunities?: { high: number; medium: number; low: number };
  openMarketInsights?: { critical: number; warning: number; info: number };
  pendingStoreTasks?: number;
  topPendingRecs?: Array<{
    id: string;
    actionType: string;
    targetEntityName: string;
    rationale: string;
    estimatedImpact: string | null;
    guardStatus: string;
  }>;
  recsPendingOver7Days?: number;
  contentLift?: { count: number; avgLiftPts: number } | null;
  dbLatencyMs?: number;
}

export interface FatigueItem {
  adId: string;
  adName: string;
  adSetName: string;
  status: "urgent" | "warning" | "healthy" | "dead";
  frequency: number;
  ctrChange7d: number;
  daysRunning: number;
  estimatedDaysLeft: number | null;
  rationale: string;
}

export interface SearchTermItem {
  searchTerm: string;
  theme: string;
  impressions: number;
  clicks: number;
  conversions: number;
  currentCpaPHP: number | null;
  recommendedMatchType: string;
  recommendedBidPHP: number | null;
  suggestedAdGroup: string | null;
  isNegativeKeyword: boolean;
}

export interface CompetitorItem {
  competitor: string;
  activeAdCount: number;
  dominantFormat: string;
  messagingThemes: string[];
  primaryCta: string;
  recentLaunches7d: number;
  gaps: string[];
  recommendedTests: string[];
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  after: Record<string, unknown> | null;
}

export interface AuditLogResponse {
  items?: AuditEntry[];
  logs?: AuditEntry[];
}

export type JobRunEntry = { status: string; startedAt: string };
export type JobHistoryMap = Record<string, JobRunEntry[]>;
export type SparklineDay = { date: string; count: number };
export type GscMoversPayload = { risers: GscMover[]; fallers: GscMover[]; fetchedAt: string | null };
export type ActivityPayload = { days: SparklineDay[]; timezone?: string; generatedAt?: string };
export type AdTrendPoint = { date: string; spend: number; roas: number };
export type AdTrendPayload = { trend: AdTrendPoint[] };
export type PanelKey = "status" | "audit" | "jobHistory" | "gscMovers" | "activity" | "adTrend";

export interface JobRunStatus {
  id: string;
  jobName: string;
  status: string;
  completedAt: string | null;
  errorLog: string | null;
  label?: string;
}

export interface ActiveRunState {
  runId: string;
  label: string;
  status: string;
  error: string | null;
}
