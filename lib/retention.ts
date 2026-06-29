import { prisma } from "@/lib/db";

export type RetentionCleanupSummary = {
  rawSnapshotRetentionDays: number;
  jobRunRetentionDays: number;
  rawSnapshotCutoff: string;
  jobRunCutoff: string;
  snapshotsDeleted: number;
  snapshotsRetainedWithRecommendations: number;
  jobRunsDeleted: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RAW_SNAPSHOT_RETENTION_DAYS = 30;
const DEFAULT_JOB_RUN_RETENTION_DAYS = 90;
const TERMINAL_JOB_STATUSES = ["success", "failed", "partial", "skipped"] as const;

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getRetentionConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    rawSnapshotRetentionDays: positiveInteger(
      env.RAW_SNAPSHOT_RETENTION_DAYS,
      DEFAULT_RAW_SNAPSHOT_RETENTION_DAYS,
    ),
    jobRunRetentionDays: positiveInteger(
      env.JOB_RUN_RETENTION_DAYS,
      DEFAULT_JOB_RUN_RETENTION_DAYS,
    ),
  };
}

export async function cleanupDashboardRetention(now = new Date()): Promise<RetentionCleanupSummary> {
  const { rawSnapshotRetentionDays, jobRunRetentionDays } = getRetentionConfig();
  const rawSnapshotCutoff = new Date(now.getTime() - rawSnapshotRetentionDays * DAY_MS);
  const jobRunCutoff = new Date(now.getTime() - jobRunRetentionDays * DAY_MS);

  const [snapshotsRetainedWithRecommendations, snapshots, jobRuns] = await Promise.all([
    prisma.rawSnapshot.count({
      where: {
        fetchedAt: { lt: rawSnapshotCutoff },
        source: { not: "seo_history" },
        recommendations: { some: {} },
      },
    }),
    prisma.rawSnapshot.deleteMany({
      where: {
        fetchedAt: { lt: rawSnapshotCutoff },
        source: { not: "seo_history" },
        recommendations: { none: {} },
      },
    }),
    prisma.jobRun.deleteMany({
      where: {
        startedAt: { lt: jobRunCutoff },
        status: { in: [...TERMINAL_JOB_STATUSES] },
      },
    }),
  ]);

  return {
    rawSnapshotRetentionDays,
    jobRunRetentionDays,
    rawSnapshotCutoff: rawSnapshotCutoff.toISOString(),
    jobRunCutoff: jobRunCutoff.toISOString(),
    snapshotsDeleted: snapshots.count,
    snapshotsRetainedWithRecommendations,
    jobRunsDeleted: jobRuns.count,
  };
}
