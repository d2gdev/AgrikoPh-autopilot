import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  gscQuery: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const {
  getGscPagesForWindow,
  getGscQueriesForWindow,
  getGscQueryPagePairsForWindow,
  getLatestGscWindow,
  getPreviousGscWindow,
} = await import("@/lib/seo/gsc-normalized");

const latestWindow = {
  dateRangeStart: new Date("2026-05-27T00:00:00.000Z"),
  dateRangeEnd: new Date("2026-06-24T00:00:00.000Z"),
  capturedAt: new Date("2026-06-24T12:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalized GSC windows", () => {
  it("selects the latest window by dateRangeEnd, then capturedAt", async () => {
    mockPrisma.gscQuery.findFirst.mockResolvedValue(latestWindow);

    const result = await getLatestGscWindow();

    expect(result).toEqual(latestWindow);
    expect(mockPrisma.gscQuery.findFirst).toHaveBeenCalledWith({
      select: { dateRangeStart: true, dateRangeEnd: true, capturedAt: true },
      orderBy: [{ dateRangeEnd: "desc" }, { capturedAt: "desc" }],
    });
  });

  it("selects a non-overlapping previous window", async () => {
    mockPrisma.gscQuery.findFirst.mockResolvedValue({
      dateRangeStart: new Date("2026-04-28T00:00:00.000Z"),
      dateRangeEnd: new Date("2026-05-26T00:00:00.000Z"),
      capturedAt: new Date("2026-05-26T12:00:00.000Z"),
    });

    await getPreviousGscWindow(latestWindow);

    expect(mockPrisma.gscQuery.findFirst).toHaveBeenCalledWith({
      where: { dateRangeEnd: { lte: latestWindow.dateRangeStart } },
      select: { dateRangeStart: true, dateRangeEnd: true, capturedAt: true },
      orderBy: [{ dateRangeEnd: "desc" }, { capturedAt: "desc" }],
    });
  });

  it("returns null when no window exists", async () => {
    mockPrisma.gscQuery.findFirst.mockResolvedValue(null);

    await expect(getLatestGscWindow()).resolves.toBeNull();
  });
});

describe("normalized GSC rows", () => {
  it("groups query rows with summed clicks, impressions, ctr, and weighted position", async () => {
    mockPrisma.gscQuery.findMany.mockResolvedValue([
      {
        query: "organic rice",
        page: "https://agrikoph.com/blogs/news/a",
        clicks: 10,
        impressions: 100,
        position: 5,
        ctr: 0.1,
      },
      {
        query: "organic rice",
        page: "https://agrikoph.com/blogs/news/b",
        clicks: 5,
        impressions: 300,
        position: 9,
        ctr: 0.0167,
      },
      {
        query: "turmeric tea",
        page: "https://agrikoph.com/products/turmeric",
        clicks: 3,
        impressions: 30,
        position: 3,
        ctr: 0.1,
      },
    ]);

    const result = await getGscQueriesForWindow(latestWindow);

    expect(result[0]).toEqual({
      query: "organic rice",
      clicks: 15,
      impressions: 400,
      ctr: "3.8%",
      position: "8.0",
    });
    expect(result[1]?.query).toBe("turmeric tea");
  });

  it("groups page rows and sorts by clicks then impressions", async () => {
    mockPrisma.gscQuery.findMany.mockResolvedValue([
      {
        query: "black rice",
        page: "https://agrikoph.com/products/black-rice",
        clicks: 2,
        impressions: 100,
        position: 8,
        ctr: 0.02,
      },
      {
        query: "organic black rice",
        page: "https://agrikoph.com/products/black-rice",
        clicks: 8,
        impressions: 200,
        position: 4,
        ctr: 0.04,
      },
      {
        query: "red rice",
        page: "https://agrikoph.com/products/red-rice",
        clicks: 9,
        impressions: 500,
        position: 6,
        ctr: 0.018,
      },
    ]);

    const result = await getGscPagesForWindow(latestWindow);

    expect(result[0]).toMatchObject({
      page: "https://agrikoph.com/products/black-rice",
      clicks: 10,
      impressions: 300,
      ctr: "3.3%",
      position: "5.3",
    });
    expect(result[1]?.page).toBe("https://agrikoph.com/products/red-rice");
  });

  it("returns query-page pairs in legacy-compatible shape", async () => {
    mockPrisma.gscQuery.findMany.mockResolvedValue([
      {
        query: "red rice",
        page: "https://agrikoph.com/products/red-rice",
        clicks: 1,
        impressions: 50,
        position: 11.35,
        ctr: 0.02,
      },
    ]);

    const result = await getGscQueryPagePairsForWindow(latestWindow);

    expect(result).toEqual([
      {
        query: "red rice",
        page: "https://agrikoph.com/products/red-rice",
        clicks: 1,
        impressions: 50,
        position: "11.3",
      },
    ]);
  });
});
