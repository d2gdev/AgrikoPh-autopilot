import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addInsightRow, emptyMetrics } from "@/lib/ad-pilot/report";
import {
  DASHBOARD_JOB_NAMES,
  QUEUED_DASHBOARD_JOB_NAMES,
  getDashboardJob,
} from "@/lib/dashboard/job-registry";
import { getSeoTaskSummary } from "@/lib/seo-tasks/service";

export const JOB_STATUS_SNAPSHOT_SOURCE = "dashboard_jobs_status_v1";
export const JOB_NAMES = DASHBOARD_JOB_NAMES;

// Jobs with triggerStrategy "cron" or "disabled" create their JobRun row
// directly in the handler (no ownerToken/claimedAt) and only ever reach a
// terminal status via their own try/finally — so if the process is killed
// mid-run (timeout/OOM/crash), the row is stuck at status="running" forever.
// recoverStaleQueuedRuns (lib/jobs/orchestrator.ts) already recovers the
// queued-strategy jobs via their claim/retry mechanism; this set is
// everything that mechanism does NOT cover.
const NON_QUEUED_JOB_NAMES = DASHBOARD_JOB_NAMES.filter(
  (name) => !(QUEUED_DASHBOARD_JOB_NAMES as readonly string[]).includes(name),
);

const SNAPSHOT_DATE = new Date(0);
const STALE_RUNNING_JOB_MINUTES = Number(process.env.JOBS_STATUS_STALE_RUNNING_JOB_MINUTES ?? 30);
const SNAPSHOT_TTL_MS = Number(process.env.JOBS_STATUS_SNAPSHOT_TTL_MS ?? 60_000);
const SLOW_BUILD_THRESHOLD_MS = Number(process.env.JOBS_STATUS_SLOW_BUILD_THRESHOLD_MS ?? 1_000);

type SnapshotPeriod = {
  start: string;
  end: string;
  label: string;
};

type MetaSpendSnapshot = {
  payload: unknown;
  dateRangeStart: Date;
  dateRangeEnd: Date;
};

type SkillInsightRow = {
  id: string;
  insightType: string;
  skillId: string;
  createdAt: Date;
  items: unknown;
};

export type JobsStatusPayload = {
  computedAt: string;
  fromSnapshot: boolean;
  snapshotAgeMs: number | null;
  buildDurationMs: number;
  pendingCount: number;
  hardBlockedCount: number;
  executedThisMonth: number;
  failedCount: number;
  overrideCount: number;
  lastJobRun: Record<string, unknown> | null;
  perJobHealth: Array<Record<string, unknown>>;
  staleRunning: {
    thresholdMinutes: number;
    count: number;
    sample: Array<Record<string, unknown>>;
  };
  contentPilotStats: {
    pending: number;
    drafting: number;
    publishedThisMonth: number;
  };
  adSpendSummary: {
    current: number;
    previous: number;
    delta: number;
    deltaPct: number | null;
    comparable: boolean;
    currentPeriod: SnapshotPeriod | null;
    previousPeriod: SnapshotPeriod | null;
    comparisonLabel: string | null;
  };
  recsByActionType: Array<{ actionType: string; count: number }>;
  estimatedValueExecuted: number | null;
  latestInsights: Array<{ insightType: string; skillId: string; createdAt: string; items: unknown[] }>;
  openOpportunities: { high: number; medium: number; low: number };
  openMarketInsights: { critical: number; warning: number; info: number };
  pendingStoreTasks: number;
  seoTaskSummary: {
    ready: number;
    waiting: number;
    nextScheduledReviewAt: string | null;
  };
  topPendingRecs: Array<{
    id: string;
    actionType: string;
    targetEntityName: string;
    rationale: string;
    estimatedImpact: string | null;
    guardStatus: string;
  }>;
  recsPendingOver7Days: number;
  contentLift: { count: number; avgLiftPts: number } | null;
  dbLatencyMs: number;
  outcomeWinRate: { improved: number; worsened: number; total: number } | null;
  revenueVsMeta: {
    shopifyRevenue: number;
    metaConversionValue: number | null;
    periodStart: string;
    periodEnd: string;
    daysCovered: number;
    currency: string;
  } | null;
};

