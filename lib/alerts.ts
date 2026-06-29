import { prisma } from "@/lib/db";

interface JobFailureAlertInput {
  jobName: string;
  route?: string;
  error: unknown;
  status?: string;
}

function errorExcerpt(error: unknown) {
  const value = error instanceof Error
    ? error.stack ?? error.message
    : String(error);
  return value.replace(/\s+/g, " ").slice(0, 800);
}

async function postWebhook(payload: Record<string, unknown>): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.warn(`[alerts] webhook returned HTTP ${response.status}`);
    }
  } catch (err) {
    console.warn("[alerts] failed to send webhook:", err);
  }
}

const MONITORED_JOBS = [
  { jobName: "fetch-ads-data", staleHours: 26 },
  { jobName: "run-skills", staleHours: 26 },
  { jobName: "fetch-market-intel", staleHours: 26 },
  { jobName: "execute-approved", staleHours: 26 },
];

const ORCHESTRATED_JOB_NAMES = ["dashboard-refresh"];
const ALERT_SAMPLE_LIMIT = 10;

function positiveNumberFromEnv(names: string[], fallback: number): number {
  for (const name of names) {
    const raw = process.env[name];
    if (!raw) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return fallback;
}

function minutesAgo(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}

function isoDate(date: Date | null | undefined): string | null {
  return date?.toISOString() ?? null;
}

async function alertStuckQueuedJobs(now: Date, appUrl: string | null): Promise<void> {
  const staleMinutes = positiveNumberFromEnv(["ALERT_QUEUED_JOB_STALE_MINUTES", "JOB_QUEUE_STALE_MINUTES"], 30);
  const cutoff = minutesAgo(now, staleMinutes);
  const where = { status: "queued", startedAt: { lt: cutoff } };

  const [count, sample] = await Promise.all([
    prisma.jobRun.count({ where }),
    prisma.jobRun.findMany({
      where,
      orderBy: { startedAt: "asc" },
      take: ALERT_SAMPLE_LIMIT,
      select: { id: true, jobName: true, startedAt: true, attempts: true, maxAttempts: true },
    }),
  ]);

  if (count === 0) return;

  console.warn(`[alerts] stuck queued jobs: ${count} older than ${staleMinutes}m`);
  await postWebhook({
    type: "stuck_queued_jobs",
    appUrl,
    count,
    staleThresholdMinutes: staleMinutes,
    oldestQueuedAt: isoDate(sample[0]?.startedAt),
    jobs: sample.map((job) => ({
      id: job.id,
      jobName: job.jobName,
      queuedAt: job.startedAt.toISOString(),
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
    })),
    timestamp: now.toISOString(),
  });
}

async function alertStaleRunningQueuedJobs(now: Date, appUrl: string | null): Promise<void> {
  const staleMinutes = positiveNumberFromEnv(["ALERT_RUNNING_JOB_STALE_MINUTES", "JOB_QUEUE_STALE_MINUTES"], 30);
  const cutoff = minutesAgo(now, staleMinutes);
  const where = {
    status: "running",
    OR: [
      { ownerToken: { not: null }, startedAt: { lt: cutoff } },
      { ownerToken: { not: null }, lastHeartbeatAt: { lt: cutoff } },
      { ownerToken: { not: null }, lastHeartbeatAt: null, claimedAt: { lt: cutoff } },
      { parentRunId: { not: null }, startedAt: { lt: cutoff } },
      { jobName: { in: ORCHESTRATED_JOB_NAMES }, startedAt: { lt: cutoff } },
    ],
  };

  const [count, sample] = await Promise.all([
    prisma.jobRun.count({ where }),
    prisma.jobRun.findMany({
      where,
      orderBy: { startedAt: "asc" },
      take: ALERT_SAMPLE_LIMIT,
      select: {
        id: true,
        jobName: true,
        startedAt: true,
        claimedAt: true,
        lastHeartbeatAt: true,
        ownerToken: true,
        parentRunId: true,
        attempts: true,
        maxAttempts: true,
      },
    }),
  ]);

  if (count === 0) return;

  console.warn(`[alerts] stale running queued/orchestrated jobs: ${count} older than ${staleMinutes}m`);
  await postWebhook({
    type: "stale_running_jobs",
    appUrl,
    count,
    staleThresholdMinutes: staleMinutes,
    oldestStartedAt: isoDate(sample[0]?.startedAt),
    jobs: sample.map((job) => ({
      id: job.id,
      jobName: job.jobName,
      startedAt: job.startedAt.toISOString(),
      claimedAt: isoDate(job.claimedAt),
      lastHeartbeatAt: isoDate(job.lastHeartbeatAt),
      hasOwnerToken: Boolean(job.ownerToken),
      parentRunId: job.parentRunId,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
    })),
    timestamp: now.toISOString(),
  });
}

async function alertJobLockAnomalies(now: Date, appUrl: string | null): Promise<void> {
  const staleActiveMinutes = positiveNumberFromEnv(["ALERT_ACTIVE_JOB_LOCK_STALE_MINUTES", "JOB_QUEUE_STALE_MINUTES"], 30);
  const activeCutoff = minutesAgo(now, staleActiveMinutes);
  const expiredWhere = { expiresAt: { lt: now } };
  const staleActiveWhere = { expiresAt: { gte: now }, lockedAt: { lt: activeCutoff } };

  const [expiredCount, expiredSample, staleActiveCount, staleActiveSample] = await Promise.all([
    prisma.jobLock.count({ where: expiredWhere }),
    prisma.jobLock.findMany({
      where: expiredWhere,
      orderBy: { expiresAt: "asc" },
      take: ALERT_SAMPLE_LIMIT,
      select: { jobName: true, lockedAt: true, expiresAt: true, ownerToken: true },
    }),
    prisma.jobLock.count({ where: staleActiveWhere }),
    prisma.jobLock.findMany({
      where: staleActiveWhere,
      orderBy: { lockedAt: "asc" },
      take: ALERT_SAMPLE_LIMIT,
      select: { jobName: true, lockedAt: true, expiresAt: true, ownerToken: true },
    }),
  ]);

  if (expiredCount > 0) {
    console.warn(`[alerts] expired job locks still present: ${expiredCount}`);
    await postWebhook({
      type: "expired_job_locks",
      appUrl,
      count: expiredCount,
      locks: expiredSample.map((lock) => ({
        jobName: lock.jobName,
        lockedAt: lock.lockedAt.toISOString(),
        expiresAt: lock.expiresAt.toISOString(),
        hasOwnerToken: Boolean(lock.ownerToken),
      })),
      timestamp: now.toISOString(),
    });
  }

  if (staleActiveCount > 0) {
    console.warn(`[alerts] stale active job locks: ${staleActiveCount} older than ${staleActiveMinutes}m`);
    await postWebhook({
      type: "stale_active_job_locks",
      appUrl,
      count: staleActiveCount,
      staleThresholdMinutes: staleActiveMinutes,
      locks: staleActiveSample.map((lock) => ({
        jobName: lock.jobName,
        lockedAt: lock.lockedAt.toISOString(),
        expiresAt: lock.expiresAt.toISOString(),
        hasOwnerToken: Boolean(lock.ownerToken),
      })),
      timestamp: now.toISOString(),
    });
  }
}

export async function checkAndAlertJobHealth(): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  const appUrl = process.env.SHOPIFY_APP_URL ?? null;
  const now = new Date();

  await Promise.allSettled([
    ...MONITORED_JOBS.map(async ({ jobName, staleHours }) => {
      const cutoff = new Date(now.getTime() - staleHours * 3_600_000);

      const [lastSuccess, recentRuns] = await Promise.all([
        prisma.jobRun.findFirst({
          where: { jobName, status: { in: ["success", "partial"] } },
          orderBy: { completedAt: "desc" },
          select: { completedAt: true },
        }),
        prisma.jobRun.findMany({
          where: { jobName, completedAt: { not: null } },
          orderBy: { completedAt: "desc" },
          take: 3,
          select: { status: true, completedAt: true },
        }),
      ]);

      // Stale: no successful run in staleHours
      if (!lastSuccess || (lastSuccess.completedAt && lastSuccess.completedAt < cutoff)) {
        const lastAt = lastSuccess?.completedAt?.toISOString() ?? "never";
        console.warn(`[alerts] stale job: ${jobName} last succeeded at ${lastAt}`);
        await postWebhook({
          type: "stale_job",
          jobName,
          appUrl,
          lastSuccessAt: lastAt,
          staleThresholdHours: staleHours,
          timestamp: now.toISOString(),
        });
        return;
      }

      // Repeated partial/failed: last 3 completed runs are all non-success
      const allBad = recentRuns.length >= 3 && recentRuns.every((r) => r.status !== "success");
      if (allBad) {
        console.warn(`[alerts] repeated non-success runs for ${jobName}: ${recentRuns.map((r) => r.status).join(", ")}`);
        await postWebhook({
          type: "repeated_partial",
          jobName,
          appUrl,
          recentStatuses: recentRuns.map((r) => r.status),
          timestamp: now.toISOString(),
        });
      }
    }),
    alertStuckQueuedJobs(now, appUrl),
    alertStaleRunningQueuedJobs(now, appUrl),
    alertJobLockAnomalies(now, appUrl),
  ]);
}

