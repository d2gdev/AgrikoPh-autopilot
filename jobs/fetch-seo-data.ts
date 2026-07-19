import { prisma } from "@/lib/db";
import type { JobResult, JobStatus } from "@/lib/jobs/types";
import { buildGscReportingWindows } from "@/lib/seo/gsc-window";
import { toPageAnalyticsInput } from "@/lib/seo/page-analytics";

type FetchSeoSummary = { snapshotsFetched: number };

export async function fetchSeoDataHandler(): Promise<JobResult<FetchSeoSummary>> {
  const runId = (
    await prisma.jobRun.create({ data: { jobName: "fetch-seo-data" } })
  ).id;

  let status: JobStatus = "failed";
  let succeeded = 0;
  let errors: string[] = [];

  try {
    // Search Analytics dates are inclusive. Build two adjacent 28-calendar-day
    // windows at UTC midnight so the current start is not reused as the prior
    // end and arbitrary capture-time hours cannot affect snapshot identity.
    const { current, previous } = buildGscReportingWindows({
      capturedAt: new Date(),
      lagDays: Number(process.env.GSC_LAG_DAYS ?? 3),
      windowDays: 28,
    });

    // One persistence task per (source, window). Each stores its own snapshot
    // with the correct dateRangeStart/dateRangeEnd. The
    // @@unique([source, dateRangeStart, dateRangeEnd]) constraint makes
    // same-window re-runs idempotent via upsert.
    const windows: { start: Date; end: Date }[] = [
      current,
      previous,
    ];

    async function saveSnapshot(source: string, start: Date, end: Date, payload: unknown) {
      await prisma.rawSnapshot.upsert({
        where: { source_dateRangeStart_dateRangeEnd: { source, dateRangeStart: start, dateRangeEnd: end } },
        create: { source, dateRangeStart: start, dateRangeEnd: end, payload: payload as object, jobRunId: runId },
        update: { payload: payload as object, jobRunId: runId, fetchedAt: new Date() },
      });
    }

    async function savePageAnalytics(start: Date, end: Date, payload: unknown) {
      const topPages = ((payload as Record<string, unknown>)?.topPages ?? []) as Array<{
        page: string;
        sessions: number;
        totalUsers?: number;
        conversions?: number;
        bounceRate?: string;
        conversionRate?: string;
      }>;
      const rows = topPages
        .map(toPageAnalyticsInput)
        .filter((row): row is NonNullable<typeof row> => row !== null);

      await prisma.$transaction([
        prisma.pageAnalytics.deleteMany({
          where: { dateRangeStart: start, dateRangeEnd: end },
        }),
        prisma.pageAnalytics.createMany({
          data: rows.map((row) => ({
            jobRunId: runId,
            page: row.page,
            sessions: row.sessions,
            totalUsers: row.totalUsers,
            conversions: row.conversions,
            bounceRate: row.bounceRate,
            conversionRate: row.conversionRate,
            dateRangeStart: start,
            dateRangeEnd: end,
            rawPayload: row.rawPayload,
          })),
        }),
      ]);
    }

    const tasks: { label: string; run: () => Promise<void> }[] = [];
    for (const { start, end } of windows) {
      tasks.push({
        label: `gsc[${start.toISOString().slice(0, 10)}]`,
        run: async () => {
          const { fetchGscData } = await import("@/lib/connectors/gsc");
          await saveSnapshot("gsc", start, end, await fetchGscData({ start, end }));
        },
      });
      tasks.push({
        label: `ga4[${start.toISOString().slice(0, 10)}]`,
        run: async () => {
          const { fetchGa4Data } = await import("@/lib/connectors/ga4");
          const payload = await fetchGa4Data({ start, end });
          await saveSnapshot("ga4", start, end, payload);
          await savePageAnalytics(start, end, payload);
        },
      });
      tasks.push({
        label: `gsc_pages[${start.toISOString().slice(0, 10)}]`,
        run: async () => {
          const { fetchGscPageData } = await import("@/lib/connectors/gsc");
          await saveSnapshot("gsc_pages", start, end, await fetchGscPageData({ start, end }));
        },
      });
      tasks.push({
        label: `gsc_query_page[${start.toISOString().slice(0, 10)}]`,
        run: async () => {
          const { fetchGscQueryPageData } = await import("@/lib/connectors/gsc");
          const gsc = await fetchGscQueryPageData({ start, end });
          await saveSnapshot("gsc_query_page", start, end, gsc);
          // Keep the DataForSEO search-volume cache warm on the daily path too
          // (non-fatal; bounded + 30-day cached — see search-volume-cache).
          try {
            const { fillSearchVolumeFromGscRows } = await import("@/lib/seo/search-volume-cache");
            const pairs = ((gsc as { pairs?: unknown }).pairs as Array<{ query?: unknown; impressions?: unknown }>) ?? [];
            await fillSearchVolumeFromGscRows(pairs);
          } catch {
            /* volume cache is best-effort; never fail the SEO fetch over it */
          }
        },
      });
    }

    // M-10: derive total from results array — no manual constant to keep in sync
    const results = await Promise.allSettled(tasks.map((t) => t.run()));
    const total = results.length;
    succeeded = results.filter(r => r.status === "fulfilled").length;
    errors = results
      .map((r, i) => r.status === "rejected" ? `${tasks[i]?.label ?? `task#${i}`}: ${String((r as PromiseRejectedResult).reason)}` : null)
      .filter((e): e is string => e !== null);

    status = succeeded === total ? "success" : succeeded > 0 ? "partial" : "failed";
  } finally {
    const summary: FetchSeoSummary = { snapshotsFetched: succeeded };
    await prisma.jobRun.update({
      where: { id: runId },
      data: {
        completedAt: new Date(),
        status,
        summary,
        errorLog: errors.length > 0 ? errors.join("\n").slice(0, 10_000) : null,
      },
    });
    return { jobName: "fetch-seo-data", runId, status, summary, errors };
  }
}
