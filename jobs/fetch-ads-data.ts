import { prisma } from "@/lib/db";
import type { JobResult, JobStatus } from "@/lib/jobs/types";

type FetchAdsSummary = {
  snapshotsFetched: number;
  truncationWarnings: string[];
};

export async function fetchAdsDataHandler(): Promise<JobResult<FetchAdsSummary>> {
  const runId = (
    await prisma.jobRun.create({ data: { jobName: "fetch-ads-data" } })
  ).id;

  const errors: string[] = [];
  let snapshotsFetched = 0;
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Meta
  let metaTruncationWarnings: string[] | undefined;
  try {
    const { fetchMetaData } = await import("@/lib/connectors/meta");
    const metaData = await fetchMetaData({ start, end });
    metaTruncationWarnings = (metaData as Record<string, unknown>).truncationWarnings as string[] | undefined;
    if (metaTruncationWarnings?.length) {
      console.warn("[fetch-ads-data] Meta truncation:", metaTruncationWarnings.join("; "));
    }
    await prisma.rawSnapshot.create({
      data: { source: "meta", dateRangeStart: start, dateRangeEnd: end, payload: metaData as object, jobRunId: runId },
    });
    snapshotsFetched++;
  } catch (err) {
    errors.push(`meta: ${String(err)}`);
  }

  const status: JobStatus = errors.length === 0 ? "success" : snapshotsFetched > 0 ? "partial" : "failed";
  const summary: FetchAdsSummary = {
    snapshotsFetched,
    truncationWarnings: metaTruncationWarnings ?? [],
  };

  await prisma.jobRun.update({
    where: { id: runId },
    data: {
      completedAt: new Date(),
      status,
      summary,
      errorLog: errors.length > 0 ? errors.join("\n").slice(0, 10_000) : null,
    },
  });

  return { jobName: "fetch-ads-data", runId, status, summary, errors };
}
