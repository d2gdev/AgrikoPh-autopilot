import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  jobRun: {
    create: vi.fn(),
    update: vi.fn(),
  },
  rawSnapshot: {
    upsert: vi.fn(),
  },
  pageAnalytics: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  gscQuery: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const mockLocks = vi.hoisted(() => ({
  acquireJobLock: vi.fn(),
  releaseJobLock: vi.fn(),
}));

const mockDashboardHandlers = vi.hoisted(() => ({
  fetchAdsDataHandler: vi.fn(),
  fetchSeoDataHandler: vi.fn(),
  fetchBlogContentHandler: vi.fn(),
  runFetchBlogContentLocked: vi.fn(),
  fetchGscDataHandler: vi.fn(),
  fetchMarketIntelHandler: vi.fn(),
  fetchKeywordResearchHandler: vi.fn(),
  runSkillsHandler: vi.fn(),
  snapshotSeoHistoryHandler: vi.fn(),
  materializeJobsStatusSnapshot: vi.fn(),
}));

const mockSeoConnectors = vi.hoisted(() => ({
  fetchGscData: vi.fn(),
  fetchGscPageData: vi.fn(),
  fetchGscQueryPageData: vi.fn(),
  fetchGa4Data: vi.fn(),
}));

const mockSnapshotSources = vi.hoisted(() => ({
  getLatestSnapshot: vi.fn(),
  getQueries: vi.fn(),
  computeSnapshotTotals: vi.fn(),
  getLatestGscData: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/job-lock", () => mockLocks);
vi.mock("@/jobs/fetch-ads-data", () => ({ fetchAdsDataHandler: mockDashboardHandlers.fetchAdsDataHandler }));
vi.mock("@/jobs/fetch-seo-data", async (importOriginal) => {
  if (process.env.TEST_REAL_FETCH_SEO_DATA === "1") return await importOriginal<typeof import("@/jobs/fetch-seo-data")>();
  return { fetchSeoDataHandler: mockDashboardHandlers.fetchSeoDataHandler };
});
vi.mock("@/jobs/fetch-blog-content", () => ({
  fetchBlogContentHandler: mockDashboardHandlers.fetchBlogContentHandler,
  runFetchBlogContentLocked: mockDashboardHandlers.runFetchBlogContentLocked,
}));
vi.mock("@/jobs/fetch-gsc-data", () => ({ fetchGscDataHandler: mockDashboardHandlers.fetchGscDataHandler }));
vi.mock("@/jobs/fetch-market-intel", () => ({ fetchMarketIntelHandler: mockDashboardHandlers.fetchMarketIntelHandler }));
vi.mock("@/jobs/fetch-keyword-research", () => ({ fetchKeywordResearchHandler: mockDashboardHandlers.fetchKeywordResearchHandler }));
vi.mock("@/jobs/run-skills", () => ({ runSkillsHandler: mockDashboardHandlers.runSkillsHandler }));
vi.mock("@/jobs/snapshot-seo-history", async (importOriginal) => {
  if (process.env.TEST_REAL_SNAPSHOT_SEO_HISTORY === "1") return await importOriginal<typeof import("@/jobs/snapshot-seo-history")>();
  return { snapshotSeoHistoryHandler: mockDashboardHandlers.snapshotSeoHistoryHandler };
});
vi.mock("@/lib/dashboard/jobs-status", () => ({
  materializeJobsStatusSnapshot: mockDashboardHandlers.materializeJobsStatusSnapshot,
}));
vi.mock("@/lib/connectors/gsc", () => ({
  fetchGscData: mockSeoConnectors.fetchGscData,
  fetchGscPageData: mockSeoConnectors.fetchGscPageData,
  fetchGscQueryPageData: mockSeoConnectors.fetchGscQueryPageData,
}));
vi.mock("@/lib/connectors/ga4", () => ({ fetchGa4Data: mockSeoConnectors.fetchGa4Data }));
vi.mock("@/lib/seo/snapshot", () => ({
  getLatestSnapshot: mockSnapshotSources.getLatestSnapshot,
  getQueries: mockSnapshotSources.getQueries,
}));
vi.mock("@/lib/seo/history", () => ({ computeSnapshotTotals: mockSnapshotSources.computeSnapshotTotals }));
vi.mock("@/lib/seo/data", () => ({ getLatestGscData: mockSnapshotSources.getLatestGscData }));

const successStep = (jobName: string) => ({ jobName, runId: `${jobName}-run`, status: "success" as const, summary: {}, errors: [] });

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete process.env.GSC_LAG_DAYS;
  mockPrisma.jobRun.create.mockResolvedValue({ id: "job-run" });
  mockPrisma.jobRun.update.mockResolvedValue({});
  mockPrisma.rawSnapshot.upsert.mockResolvedValue({});
  mockPrisma.$transaction.mockImplementation(async (ops) => Array.isArray(ops) ? ops : ops(mockPrisma));
  mockLocks.acquireJobLock.mockResolvedValue(true);
  mockLocks.releaseJobLock.mockResolvedValue(undefined);
  mockDashboardHandlers.fetchAdsDataHandler.mockResolvedValue(successStep("fetch-ads-data"));
  mockDashboardHandlers.fetchSeoDataHandler.mockResolvedValue(successStep("fetch-seo-data"));
  mockDashboardHandlers.fetchBlogContentHandler.mockResolvedValue({
    jobName: "fetch-blog-content",
    runId: "fetch-blog-content-run",
    status: "success",
    indexed: 1,
    skipped: 0,
    snapshotsCreated: 1,
    errors: [],
  });
  mockDashboardHandlers.runFetchBlogContentLocked.mockImplementation(async () => ({
    acquired: true,
    result: await mockDashboardHandlers.fetchBlogContentHandler(),
  }));
  mockDashboardHandlers.fetchGscDataHandler.mockResolvedValue(successStep("fetch-gsc-data"));
  mockDashboardHandlers.fetchMarketIntelHandler.mockResolvedValue(successStep("fetch-market-intel"));
  mockDashboardHandlers.fetchKeywordResearchHandler.mockResolvedValue(successStep("fetch-keyword-research"));
  mockDashboardHandlers.runSkillsHandler.mockResolvedValue({ ...successStep("run-skills"), newRecs: 0 });
  mockDashboardHandlers.snapshotSeoHistoryHandler.mockResolvedValue({ ok: true });
  mockDashboardHandlers.materializeJobsStatusSnapshot.mockResolvedValue(undefined);
  mockSeoConnectors.fetchGscData.mockResolvedValue({ queries: [] });
  mockSeoConnectors.fetchGscPageData.mockResolvedValue({ pages: [] });
  mockSeoConnectors.fetchGscQueryPageData.mockResolvedValue({ pairs: [] });
  mockSeoConnectors.fetchGa4Data.mockResolvedValue({ topPages: [] });
  mockSnapshotSources.getLatestGscData.mockResolvedValue({ queries: [], pages: [], queryPagePairs: [] });
  mockSnapshotSources.getLatestSnapshot.mockResolvedValue({ payload: {} });
  mockSnapshotSources.getQueries.mockReturnValue([{ query: "black rice", clicks: 1, impressions: 10 }]);
  mockSnapshotSources.computeSnapshotTotals.mockReturnValue({ clicks: 1, impressions: 10 });
});

describe("SEO refresh job regressions", () => {
  it("records skipped history snapshots as skipped, not success", async () => {
    mockDashboardHandlers.snapshotSeoHistoryHandler.mockResolvedValue({ skipped: true, reason: "no gsc snapshot yet" });
    const { runDashboardRefreshHandler } = await import("@/jobs/run-dashboard-refresh");

    const result = await runDashboardRefreshHandler("dashboard-run", { releaseDashboardLock: false });

    expect(result.summary.jobs["snapshot-seo-history"]).toEqual(expect.objectContaining({ status: "skipped" }));
    expect(result.summary.skippedJobs).toContain("snapshot-seo-history");
    expect(result.errors).toContain("snapshot-seo-history: no gsc snapshot yet");
  });

  it("uses the configured GSC lag for raw SEO snapshot windows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00Z"));
    process.env.GSC_LAG_DAYS = "3";
    const { fetchSeoDataHandler } = await vi.importActual<typeof import("@/jobs/fetch-seo-data")>("@/jobs/fetch-seo-data");

    try {
      await fetchSeoDataHandler();
    } finally {
      vi.useRealTimers();
    }

    const firstGscCall = mockSeoConnectors.fetchGscData.mock.calls[0]?.[0];
    expect(firstGscCall).toBeDefined();
    expect(firstGscCall!.end.toISOString()).toBe("2026-06-28T12:00:00.000Z");
    expect(firstGscCall!.start.toISOString()).toBe("2026-05-31T12:00:00.000Z");
  });

  it("falls back to raw GSC queries without mutating normalized GSC data", async () => {
    const latest = { queries: [], pages: [], queryPagePairs: [] };
    mockSnapshotSources.getLatestGscData.mockResolvedValue(latest);
    const { snapshotSeoHistoryHandler } = await vi.importActual<typeof import("@/jobs/snapshot-seo-history")>("@/jobs/snapshot-seo-history");

    await snapshotSeoHistoryHandler();

    expect(latest.queries).toEqual([]);
    expect(mockSnapshotSources.computeSnapshotTotals).toHaveBeenCalledWith([{ query: "black rice", clicks: 1, impressions: 10 }]);
  });
});
