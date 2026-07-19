import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fetchGscData, fetchGscQueryPageData } from "@/lib/connectors/gsc";
import { fillSearchVolumeFromGscRows } from "@/lib/seo/search-volume-cache";
import { buildGscReportingWindows } from "@/lib/seo/gsc-window";
import type { JobResult, JobStatus } from "@/lib/jobs/types";

type FetchGscSummary = {
  rowsStored: number;
  clicksTotal: number;
  impressionsTotal: number;
  dateRangeStart: string;
  dateRangeEnd: string;
  disabledSources: string[];
  searchVolumeFilled?: number;
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function asInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function asFloat(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Stores a Google Search Console search-analytics snapshot (query+page) so that
// Agriko's own ranking data becomes a persistent, historical data-layer stream.
// The trailing window (default 28d, ending ~3d ago for GSC's reporting lag) is
// captured each run; weekly snapshots build position/CTR history.
export async function fetchGscDataHandler(): Promise<JobResult<FetchGscSummary>> {
  const run = await prisma.jobRun.create({ data: { jobName: "fetch-gsc-data" } });
  const capturedAt = new Date();
  const { current: { start, end } } = buildGscReportingWindows({
    capturedAt,
    windowDays: Number(process.env.GSC_WINDOW_DAYS ?? 28),
    lagDays: Number(process.env.GSC_LAG_DAYS ?? 3),
  });

  const summary: FetchGscSummary = {
    rowsStored: 0,
    clicksTotal: 0,
    impressionsTotal: 0,
    dateRangeStart: start.toISOString().slice(0, 10),
    dateRangeEnd: end.toISOString().slice(0, 10),
    disabledSources: [],
  };
  let status: JobStatus = "failed";
  const errors: string[] = [];

  try {
    const [queryData, queryPageData] = await Promise.all([
      fetchGscData({ start, end }),
      fetchGscQueryPageData({ start, end }),
    ]);
    const pairs = (queryPageData.pairs as Array<Record<string, unknown>>) ?? [];
    const propertyTotals = queryData.propertyTotals as
      | { clicks?: unknown; impressions?: unknown }
      | null
      | undefined;
    if (propertyTotals) {
      summary.clicksTotal = asInt(propertyTotals.clicks);
      summary.impressionsTotal = asInt(propertyTotals.impressions);
    }
    const rows = [];

    for (const pair of pairs) {
      const query = typeof pair.query === "string" ? pair.query : "";
      const page = typeof pair.page === "string" ? pair.page : "";
      if (!query && !page) continue;
      const clicks = asInt(pair.clicks);
      const impressions = asInt(pair.impressions);
      rows.push({
        jobRunId: run.id,
        query,
        page,
        clicks,
        impressions,
        position: asFloat(pair.position),
        ctr: impressions > 0 ? clicks / impressions : null,
        dateRangeStart: start,
        dateRangeEnd: end,
        capturedAt,
      });
      summary.rowsStored++;
    }

    await prisma.rawSnapshot.upsert({
      where: {
        source_dateRangeStart_dateRangeEnd: {
          source: "gsc",
          dateRangeStart: start,
          dateRangeEnd: end,
        },
      },
      create: {
        source: "gsc",
        dateRangeStart: start,
        dateRangeEnd: end,
        payload: json(queryData),
        jobRunId: run.id,
      },
      update: {
        payload: json(queryData),
        jobRunId: run.id,
        fetchedAt: capturedAt,
      },
    });

    if (rows.length > 0) {
      await prisma.$transaction([
        prisma.gscQuery.deleteMany({
          where: { dateRangeStart: start, dateRangeEnd: end },
        }),
        prisma.gscQuery.createMany({ data: rows, skipDuplicates: true }),
      ]);
    }

    // Fill the DataForSEO search-volume cache for the top queries (by
    // impressions) that feed the SEO "Traffic" column — one bounded, cached
    // bulk call. Non-fatal: a volume-fetch failure must not fail the GSC job.
    try {
      summary.searchVolumeFilled = await fillSearchVolumeFromGscRows(rows, capturedAt);
    } catch (err) {
      errors.push(`search-volume: ${String(err).slice(0, 200)}`);
    }

    status = summary.rowsStored > 0 || propertyTotals ? "success" : "partial";
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        completedAt: new Date(),
        status,
        summary: json(summary),
        errorLog: summary.rowsStored === 0 && !propertyTotals ? "GSC returned no rows for the window." : null,
      },
    });
    if (summary.rowsStored === 0 && !propertyTotals) errors.push("GSC returned no rows for the window.");
  } catch (err) {
    const message = String(err).slice(0, 500);
    summary.disabledSources.push("gsc");
    errors.push(message);
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        completedAt: new Date(),
        status: "failed",
        summary: json(summary),
        errorLog: message,
      },
    });
  }

  return { jobName: "fetch-gsc-data", runId: run.id, status, summary, errors };
}
