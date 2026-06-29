import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
import type { JobResult, JobStatus } from "@/lib/jobs/types";
import { VALID_PROFILES, type RunProfile } from "@/lib/market-intel/profiles";
import {
  QUEUED_DASHBOARD_JOB_NAMES,
  type QueuedDashboardJobName,
} from "@/lib/dashboard/job-registry";

export type QueuedJobName = QueuedDashboardJobName;

type EnqueueJobInput = {
  jobName: QueuedJobName;
  triggeredBy: string;
  input?: Record<string, unknown>;
  maxAttempts?: number;
};

type QueueRun = {
  id: string;
  jobName: string;
  input: Prisma.InputJsonValue | null;
  ownerToken: string | null;
};

type DrainOptions = {
  limit?: number;
  staleAfterMinutes?: number;
  heartbeatMs?: number;
};

type DrainRunResult = {
  runId: string;
  jobName: string;
  status: JobStatus;
  errors: string[];
};

const QUEUED_JOB_NAMES: QueuedJobName[] = [...QUEUED_DASHBOARD_JOB_NAMES];
const DEFAULT_STALE_MINUTES = Number(process.env.JOB_QUEUE_STALE_MINUTES ?? 30);
const DEFAULT_HEARTBEAT_MS = Math.max(5_000, Number(process.env.JOB_QUEUE_HEARTBEAT_MS ?? 30_000));

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function staleMessage(run: { id: string; jobName: string; attempts: number; maxAttempts: number }) {
  return `[job-queue] Run ${run.id} for ${run.jobName} was recovered after heartbeat timeout. Attempt ${run.attempts}/${run.maxAttempts}.`;
}

