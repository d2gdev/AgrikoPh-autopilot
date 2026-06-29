export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requirePrivateApiKeyAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDatabaseUrlDiagnostics } from "@/lib/db-url";

const DB_LATENCY_WARN_MS = Number(process.env.HEALTH_DB_LATENCY_WARN_MS ?? 500);
const STALE_RUNNING_JOB_MINUTES = Number(process.env.HEALTH_STALE_RUNNING_JOB_MINUTES ?? 30);

function ageSeconds(date: Date | null | undefined, now = Date.now()) {
  if (!date) return null;
  return Math.max(0, Math.round((now - date.getTime()) / 1000));
}

function freshnessPoint(date: Date | null | undefined, now = Date.now()) {
  return {
    latestAt: date?.toISOString() ?? null,
    ageSeconds: ageSeconds(date, now),
  };
}

export async function GET(request: Request) {
  const checkedAt = new Date();
  const nowMs = checkedAt.getTime();
  const staleRunningBefore = new Date(nowMs - STALE_RUNNING_JOB_MINUTES * 60 * 1000);
  const wantsDetails = new URL(request.url).searchParams.get("details") === "1";
  const detailsAuth = wantsDetails ? requirePrivateApiKeyAuth(request) : null;
  const includeDetails = wantsDetails && !detailsAuth;
  const dbUrl = getDatabaseUrlDiagnostics();

  try {
    const pingStartedAt = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - pingStartedAt;

    const [
      runningJobs,
      queuedJobs,
      staleRunningJobs,
      activeLocks,
      expiredLocks,
      oldestLock,
      latestRun,
      latestSuccess,
      latestMetaSnapshot,
      latestGscSnapshot,
      latestPageAnalytics,
      latestArticle,
      latestMarketInsight,
    ] = await Promise.all([
      prisma.jobRun.count({ where: { status: "running" } }),
      prisma.jobRun.count({ where: { status: "queued" } }),
      prisma.jobRun.count({
        where: {
          status: "running",
          startedAt: { lt: staleRunningBefore },
        },
      }),
      prisma.jobLock.count(),
      prisma.jobLock.count({ where: { expiresAt: { lt: checkedAt } } }),
      prisma.jobLock.findFirst({ orderBy: { lockedAt: "asc" }, select: { jobName: true, lockedAt: true, expiresAt: true } }),
      prisma.jobRun.findFirst({
        orderBy: { startedAt: "desc" },
        select: { jobName: true, status: true, startedAt: true, completedAt: true },
      }),
      prisma.jobRun.findFirst({
        where: { status: { in: ["success", "partial"] }, completedAt: { not: null } },
        orderBy: { completedAt: "desc" },
        select: { jobName: true, status: true, startedAt: true, completedAt: true },
      }),
      prisma.rawSnapshot.findFirst({
        where: { source: "meta" },
        orderBy: { fetchedAt: "desc" },
        select: { fetchedAt: true },
      }),
      prisma.rawSnapshot.findFirst({
        where: { source: "gsc" },
        orderBy: { fetchedAt: "desc" },
        select: { fetchedAt: true },
      }),
      prisma.pageAnalytics.findFirst({
        orderBy: { capturedAt: "desc" },
        select: { capturedAt: true },
      }),
      prisma.articleRecord.findFirst({
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
      prisma.marketInsight.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);

    const degradedReasons = [
      ...dbUrl.errors.map((error) => `db_url:${error}`),
      ...(dbLatencyMs > DB_LATENCY_WARN_MS ? [`db_latency:${dbLatencyMs}ms`] : []),
      ...(staleRunningJobs > 0 ? [`stale_running_jobs:${staleRunningJobs}`] : []),
      ...(expiredLocks > 0 ? [`expired_locks:${expiredLocks}`] : []),
    ];

    const status = degradedReasons.length > 0 ? "degraded" : "ok";

    const publicBody = {
      status,
      timestamp: checkedAt.toISOString(),
      degradedReasons,
    };

    if (!includeDetails) return NextResponse.json(publicBody, { status: 200 });

    return NextResponse.json({
      ...publicBody,
      db: {
        status: "ok",
        latencyMs: dbLatencyMs,
        latencyWarningMs: DB_LATENCY_WARN_MS,
        url: dbUrl,
      },
      jobs: {
        queued: queuedJobs,
        running: runningJobs,
        staleRunning: staleRunningJobs,
        staleRunningThresholdMinutes: STALE_RUNNING_JOB_MINUTES,
        latestRun,
        latestSuccess,
      },
      locks: {
        active: activeLocks,
        expired: expiredLocks,
        oldest: oldestLock
          ? {
              ...oldestLock,
              ageSeconds: ageSeconds(oldestLock.lockedAt, nowMs),
            }
          : null,
      },
      freshness: {
        metaRawSnapshot: freshnessPoint(latestMetaSnapshot?.fetchedAt, nowMs),
        gscRawSnapshot: freshnessPoint(latestGscSnapshot?.fetchedAt, nowMs),
        pageAnalytics: freshnessPoint(latestPageAnalytics?.capturedAt, nowMs),
        articleRecord: freshnessPoint(latestArticle?.updatedAt, nowMs),
        marketInsight: freshnessPoint(latestMarketInsight?.createdAt, nowMs),
      },
    });
  } catch (err) {
    console.error("[health] DB ping failed:", err);
    const publicBody = {
      status: "degraded",
      timestamp: checkedAt.toISOString(),
      degradedReasons: ["db_unreachable"],
    };
    if (!includeDetails) return NextResponse.json(publicBody, { status: 503 });
    return NextResponse.json({ ...publicBody, db: { status: "error", url: dbUrl } }, { status: 503 });
  }
}
