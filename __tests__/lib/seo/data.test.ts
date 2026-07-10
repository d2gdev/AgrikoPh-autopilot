import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSnapshots = vi.hoisted(() => ({
  getComparisonSnapshot: vi.fn(),
  getLatestSnapshot: vi.fn(),
  getPages: vi.fn(),
  getQueries: vi.fn(),
  getSnapshotHistory: vi.fn(),
}));

const mockNormalized = vi.hoisted(() => ({
  getGscPagesForWindow: vi.fn(),
  getGscQueriesForWindow: vi.fn(),
  getGscQueryPagePairsForWindow: vi.fn(),
  getLatestGscWindow: vi.fn(),
  getPreviousGscWindow: vi.fn(),
}));

const mockDb = vi.hoisted(() => ({
  pageAnalytics: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: mockDb,
}));

vi.mock("@/lib/seo/snapshot", () => mockSnapshots);
vi.mock("@/lib/seo/gsc-normalized", () => mockNormalized);
vi.mock("@/lib/seo/history", () => ({ computeSnapshotTrend: vi.fn(() => []) }));

const { getLatestGa4Data, getLatestGscData, getPreviousGscData } = await import("@/lib/seo/data");

function rawSnapshot(source: string, fetchedAt: string, start: string, end: string, payload: object) {
  return {
    id: `${source}-${fetchedAt}`,
    source,
    fetchedAt: new Date(fetchedAt),
    dateRangeStart: new Date(start),
    dateRangeEnd: new Date(end),
    payload,
  };
}