async function withAdvisoryTransaction<T>(
  key: string,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${key}))`;
    return run(tx);
  });
}

export async function enqueueJob(input: EnqueueJobInput): Promise<{
  runId: string;
  status: "queued" | "running";
  created: boolean;
}> {
  return withAdvisoryTransaction(`job-enqueue:${input.jobName}`, async (tx) => {
    const existing = await tx.jobRun.findFirst({
      where: {
        jobName: input.jobName,
        status: { in: ["queued", "running"] },
      },
      orderBy: { startedAt: "asc" },
      select: { id: true, status: true },
    });

    if (existing) {
      return {
        runId: existing.id,
        status: existing.status === "running" ? "running" : "queued",
        created: false,
      };
    }

    const run = await tx.jobRun.create({
      data: {
        jobName: input.jobName,
        triggeredBy: input.triggeredBy,
        status: "queued",
        input: input.input ? json(input.input) : undefined,
        maxAttempts: input.maxAttempts ?? 2,
      },
      select: { id: true },
    });

    return { runId: run.id, status: "queued", created: true };
  });
}

export async function recoverStaleQueuedRuns(staleAfterMinutes = DEFAULT_STALE_MINUTES): Promise<{
  failed: number;
  requeued: number;
}> {
  const cutoff = new Date(Date.now() - staleAfterMinutes * 60_000);
  const staleRuns = await prisma.jobRun.findMany({
    where: {
      jobName: { in: QUEUED_JOB_NAMES },
      status: "running",
      ownerToken: { not: null },
      OR: [
        { lastHeartbeatAt: { lt: cutoff } },
        { lastHeartbeatAt: null, claimedAt: { lt: cutoff } },
      ],
    },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      jobName: true,
      attempts: true,
      maxAttempts: true,
      errorLog: true,
    },
  });

  let failed = 0;
  let requeued = 0;
  for (const run of staleRuns) {
    const message = staleMessage(run);
    const errorLog = [run.errorLog, message].filter(Boolean).join("\n").slice(0, 10_000);
    if (run.attempts < run.maxAttempts) {
      const result = await prisma.jobRun.updateMany({
        where: { id: run.id, status: "running" },
        data: {
          status: "queued",
          claimedAt: null,
          lastHeartbeatAt: null,
          ownerToken: null,
          errorLog,
        },
      });
      requeued += result.count;
    } else {
      const result = await prisma.jobRun.updateMany({
        where: { id: run.id, status: "running" },
        data: {
          status: "failed",
          completedAt: new Date(),
          claimedAt: null,
          lastHeartbeatAt: null,
          ownerToken: null,
          errorLog,
        },
      });
      failed += result.count;
    }
  }

  return { failed, requeued };
}

async function claimNextQueuedRun(): Promise<QueueRun | null> {
  const ownerToken = randomUUID();
  return withAdvisoryTransaction("job-queue:claim", async (tx) => {
    const run = await tx.jobRun.findFirst({
      where: {
        jobName: { in: QUEUED_JOB_NAMES },
        status: "queued",
      },
      orderBy: { startedAt: "asc" },
      select: { id: true, jobName: true, input: true },
    });
    if (!run) return null;

    const now = new Date();
    const claimed = await tx.jobRun.updateMany({
      where: { id: run.id, status: "queued" },
      data: {
        status: "running",
        attempts: { increment: 1 },
        claimedAt: now,
        lastHeartbeatAt: now,
        ownerToken,
      },
    });
    if (claimed.count !== 1) return null;

    return {
      id: run.id,
      jobName: run.jobName,
      input: run.input,
      ownerToken,
    };
  });
}

async function heartbeat(run: QueueRun): Promise<void> {
  if (!run.ownerToken) return;
  await prisma.jobRun.updateMany({
    where: { id: run.id, status: "running", ownerToken: run.ownerToken },
    data: { lastHeartbeatAt: new Date() },
  });
}

async function dispatchQueuedRun(run: QueueRun): Promise<JobResult<unknown>> {
  if (run.jobName === "fetch-market-intel") {
    const acquired = await acquireJobLock("fetch-market-intel", {
      ownerToken: run.ownerToken ?? undefined,
      ttlMs: Math.max(10 * 60_000, DEFAULT_STALE_MINUTES * 60_000),
    });
    if (!acquired) {
      return {
        jobName: "fetch-market-intel",
        runId: run.id,
        status: "skipped",
        summary: {},
        errors: ["fetch-market-intel is already running"],
      };
    }

    try {
      const input = run.input && typeof run.input === "object" && run.input !== null
        ? run.input as Record<string, unknown>
        : {};
      const requestedProfile = typeof input.profile === "string" ? input.profile : "scheduled";
      const normalizedProfile = requestedProfile === "scheduled"
        ? "scheduled"
        : VALID_PROFILES.includes(requestedProfile as RunProfile)
          ? requestedProfile as RunProfile
          : "smoke";

      const { fetchMarketIntelHandler } = await import("@/jobs/fetch-market-intel");
      return await fetchMarketIntelHandler({
        profile: normalizedProfile,
        runId: run.id,
      });
    } catch (err) {
      return {
        jobName: "fetch-market-intel",
        runId: run.id,
        status: "failed",
        summary: { error: errorMessage(err) },
        errors: [errorMessage(err)],
      };
    } finally {
      await releaseJobLock("fetch-market-intel", run.ownerToken ?? undefined);
    }
  }

  if (run.jobName === "fetch-keyword-research") {
    const acquired = await acquireJobLock("fetch-keyword-research", {
      ownerToken: run.ownerToken ?? undefined,
      ttlMs: Math.max(10 * 60_000, DEFAULT_STALE_MINUTES * 60_000),
    });
    if (!acquired) {
      return {
        jobName: "fetch-keyword-research",
        runId: run.id,
        status: "skipped",
        summary: {},
        errors: ["fetch-keyword-research is already running"],
      };
    }

    try {
      const { fetchKeywordResearchHandler } = await import("@/jobs/fetch-keyword-research");
      return await fetchKeywordResearchHandler({ runId: run.id });
    } catch (err) {
      return {
        jobName: "fetch-keyword-research",
        runId: run.id,
        status: "failed",
        summary: { error: errorMessage(err) },
        errors: [errorMessage(err)],
      };
    } finally {
      await releaseJobLock("fetch-keyword-research", run.ownerToken ?? undefined);
    }
  }

  if (run.jobName === "dashboard-refresh") {
    const acquired = await acquireJobLock("dashboard-refresh", {
      ownerToken: run.ownerToken ?? undefined,
      ttlMs: Math.max(10 * 60_000, DEFAULT_STALE_MINUTES * 60_000),
    });
    if (!acquired) {
      return {
        jobName: "dashboard-refresh",
        runId: run.id,
        status: "skipped",
        summary: {},
        errors: ["dashboard-refresh is already running"],
      };
    }

    try {
      const { runDashboardRefreshHandler } = await import("@/jobs/run-dashboard-refresh");
      return await runDashboardRefreshHandler(run.id, { releaseDashboardLock: false });
    } finally {
      await releaseJobLock("dashboard-refresh", run.ownerToken ?? undefined);
    }
  }

  throw new Error(`No queued job dispatcher registered for ${run.jobName}`);
}

async function finishQueueOwnership(run: QueueRun, result: JobResult<unknown>): Promise<void> {
  if (!run.ownerToken) return;

  if (result.status === "skipped") {
    await prisma.jobRun.updateMany({
      where: { id: run.id, ownerToken: run.ownerToken },
      data: {
        status: "queued",
        claimedAt: null,
        lastHeartbeatAt: null,
        ownerToken: null,
        errorLog: result.errors.join("\n").slice(0, 10_000) || null,
      },
    });
    return;
  }

  await prisma.jobRun.updateMany({
    where: { id: run.id, ownerToken: run.ownerToken },
    data: {
      ownerToken: null,
      lastHeartbeatAt: new Date(),
    },
  });
}

async function failClaimedRun(run: QueueRun, err: unknown): Promise<DrainRunResult> {
  const message = errorMessage(err).slice(0, 10_000);
  await prisma.jobRun.updateMany({
    where: run.ownerToken ? { id: run.id, ownerToken: run.ownerToken } : { id: run.id },
    data: {
      status: "failed",
      completedAt: new Date(),
      ownerToken: null,
      lastHeartbeatAt: new Date(),
      errorLog: message,
    },
  });
  return { runId: run.id, jobName: run.jobName, status: "failed", errors: [message] };
}

async function refreshJobsStatusSnapshot(jobName: string): Promise<void> {
  try {
    const { materializeJobsStatusSnapshot } = await import("@/lib/dashboard/jobs-status");
    await materializeJobsStatusSnapshot();
  } catch (err) {
    console.error("[job-queue] status snapshot refresh failed", { jobName, error: errorMessage(err) });
  }
}

async function runWithHeartbeat(run: QueueRun, heartbeatMs: number): Promise<JobResult<unknown>> {
  const timer = setInterval(() => {
    heartbeat(run).catch((err) => console.error("[job-queue] heartbeat failed", err));
  }, heartbeatMs);
  try {
    return await dispatchQueuedRun(run);
  } finally {
    clearInterval(timer);
    await heartbeat(run).catch(() => undefined);
  }
}

export async function drainQueuedJobs(options: DrainOptions = {}): Promise<{
  checkedAt: string;
  recovered: { failed: number; requeued: number };
  drained: DrainRunResult[];
}> {
  const limit = Math.max(1, options.limit ?? Number(process.env.JOB_QUEUE_DRAIN_LIMIT ?? 1));
  const staleAfterMinutes = options.staleAfterMinutes ?? DEFAULT_STALE_MINUTES;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const recovered = await recoverStaleQueuedRuns(staleAfterMinutes);
  const drained: DrainRunResult[] = [];

  for (let i = 0; i < limit; i++) {
    const claimed = await claimNextQueuedRun();
    if (!claimed) break;

    try {
      const result = await runWithHeartbeat(claimed, heartbeatMs);
      await finishQueueOwnership(claimed, result);
      await refreshJobsStatusSnapshot(result.jobName);
      drained.push({
        runId: result.runId,
        jobName: result.jobName,
        status: result.status,
        errors: result.errors,
      });
    } catch (err) {
      const failed = await failClaimedRun(claimed, err);
      await refreshJobsStatusSnapshot(failed.jobName);
      drained.push(failed);
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    recovered,
    drained,
  };
}