export type JobRunStatusPayload = {
  id: string;
  jobName: string;
  status: string;
  triggeredBy: string;
  startedAt: string;
  completedAt: string | null;
  claimedAt: string | null;
  lastHeartbeatAt: string | null;
  attempts: number;
  maxAttempts: number;
  summary: unknown | null;
  errorLog: string | null;
  label: string;
  manualTriggerEnabled: boolean;
  manualTriggerDisabledReason: string | null;
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isPayload(value: unknown): value is JobsStatusPayload {
  return Boolean(
    value &&
      typeof value === "object" &&
      "pendingCount" in value &&
      "perJobHealth" in value &&
      "staleRunning" in value,
  );
}

function periodLabel(start: Date, end: Date): string {
  const startLabel = start.toISOString().slice(0, 10);
  const endLabel = end.toISOString().slice(0, 10);
  return startLabel === endLabel ? startLabel : `${startLabel} to ${endLabel}`;
}

function snapshotPeriod(snapshot: MetaSpendSnapshot | undefined): SnapshotPeriod | null {
  if (!snapshot) return null;
  return {
    start: snapshot.dateRangeStart.toISOString(),
    end: snapshot.dateRangeEnd.toISOString(),
    label: periodLabel(snapshot.dateRangeStart, snapshot.dateRangeEnd),
  };
}

function periodDurationMs(snapshot: MetaSpendSnapshot): number {
  return snapshot.dateRangeEnd.getTime() - snapshot.dateRangeStart.getTime();
}

function hasEquivalentPeriod(current: MetaSpendSnapshot, candidate: MetaSpendSnapshot): boolean {
  const currentDuration = periodDurationMs(current);
  const candidateDuration = periodDurationMs(candidate);
  return current.dateRangeStart > candidate.dateRangeStart && Math.abs(currentDuration - candidateDuration) < 1000;
}

function sumSpendFromSnapshot(snap: MetaSpendSnapshot | undefined): number {
  if (!snap) return 0;
  const p = snap.payload as Record<string, unknown>;
  const insights = (p.insights as Array<Record<string, unknown>>) ?? [];
  const m = emptyMetrics();
  for (const row of insights) addInsightRow(m, row);
  return m.spend;
}

// Sums payload.insights[].action_values[] entries with action_type "purchase"
// or "omni_purchase". Returns null when none of the snapshot's insight rows
// carry an action_values array at all (no data), as distinct from carrying
// one that simply has zero matching purchase entries (no purchases).
function sumConversionValueFromSnapshot(snap: MetaSpendSnapshot | undefined): number | null {
  if (!snap) return null;
  const p = snap.payload as Record<string, unknown>;
  const insights = (p.insights as Array<Record<string, unknown>>) ?? [];
  let hasActionValues = false;
  let total = 0;
  for (const row of insights) {
    const actionValues = row.action_values as Array<{ action_type?: string; value?: string }> | undefined;
    if (!actionValues) continue;
    hasActionValues = true;
    for (const av of actionValues) {
      if (av.action_type === "purchase" || av.action_type === "omni_purchase") {
        total += parseFloat(av.value ?? "0") || 0;
      }
    }
  }
  return hasActionValues ? total : null;
}

// Window-aligned Shopify-vs-Meta comparison: both figures are computed over
// the latest Meta snapshot's own date range (not a fixed 7d/30d window) so a
// 30-day Meta figure is never compared against a mismatched Shopify period.
async function computeRevenueVsMeta(
  snapshot: MetaSpendSnapshot | undefined,
): Promise<JobsStatusPayload["revenueVsMeta"]> {
  if (!snapshot) return null;
  const salesRows = await prisma.dailySales.findMany({
    where: { date: { gte: snapshot.dateRangeStart, lte: snapshot.dateRangeEnd } },
    select: { revenue: true, currency: true },
  });
  const [firstRow] = salesRows;
  if (!firstRow) return null;
  const shopifyRevenue = salesRows.reduce((sum, row) => sum + row.revenue, 0);
  return {
    shopifyRevenue,
    metaConversionValue: sumConversionValueFromSnapshot(snapshot),
    periodStart: snapshot.dateRangeStart.toISOString(),
    periodEnd: snapshot.dateRangeEnd.toISOString(),
    daysCovered: salesRows.length,
    currency: firstRow.currency,
  };
}

export function buildAdSpendSummary(metaSnapshots: MetaSpendSnapshot[]): JobsStatusPayload["adSpendSummary"] {
  const current = metaSnapshots[0];
  const previous = current
    ? metaSnapshots.slice(1).find((candidate) => hasEquivalentPeriod(current, candidate))
    : undefined;
  const currentSpend = sumSpendFromSnapshot(current);
  const previousSpend = sumSpendFromSnapshot(previous);
  const spendDelta = previous ? currentSpend - previousSpend : 0;

  return {
    current: currentSpend,
    previous: previousSpend,
    delta: spendDelta,
    deltaPct: previous && previousSpend > 0 ? (spendDelta / previousSpend) * 100 : null,
    comparable: Boolean(previous),
    currentPeriod: snapshotPeriod(current),
    previousPeriod: snapshotPeriod(previous),
    comparisonLabel: current && previous
      ? `${periodLabel(current.dateRangeStart, current.dateRangeEnd)} vs ${periodLabel(previous.dateRangeStart, previous.dateRangeEnd)}`
      : null,
  };
}

async function getLatestSkillInsightRows(): Promise<SkillInsightRow[]> {
  const latestByType = await prisma.skillInsight.groupBy({
    by: ["insightType"],
    _max: { createdAt: true },
  });

  const filters = latestByType.flatMap((row) =>
    row._max.createdAt ? [{ insightType: row.insightType, createdAt: row._max.createdAt }] : [],
  );
  if (filters.length === 0) return [];

  const rows = await prisma.skillInsight.findMany({
    where: { OR: filters },
    orderBy: [{ insightType: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    select: { id: true, insightType: true, skillId: true, createdAt: true, items: true },
  });

  const latest = new Map<string, SkillInsightRow>();
  for (const row of rows) {
    if (!latest.has(row.insightType)) latest.set(row.insightType, row);
  }
  return [...latest.values()];
}

function jobHealthFields(input: {
  lastStatus: string | null;
  lastSuccessAt: Date | null;
  queuedCount: number;
  staleRunningCount: number;
  expectedCadenceHours: number | null;
}) {
  if (input.staleRunningCount > 0) {
    return {
      healthStatus: "stale_running",
      severity: "critical",
      healthReason: "Running past stale threshold",
    };
  }
  if (input.lastStatus === "running") {
    return { healthStatus: "running", severity: "info", healthReason: "Currently running" };
  }
  if (input.queuedCount > 0) {
    return { healthStatus: "queued", severity: "info", healthReason: "Queued and waiting to run" };
  }
  if (!input.lastStatus) {
    return { healthStatus: "never_run", severity: "warning", healthReason: "No recorded runs yet" };
  }
  if (input.lastStatus === "failed") {
    return { healthStatus: "failed", severity: "critical", healthReason: "Last run failed" };
  }
  if (input.lastStatus === "partial") {
    return { healthStatus: "partial", severity: "warning", healthReason: "Last run completed partially" };
  }

  const cadenceHours = input.expectedCadenceHours ?? 24;
  if (input.lastSuccessAt) {
    const ageHours = (Date.now() - input.lastSuccessAt.getTime()) / 3600_000;
    if (ageHours > cadenceHours * 2) {
      return { healthStatus: "stale_success", severity: "critical", healthReason: "Last success is stale" };
    }
    if (ageHours > cadenceHours * 1.1) {
      return { healthStatus: "late_success", severity: "warning", healthReason: "Last success is older than expected cadence" };
    }
  }

  return { healthStatus: "healthy", severity: "success", healthReason: "Last run succeeded within cadence" };
}

export async function buildJobsStatusPayload(): Promise<JobsStatusPayload> {
  const buildStartedAt = Date.now();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const staleRunningBefore = new Date(Date.now() - STALE_RUNNING_JOB_MINUTES * 60_000);

  // Self-heal stuck "running" rows for non-queued jobs before computing health
  // below, so a crash that killed the process mid-run doesn't permanently pin
  // that job's dashboard tile to "stale_running"/critical even after later
  // runs succeed. Queued-strategy jobs are excluded: drain-jobs already
  // recovers those via recoverStaleQueuedRuns's claim/retry logic, and
  // marking them "failed" here would skip that retry behavior.
  await prisma.jobRun.updateMany({
    where: {
      jobName: { in: NON_QUEUED_JOB_NAMES },
      status: "running",
      startedAt: { lt: staleRunningBefore },
    },
    data: {
      status: "failed",
      completedAt: new Date(),
      errorLog: `Recovered: run exceeded ${STALE_RUNNING_JOB_MINUTES}m without completing (process likely crashed or was killed mid-run).`,
    },
  });

  const dbPingStart = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const dbLatencyMs = Date.now() - dbPingStart;

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3_600_000);
  const outcomeRows = await prisma.recommendation.findMany({
    where: { status: "executed", outcomeCheckedAt: { gte: ninetyDaysAgo } },
    select: { outcome: true },
  });
  let outcomesImproved = 0;
  let outcomesWorsened = 0;
  for (const row of outcomeRows) {
    const verdict = (row.outcome as { verdict?: string } | null)?.verdict;
    if (verdict === "improved") outcomesImproved++;
    else if (verdict === "worsened") outcomesWorsened++;
  }

  const [
    recommendationStatusCounts,
    hardBlockedCount,
    executedThisMonth,
    lastJobRun,
    lastRunGroups,
    lastSuccessGroups,
    queuedGroups,
    staleRunningGroups,
    staleRunningRuns,
    contentProposalGroups,
    contentPublishedThisMonth,
    metaSnapshots,
    recActionTypeGroups,
    estimatedValueAgg,
    latestInsightRows,
    opportunityGroups,
    marketInsightGroups,
    pendingStoreTasksCount,
    topPendingRecsRows,
    recsPendingOver7DaysCount,
    liftProposals,
    seoTaskSummary,
  ] = await Promise.all([
    prisma.recommendation.groupBy({
      by: ["status"],
      where: { status: { in: ["pending", "failed", "override_approved", "approved", "executing"] } },
      _count: { _all: true },
    }),
    prisma.recommendation.count({ where: { guardStatus: "hard_block", status: "pending" } }),
    prisma.recommendation.count({ where: { status: "executed", executedAt: { gte: monthStart } } }),
    prisma.jobRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: { jobName: true, status: true, startedAt: true, summary: true },
    }),
    prisma.jobRun.groupBy({
      by: ["jobName"],
      where: { jobName: { in: JOB_NAMES } },
      _max: { startedAt: true },
    }),
    prisma.jobRun.groupBy({
      by: ["jobName"],
      where: {
        jobName: { in: JOB_NAMES },
        status: { in: ["success", "partial"] },
        completedAt: { not: null },
      },
      _max: { completedAt: true },
    }),
    prisma.jobRun.groupBy({
      by: ["jobName"],
      where: {
        jobName: { in: JOB_NAMES },
        status: "queued",
      },
      _count: { _all: true },
      _min: { startedAt: true },
    }),
    prisma.jobRun.groupBy({
      by: ["jobName"],
      where: {
        jobName: { in: JOB_NAMES },
        status: "running",
        startedAt: { lt: staleRunningBefore },
      },
      _count: { _all: true },
      _min: { startedAt: true },
    }),
    prisma.jobRun.findMany({
      where: {
        jobName: { in: JOB_NAMES },
        status: "running",
        startedAt: { lt: staleRunningBefore },
      },
      orderBy: { startedAt: "asc" },
      take: 10,
      select: { id: true, jobName: true, startedAt: true },
    }),
    prisma.contentProposal.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.contentProposal.count({
      where: { publishedAt: { gte: monthStart } },
    }),
    prisma.rawSnapshot.findMany({
      where: { source: "meta" },
      orderBy: { fetchedAt: "desc" },
      take: 12,
      select: { payload: true, dateRangeStart: true, dateRangeEnd: true },
    }),
    prisma.recommendation.groupBy({
      by: ["actionType"],
      where: { status: "executed", executedAt: { gte: monthStart } },
      _count: { _all: true },
    }),
    prisma.recommendation.aggregate({
      where: { status: "executed", executedAt: { gte: monthStart } },
      _sum: { estimatedValuePhp: true },
    }),
    getLatestSkillInsightRows(),
    prisma.opportunity.groupBy({
      by: ["priority"],
      where: { status: "open" },
      _count: { _all: true },
    }),
    prisma.marketInsight.groupBy({
      by: ["severity"],
      where: { status: "open" },
      _count: { _all: true },
    }),
    prisma.storeTask.count({ where: { status: "pending" } }),
    prisma.recommendation.findMany({
      where: { status: "pending" },
      orderBy: [{ guardStatus: "desc" }, { createdAt: "asc" }],
      take: 5,
      select: {
        id: true,
        actionType: true,
        targetEntityName: true,
        rationale: true,
        estimatedImpact: true,
        guardStatus: true,
      },
    }),
    prisma.recommendation.count({
      where: {
        status: "pending",
        createdAt: { lte: new Date(Date.now() - 7 * 24 * 3600_000) },
      },
    }),
    prisma.contentProposal.findMany({
      where: {
        baselineSeoScore: { not: null },
        followUpSeoScore: { not: null },
      },
      select: { baselineSeoScore: true, followUpSeoScore: true },
    }),
    getSeoTaskSummary(now),
  ]);

  const countByStatus = new Map(
    recommendationStatusCounts.map((row) => [row.status, row._count._all]),
  );
  const pendingCount = countByStatus.get("pending") ?? 0;
  const failedCount = countByStatus.get("failed") ?? 0;
  const overrideCount = countByStatus.get("override_approved") ?? 0;

  const latestRunFilters = lastRunGroups
    .flatMap((row) => row._max.startedAt ? [{ jobName: row.jobName, startedAt: row._max.startedAt }] : []);
  const latestRuns = latestRunFilters.length > 0
    ? await prisma.jobRun.findMany({
        where: { OR: latestRunFilters },
        select: { jobName: true, status: true, startedAt: true, errorLog: true },
      })
    : [];

  const lastRunByJob = new Map<string, typeof latestRuns[number]>();
  for (const run of latestRuns) {
    const existing = lastRunByJob.get(run.jobName);
    if (!existing || run.startedAt > existing.startedAt) {
      lastRunByJob.set(run.jobName, run);
    }
  }

  const lastSuccessByJob = new Map(
    lastSuccessGroups.map((row) => [row.jobName, row._max.completedAt]),
  );
  const queuedByJob = new Map(
    queuedGroups.map((row) => [
      row.jobName,
      {
        count: row._count._all,
        oldestQueuedAt: row._min.startedAt,
      },
    ]),
  );
  const staleRunningByJob = new Map(
    staleRunningGroups.map((row) => [
      row.jobName,
      {
        count: row._count._all,
        oldestStartedAt: row._min.startedAt,
      },
    ]),
  );
  const staleRunningCount = staleRunningGroups.reduce((sum, row) => sum + row._count._all, 0);

  const perJobHealth = JOB_NAMES.map((jobName) => {
    const registry = getDashboardJob(jobName);
    const last = lastRunByJob.get(jobName);
    const queued = queuedByJob.get(jobName);
    const stale = staleRunningByJob.get(jobName);
    const expectedCadenceHours = registry?.expectedCadenceHours ?? null;
    const lastSuccessAt = lastSuccessByJob.get(jobName) ?? null;
    return {
      jobName,
      label: registry?.label ?? jobName,
      manualTriggerEnabled: registry?.manualTriggerEnabled ?? false,
      manualTriggerDisabledReason: registry?.manualTriggerDisabledReason ?? null,
      triggerStrategy: registry?.triggerStrategy ?? "disabled",
      cronPath: registry?.cronPath ?? null,
      cronCadence: registry?.cronCadence ?? null,
      expectedCadenceHours,
      lastStatus: last?.status ?? null,
      lastStartedAt: last?.startedAt ?? null,
      lastSuccessAt,
      queuedCount: queued?.count ?? 0,
      oldestQueuedAt: queued?.oldestQueuedAt ?? null,
      staleRunningCount: stale?.count ?? 0,
      oldestStaleRunningStartedAt: stale?.oldestStartedAt ?? null,
      ...jobHealthFields({
        lastStatus: last?.status ?? null,
        lastSuccessAt,
        queuedCount: queued?.count ?? 0,
        staleRunningCount: stale?.count ?? 0,
        expectedCadenceHours,
      }),
      errorExcerpt:
        last?.status && !["success", "running", "queued"].includes(last.status)
          ? (last.errorLog ?? "").slice(0, 300)
          : null,
    };
  });

  const proposalCountByStatus = new Map(
    contentProposalGroups.map((row) => [row.status, row._count._all]),
  );
  const contentPilotStats = {
    pending: proposalCountByStatus.get("pending") ?? 0,
    drafting: proposalCountByStatus.get("approved") ?? 0,
    publishedThisMonth: contentPublishedThisMonth,
  };

  const adSpendSummary = buildAdSpendSummary(metaSnapshots);
  const revenueVsMeta = await computeRevenueVsMeta(metaSnapshots[0]);

  const recsByActionType = recActionTypeGroups.map((row) => ({
    actionType: row.actionType,
    count: row._count._all,
  }));

  const estimatedValueExecuted = estimatedValueAgg._sum.estimatedValuePhp ?? null;

  const oppByPriority = new Map(opportunityGroups.map((r) => [r.priority, r._count._all]));
  const openOpportunities = {
    high: oppByPriority.get("high") ?? 0,
    medium: oppByPriority.get("medium") ?? 0,
    low: oppByPriority.get("low") ?? 0,
  };

  const insightBySeverity = new Map(marketInsightGroups.map((r) => [r.severity, r._count._all]));
  const openMarketInsights = {
    critical: insightBySeverity.get("critical") ?? 0,
    warning: insightBySeverity.get("warning") ?? 0,
    info: insightBySeverity.get("info") ?? 0,
  };

  const topPendingRecs = topPendingRecsRows.map((r) => ({
    id: r.id,
    actionType: r.actionType,
    targetEntityName: r.targetEntityName,
    rationale: r.rationale,
    estimatedImpact: r.estimatedImpact ?? null,
    guardStatus: r.guardStatus,
  }));

  const contentLift =
    liftProposals.length === 0
      ? null
      : {
          count: liftProposals.length,
          avgLiftPts:
            liftProposals.reduce(
              (sum, p) => sum + ((p.followUpSeoScore ?? 0) - (p.baselineSeoScore ?? 0)),
              0,
            ) / liftProposals.length,
        };

  const latestInsights = latestInsightRows.map((row) => ({
    insightType: row.insightType,
    skillId: row.skillId,
    createdAt: row.createdAt.toISOString(),
    items: row.items as unknown[],
  }));

  const buildDurationMs = Date.now() - buildStartedAt;
  if (buildDurationMs >= SLOW_BUILD_THRESHOLD_MS) {
    console.warn("[jobs-status] slow build", {
      durationMs: buildDurationMs,
      dbLatencyMs,
      jobCount: JOB_NAMES.length,
    });
  }

  return {
    computedAt: new Date().toISOString(),
    fromSnapshot: false,
    snapshotAgeMs: null,
    buildDurationMs,
    pendingCount,
    hardBlockedCount,
    executedThisMonth,
    failedCount,
    overrideCount,
    lastJobRun,
    perJobHealth,
    staleRunning: {
      thresholdMinutes: STALE_RUNNING_JOB_MINUTES,
      count: staleRunningCount,
      sample: staleRunningRuns,
    },
    contentPilotStats,
    adSpendSummary,
    recsByActionType,
    estimatedValueExecuted,
    latestInsights,
    openOpportunities,
    openMarketInsights,
    pendingStoreTasks: pendingStoreTasksCount,
    seoTaskSummary,
    topPendingRecs,
    recsPendingOver7Days: recsPendingOver7DaysCount,
    contentLift,
    dbLatencyMs,
    outcomeWinRate: outcomeRows.length > 0
      ? { improved: outcomesImproved, worsened: outcomesWorsened, total: outcomeRows.length }
      : null,
    revenueVsMeta,
  };
}