describe("getLatestGscData freshness selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSnapshots.getLatestSnapshot.mockResolvedValue(null);
    mockSnapshots.getQueries.mockReturnValue([]);
    mockNormalized.getLatestGscWindow.mockResolvedValue(null);
    mockNormalized.getGscQueriesForWindow.mockResolvedValue([]);
    mockNormalized.getGscPagesForWindow.mockResolvedValue([]);
    mockNormalized.getGscQueryPagePairsForWindow.mockResolvedValue([]);
  });

  it("keeps normalized GSC data when raw snapshot is not materially newer", async () => {
    const window = {
      dateRangeStart: new Date("2026-06-08T00:00:00.000Z"),
      dateRangeEnd: new Date("2026-07-06T00:00:00.000Z"),
      capturedAt: new Date("2026-07-09T04:00:00.000Z"),
    };
    mockNormalized.getLatestGscWindow.mockResolvedValue(window);
    mockNormalized.getGscQueriesForWindow.mockResolvedValue([
      { query: "black rice", clicks: 3, impressions: 100, ctr: "3.0%", position: "7.2" },
    ]);
    mockSnapshots.getLatestSnapshot.mockImplementation(async (source: string) => {
      if (source === "gsc") {
        return rawSnapshot(
          "gsc",
          "2026-07-09T04:30:00.000Z",
          "2026-06-08T00:00:00.000Z",
          "2026-07-06T00:00:00.000Z",
          {
            topQueries: [{ query: "raw query", clicks: 1, impressions: 10, ctr: "10.0%", position: "3.0" }],
          },
        );
      }
      return null;
    });

    const result = await getLatestGscData();

    expect(result.source).toBe("normalized");
    expect(result.queries).toEqual([
      { query: "black rice", clicks: 3, impressions: 100, ctr: "3.0%", position: "7.2" },
    ]);
    expect(result.freshness).toMatchObject({
      selectedSource: "normalized",
      fallbackReason: null,
      normalizedCapturedAt: window.capturedAt,
      rawCapturedAt: new Date("2026-07-09T04:30:00.000Z"),
    });
  });

  it("leaves freshness selection timestamps null when the raw snapshot payload is empty", async () => {
    mockSnapshots.getLatestSnapshot.mockImplementation(async (source: string) => {
      if (source === "gsc") {
        return rawSnapshot(
          "gsc",
          "2026-07-09T04:30:00.000Z",
          "2026-06-08T00:00:00.000Z",
          "2026-07-06T00:00:00.000Z",
          {},
        );
      }
      return null;
    });

    const result = await getLatestGscData();

    expect(result.source).toBe("none");
    expect(result.freshness).toMatchObject({
      selectedSource: "none",
      selectedCapturedAt: null,
      selectedDateRangeStart: null,
      selectedDateRangeEnd: null,
      fallbackReason: null,
      rawCapturedAt: new Date("2026-07-09T04:30:00.000Z"),
      rawDateRangeStart: new Date("2026-06-08T00:00:00.000Z"),
      rawDateRangeEnd: new Date("2026-07-06T00:00:00.000Z"),
    });
  });

  it("uses normalized_missing when normalized rows are empty but raw queries are available", async () => {
    const window = {
      dateRangeStart: new Date("2026-06-01T00:00:00.000Z"),
      dateRangeEnd: new Date("2026-06-29T00:00:00.000Z"),
      capturedAt: new Date("2026-07-09T04:00:00.000Z"),
    };
    mockNormalized.getLatestGscWindow.mockResolvedValue(window);
    mockNormalized.getGscQueriesForWindow.mockResolvedValue([]);
    mockSnapshots.getLatestSnapshot.mockImplementation(async (source: string) => {
      if (source === "gsc") {
        return rawSnapshot(
          "gsc",
          "2026-07-09T04:30:00.000Z",
          "2026-06-08T00:00:00.000Z",
          "2026-07-06T00:00:00.000Z",
          {
            topQueries: [{ query: "fresh raw", clicks: 9, impressions: 300, ctr: "3.0%", position: "5.0" }],
          },
        );
      }
      if (source === "gsc_pages") {
        return rawSnapshot(
          "gsc_pages",
          "2026-07-09T04:30:00.000Z",
          "2026-06-08T00:00:00.000Z",
          "2026-07-06T00:00:00.000Z",
          {
            topPages: [{ page: "/blogs/fresh", clicks: 4, impressions: 100, ctr: "4.0%", position: "4.1" }],
          },
        );
      }
      if (source === "gsc_query_page") {
        return rawSnapshot(
          "gsc_query_page",
          "2026-07-09T04:30:00.000Z",
          "2026-06-08T00:00:00.000Z",
          "2026-07-06T00:00:00.000Z",
          {
            pairs: [{ query: "fresh raw", page: "/blogs/fresh", clicks: 4, impressions: 100, position: "4.1" }],
          },
        );
      }
      return null;
    });
    mockSnapshots.getQueries.mockReturnValue([
      { query: "fresh raw", clicks: 9, impressions: 300, ctr: "3.0%", position: "5.0" },
    ]);

    const result = await getLatestGscData();

    expect(result.source).toBe("rawSnapshot");
    expect(result.queries[0]?.query).toBe("fresh raw");
    expect(result.freshness).toMatchObject({
      selectedSource: "rawSnapshot",
      selectedCapturedAt: new Date("2026-07-09T04:30:00.000Z"),
      fallbackReason: "normalized_missing",
      normalizedCapturedAt: window.capturedAt,
      rawCapturedAt: new Date("2026-07-09T04:30:00.000Z"),
    });
  });

  it("does not join raw page evidence from a different reporting window", async () => {
    mockSnapshots.getLatestSnapshot.mockImplementation(async (source: string) => {
      if (source === "gsc") return rawSnapshot("gsc", "2026-07-09T04:30:00.000Z", "2026-06-08T00:00:00.000Z", "2026-07-06T00:00:00.000Z", { topQueries: [{ query: "black rice", clicks: 9, impressions: 300, ctr: "3.0%", position: "5.0" }] });
      if (source === "gsc_pages") return rawSnapshot("gsc_pages", "2026-07-09T04:30:00.000Z", "2026-05-01T00:00:00.000Z", "2026-05-31T00:00:00.000Z", { topPages: [{ page: "/stale", clicks: 4, impressions: 100, ctr: "4.0%", position: "4.1" }] });
      if (source === "gsc_query_page") return rawSnapshot("gsc_query_page", "2026-07-09T04:30:00.000Z", "2026-05-01T00:00:00.000Z", "2026-05-31T00:00:00.000Z", { pairs: [{ query: "black rice", page: "/stale", clicks: 4, impressions: 100, position: "4.1" }] });
      return null;
    });
    mockSnapshots.getQueries.mockReturnValue([{ query: "black rice", clicks: 9, impressions: 300, ctr: "3.0%", position: "5.0" }]);

    const result = await getLatestGscData();

    expect(result.source).toBe("rawSnapshot");
    expect(result.pages).toEqual([]);
    expect(result.queryPagePairs).toEqual([]);
  });

  it("falls back to raw GSC snapshot when raw data is more than 24 hours newer than normalized data", async () => {
    const window = {
      dateRangeStart: new Date("2026-06-01T00:00:00.000Z"),
      dateRangeEnd: new Date("2026-06-29T00:00:00.000Z"),
      capturedAt: new Date("2026-07-01T04:00:00.000Z"),
    };
    mockNormalized.getLatestGscWindow.mockResolvedValue(window);
    mockSnapshots.getLatestSnapshot.mockImplementation(async (source: string) => {
      if (source === "gsc") {
        return rawSnapshot(
          "gsc",
          "2026-07-09T04:00:00.000Z",
          "2026-06-08T00:00:00.000Z",
          "2026-07-06T00:00:00.000Z",
          {
            topQueries: [{ query: "fresh raw", clicks: 9, impressions: 300, ctr: "3.0%", position: "5.0" }],
          },
        );
      }
      if (source === "gsc_pages") {
        return rawSnapshot(
          "gsc_pages",
          "2026-07-09T04:00:00.000Z",
          "2026-06-08T00:00:00.000Z",
          "2026-07-06T00:00:00.000Z",
          {
            topPages: [{ page: "/blogs/fresh", clicks: 4, impressions: 100, ctr: "4.0%", position: "4.1" }],
          },
        );
      }
      if (source === "gsc_query_page") {
        return rawSnapshot(
          "gsc_query_page",
          "2026-07-09T04:00:00.000Z",
          "2026-06-08T00:00:00.000Z",
          "2026-07-06T00:00:00.000Z",
          {
            pairs: [{ query: "fresh raw", page: "/blogs/fresh", clicks: 4, impressions: 100, position: "4.1" }],
          },
        );
      }
      return null;
    });
    mockSnapshots.getQueries.mockReturnValue([
      { query: "fresh raw", clicks: 9, impressions: 300, ctr: "3.0%", position: "5.0" },
    ]);

    const result = await getLatestGscData();

    expect(result.source).toBe("rawSnapshot");
    expect(result.window).toBeNull();
    expect(result.queries[0]?.query).toBe("fresh raw");
    expect(result.freshness).toMatchObject({
      selectedSource: "rawSnapshot",
      fallbackReason: "raw_newer_than_normalized",
      normalizedCapturedAt: window.capturedAt,
      rawCapturedAt: new Date("2026-07-09T04:00:00.000Z"),
      rawDateRangeEnd: new Date("2026-07-06T00:00:00.000Z"),
    });
  });

  it("returns no-data freshness metadata when neither normalized nor raw GSC data exists", async () => {
    const result = await getLatestGscData();

    expect(result.source).toBe("none");
    expect(result.fetchedAt).toBeNull();
    expect(result.freshness).toEqual({
      selectedSource: "none",
      selectedCapturedAt: null,
      selectedDateRangeStart: null,
      selectedDateRangeEnd: null,
      normalizedCapturedAt: null,
      normalizedDateRangeStart: null,
      normalizedDateRangeEnd: null,
      rawCapturedAt: null,
      rawDateRangeStart: null,
      rawDateRangeEnd: null,
      fallbackReason: null,
    });
  });

  it("returns previous normalized rows with capture and window metadata", async () => {
    const currentWindow = { capturedAt: new Date("2026-07-10T00:00:00.000Z"), dateRangeStart: new Date("2026-07-01T00:00:00.000Z"), dateRangeEnd: new Date("2026-07-09T00:00:00.000Z") };
    const previousWindow = { capturedAt: new Date("2026-06-01T00:00:00.000Z"), dateRangeStart: new Date("2026-05-23T00:00:00.000Z"), dateRangeEnd: new Date("2026-05-31T00:00:00.000Z") };
    mockNormalized.getPreviousGscWindow.mockResolvedValue(previousWindow);
    mockNormalized.getGscQueriesForWindow.mockResolvedValue([{ query: "old", clicks: 1, impressions: 2, ctr: "50%", position: "4" }]);
    const result = await getPreviousGscData({ source: "normalized", window: currentWindow, queries: [], pages: [], queryPagePairs: [], fetchedAt: currentWindow.capturedAt, freshness: {} as never });
    expect(result).toMatchObject({ source: "normalized", fetchedAt: previousWindow.capturedAt, dateRangeStart: previousWindow.dateRangeStart, dateRangeEnd: previousWindow.dateRangeEnd });
    expect(result?.queries).toHaveLength(1);
  });
});

