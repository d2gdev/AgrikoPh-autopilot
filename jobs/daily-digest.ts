import { prisma } from "@/lib/db";
import { sendOperatorAlert } from "@/lib/alerts";
import type { JobResult } from "@/lib/jobs/types";

type DailyDigestSummary = {
  pendingRecommendations: number;
  pendingOver7Days: number;
  executedYesterday: number;
  failedExecutionsYesterday: number;
  outcomesCheckedYesterday: Record<string, number>;
  failedJobsYesterday: number;
  contentPublishedYesterday: number;
  approvalsAwaitingReview: number;
};

// "Yesterday" is the trailing 24h window — timezone-proof and matches how the
// operator reads a morning digest.
export async function dailyDigestHandler(): Promise<JobResult<DailyDigestSummary>> {
  const jobRun = await prisma.jobRun.create({
    data: { jobName: "daily-digest", triggeredBy: "scheduler", status: "running" },
  });
  const errors: string[] = [];

  try {
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 3_600_000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3_600_000);

    const [
      pendingRecommendations,
      pendingOver7Days,
      executedYesterday,
      failedExecutionsYesterday,
      failedJobsYesterday,
      contentPublishedYesterday,
      approvalsAwaitingReview,
      outcomeRows,
    ] = await Promise.all([
      prisma.recommendation.count({ where: { status: "pending" } }),
      prisma.recommendation.count({ where: { status: "pending", createdAt: { lt: sevenDaysAgo } } }),
      prisma.recommendation.count({ where: { status: "executed", executedAt: { gte: since } } }),
      prisma.auditLog.count({ where: { action: "execution_failed", createdAt: { gte: since } } }),
      prisma.jobRun.count({ where: { status: "failed", startedAt: { gte: since } } }),
      prisma.contentProposal.count({ where: { publishedAt: { gte: since } } }),
      prisma.adApproval.count({
        where: { status: { notIn: ["draft", "approved_to_make_kwarta", "rejected", "cancelled"] } },
      }),
      prisma.recommendation.findMany({
        where: { outcomeCheckedAt: { gte: since } },
        select: { outcome: true },
      }),
    ]);

    const outcomesCheckedYesterday: Record<string, number> = {};
    for (const row of outcomeRows) {
      const verdict = (row.outcome as { verdict?: string } | null)?.verdict ?? "unknown";
      outcomesCheckedYesterday[verdict] = (outcomesCheckedYesterday[verdict] ?? 0) + 1;
    }

    const summary: DailyDigestSummary = {
      pendingRecommendations,
      pendingOver7Days,
      executedYesterday,
      failedExecutionsYesterday,
      outcomesCheckedYesterday,
      failedJobsYesterday,
      contentPublishedYesterday,
      approvalsAwaitingReview,
    };

    await sendOperatorAlert("daily_digest", { ...summary });

    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: { status: "success", completedAt: new Date(), summary },
    });
    return { jobName: "daily-digest", runId: jobRun.id, status: "success", summary, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: { status: "failed", completedAt: new Date(), errorLog: errors.join("\n") },
    }).catch(() => {});
    return {
      jobName: "daily-digest",
      runId: jobRun.id,
      status: "failed",
      summary: {
        pendingRecommendations: 0,
        pendingOver7Days: 0,
        executedYesterday: 0,
        failedExecutionsYesterday: 0,
        outcomesCheckedYesterday: {},
        failedJobsYesterday: 0,
        contentPublishedYesterday: 0,
        approvalsAwaitingReview: 0,
      },
      errors,
    };
  }
}