export async function materializeJobsStatusSnapshot(): Promise<JobsStatusPayload> {
  const payload = await buildJobsStatusPayload();
  await prisma.rawSnapshot.upsert({
    where: {
      source_dateRangeStart_dateRangeEnd: {
        source: JOB_STATUS_SNAPSHOT_SOURCE,
        dateRangeStart: SNAPSHOT_DATE,
        dateRangeEnd: SNAPSHOT_DATE,
      },
    },
    create: {
      source: JOB_STATUS_SNAPSHOT_SOURCE,
      dateRangeStart: SNAPSHOT_DATE,
      dateRangeEnd: SNAPSHOT_DATE,
      payload: json(payload),
    },
    update: {
      payload: json(payload),
      fetchedAt: new Date(),
    },
  });
  return payload;
}

async function readFreshJobsStatusSnapshot(): Promise<JobsStatusPayload | null> {
  const startedAt = Date.now();
  const snapshot = await prisma.rawSnapshot.findUnique({
    where: {
      source_dateRangeStart_dateRangeEnd: {
        source: JOB_STATUS_SNAPSHOT_SOURCE,
        dateRangeStart: SNAPSHOT_DATE,
        dateRangeEnd: SNAPSHOT_DATE,
      },
    },
    select: { fetchedAt: true, payload: true },
  });
  if (!snapshot) {
    console.info("[jobs-status] snapshot miss", { reason: "missing", durationMs: Date.now() - startedAt });
    return null;
  }
  const snapshotAgeMs = Date.now() - snapshot.fetchedAt.getTime();
  if (snapshotAgeMs > SNAPSHOT_TTL_MS) {
    console.info("[jobs-status] snapshot miss", {
      reason: "expired",
      snapshotAgeMs,
      ttlMs: SNAPSHOT_TTL_MS,
      durationMs: Date.now() - startedAt,
    });
    return null;
  }
  if (!isPayload(snapshot.payload)) {
    console.warn("[jobs-status] snapshot miss", { reason: "invalid", durationMs: Date.now() - startedAt });
    return null;
  }
  console.info("[jobs-status] snapshot hit", {
    snapshotAgeMs,
    durationMs: Date.now() - startedAt,
  });
  const payload = snapshot.payload as JobsStatusPayload;
  return {
    ...payload,
    fromSnapshot: true,
    snapshotAgeMs,
  };
}

