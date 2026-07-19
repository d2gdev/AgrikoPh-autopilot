import { prisma } from "@/lib/db";
import { getLatestGscData } from "@/lib/seo/data";

const JOB_NAME = "snapshot-seo-history";

/**
 * Persists ONE durable SEO trend point per UTC day from the latest "gsc"
 * snapshot. Stored as a RawSnapshot with source "seo_history" (payload =
 * dimensionless property aggregate), keyed by the UTC day via the
 * @@unique([source, dateRangeStart, dateRangeEnd]) constraint so same-day
 * re-runs are idempotent.
 *
 * Why a dedicated record: the `daily` cron prunes RawSnapshot rows older than
 * 30 days, so raw "gsc" snapshots can't back a long-term trend. These
 * "seo_history" rows are exempted from that cleanup and accrue over months.
 */
export async function snapshotSeoHistoryHandler() {
  const runId = (
    await prisma.jobRun.create({ data: { jobName: JOB_NAME } })
  ).id;

  let status = "failed";
  let error: string | null = null;

  try {
    const latest = await getLatestGscData();
    if (!latest.propertyTotals) {
      status = "skipped";
      return {
        skipped: true,
        reason: "no dimensionless GSC property aggregate yet",
      };
    }
    const totals = latest.propertyTotals;

    // Key on the UTC day so there is exactly one point per day.
    const now = new Date();
    const day = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    await prisma.rawSnapshot.upsert({
      where: {
        source_dateRangeStart_dateRangeEnd: {
          source: "seo_history",
          dateRangeStart: day,
          dateRangeEnd: day,
        },
      },
      create: {
        source: "seo_history",
        dateRangeStart: day,
        dateRangeEnd: day,
        payload: totals as object,
        jobRunId: runId,
      },
      update: { payload: totals as object, jobRunId: runId, fetchedAt: new Date() },
    });

    status = "success";
    return { ok: true, point: totals };
  } catch (err) {
    error = String(err);
    throw err;
  } finally {
    await prisma.jobRun.update({
      where: { id: runId },
      data: {
        completedAt: new Date(),
        status,
        errorLog: error ? error.slice(0, 10_000) : null,
      },
    });
  }
}