// Data-freshness check. checkAndAlertJobHealth only knows whether a job RAN;
// it cannot catch a job that succeeds while silently collecting zero rows (as
// the Meta ad stream did). This verifies real data is actually landing.
const MONITORED_STREAMS: Array<{ label: string; staleHours: number; newest: () => Promise<Date | null> }> = [
  {
    label: "competitorAd",
    staleHours: 50,
    newest: async () =>
      (await prisma.competitorAd.findFirst({ orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }))?.capturedAt ?? null,
  },
  {
    label: "shoppingResult",
    staleHours: 50,
    newest: async () =>
      (await prisma.shoppingResult.findFirst({ orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }))?.capturedAt ?? null,
  },
  {
    label: "keywordResearchResult",
    staleHours: 8 * 24,
    newest: async () =>
      (await prisma.keywordResearchResult.findFirst({ orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }))?.capturedAt ?? null,
  },
  {
    label: "gscQuery",
    staleHours: 8 * 24,
    newest: async () =>
      (await prisma.gscQuery.findFirst({ orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }))?.capturedAt ?? null,
  },
];

export async function checkAndAlertDataFreshness(): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  const appUrl = process.env.SHOPIFY_APP_URL ?? null;
  const now = new Date();

  await Promise.allSettled(MONITORED_STREAMS.map(async ({ label, staleHours, newest }) => {
    const newestAt = await newest();
    const cutoff = new Date(now.getTime() - staleHours * 3_600_000);

    if (!newestAt) {
      console.warn(`[alerts] empty data stream: ${label}`);
      await postWebhook({ type: "empty_stream", stream: label, appUrl, timestamp: now.toISOString() });
      return;
    }
    if (newestAt < cutoff) {
      console.warn(`[alerts] stale data stream: ${label} newest at ${newestAt.toISOString()}`);
      await postWebhook({
        type: "stale_stream",
        stream: label,
        appUrl,
        newestAt: newestAt.toISOString(),
        staleThresholdHours: staleHours,
        timestamp: now.toISOString(),
      });
    }
  }));
}

export async function notifyJobFailure(input: JobFailureAlertInput): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  const payload = {
    type: "job_failure",
    jobName: input.jobName,
    route: input.route,
    status: input.status ?? "failed",
    appUrl: process.env.SHOPIFY_APP_URL ?? null,
    timestamp: new Date().toISOString(),
    errorExcerpt: errorExcerpt(input.error),
  };

  await postWebhook(payload);
}