describe("getLatestGa4Data freshness selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSnapshots.getLatestSnapshot.mockResolvedValue(null);
    mockSnapshots.getPages.mockReturnValue([]);
    mockDb.pageAnalytics.findFirst.mockResolvedValue(null);
    mockDb.pageAnalytics.findMany.mockResolvedValue([]);
  });

  it("labels raw fallback as normalized_empty when the current normalized window has no usable rows", async () => {
    mockDb.pageAnalytics.findFirst.mockResolvedValue({
      dateRangeStart: new Date("2026-06-01T00:00:00.000Z"),
      dateRangeEnd: new Date("2026-06-29T00:00:00.000Z"),
      capturedAt: new Date("2026-07-09T04:00:00.000Z"),
    });
    mockDb.pageAnalytics.findMany.mockResolvedValue([]);
    mockSnapshots.getLatestSnapshot.mockResolvedValue(rawSnapshot("ga4", "2026-07-09T04:30:00.000Z", "2026-06-08T00:00:00.000Z", "2026-07-06T00:00:00.000Z", {}));
    mockSnapshots.getPages.mockReturnValue([{ page: "/blogs/black-rice", sessions: 42 }]);

    const result = await getLatestGa4Data();

    expect(result).toMatchObject({
      source: "rawSnapshot",
      pages: [{ page: "/blogs/black-rice", sessions: 42 }],
      freshness: { selectedSource: "rawSnapshot", fallbackReason: "normalized_empty" },
    });
  });

  it("keeps usable normalized GA4 rows when a newer raw snapshot has no usable pages", async () => {
    const window = {
      dateRangeStart: new Date("2026-06-01T00:00:00.000Z"),
      dateRangeEnd: new Date("2026-06-29T00:00:00.000Z"),
      capturedAt: new Date("2026-07-01T04:00:00.000Z"),
    };
    mockDb.pageAnalytics.findFirst.mockResolvedValue(window);
    mockDb.pageAnalytics.findMany.mockResolvedValue([
      { page: "/blogs/normalized", sessions: 25, bounceRate: 0.5, conversionRate: 0.02 },
    ]);
    mockSnapshots.getLatestSnapshot.mockResolvedValue(rawSnapshot("ga4", "2026-07-09T04:30:00.000Z", "2026-06-08T00:00:00.000Z", "2026-07-06T00:00:00.000Z", {}));
    mockSnapshots.getPages.mockReturnValue([]);

    const result = await getLatestGa4Data();

    expect(result).toMatchObject({
      source: "normalized",
      pages: [{ page: "/blogs/normalized", sessions: 25 }],
      freshness: { selectedSource: "normalized", fallbackReason: null },
    });
  });

  it("falls back to populated raw GA4 when normalized rows have zero usable traffic", async () => {
    mockDb.pageAnalytics.findFirst.mockResolvedValue({
      dateRangeStart: new Date("2026-06-01T00:00:00.000Z"),
      dateRangeEnd: new Date("2026-06-29T00:00:00.000Z"),
      capturedAt: new Date("2026-07-09T04:00:00.000Z"),
    });
    mockDb.pageAnalytics.findMany.mockResolvedValue([
      { page: "/blogs/empty", sessions: 0, bounceRate: null, conversionRate: null },
    ]);
    mockSnapshots.getLatestSnapshot.mockResolvedValue(rawSnapshot("ga4", "2026-07-09T04:30:00.000Z", "2026-06-08T00:00:00.000Z", "2026-07-06T00:00:00.000Z", {}));
    mockSnapshots.getPages.mockReturnValue([{ page: "/blogs/raw", sessions: 42 }]);

    const result = await getLatestGa4Data();

    expect(result).toMatchObject({
      source: "rawSnapshot",
      pages: [{ page: "/blogs/raw", sessions: 42 }],
      freshness: { selectedSource: "rawSnapshot", fallbackReason: "normalized_empty" },
    });
  });
});