export async function getJobsStatusPayload(): Promise<JobsStatusPayload> {
  const snapshot = await readFreshJobsStatusSnapshot();
  if (snapshot) return snapshot;
  return materializeJobsStatusSnapshot();
}

export async function getJobRunStatusById(runId: string): Promise<JobRunStatusPayload | null> {
  const run = await prisma.jobRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      jobName: true,
      status: true,
      triggeredBy: true,
      startedAt: true,
      completedAt: true,
      claimedAt: true,
      lastHeartbeatAt: true,
      attempts: true,
      maxAttempts: true,
      summary: true,
      errorLog: true,
    },
  });

  if (!run) return null;

  const registry = getDashboardJob(run.jobName);
  return {
    id: run.id,
    jobName: run.jobName,
    status: run.status,
    triggeredBy: run.triggeredBy,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    claimedAt: run.claimedAt?.toISOString() ?? null,
    lastHeartbeatAt: run.lastHeartbeatAt?.toISOString() ?? null,
    attempts: run.attempts,
    maxAttempts: run.maxAttempts,
    summary: run.summary ?? null,
    errorLog: run.errorLog,
    label: registry?.label ?? run.jobName,
    manualTriggerEnabled: registry?.manualTriggerEnabled ?? false,
    manualTriggerDisabledReason: registry?.manualTriggerDisabledReason ?? null,
  };
}
