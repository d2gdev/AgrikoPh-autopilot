import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/seo/data", () => ({
  getLatestGscData: vi.fn(),
  getPreviousGscQueries: vi.fn(),
}));

vi.mock("@/lib/seo/trends", () => ({
  computeTrends: vi.fn(),
}));

const { getLatestGscData, getPreviousGscQueries } = await import("@/lib/seo/data");
const { computeTrends } = await import("@/lib/seo/trends");
const { getGscMovers } = await import("@/lib/dashboard/gsc-movers");

const emptyLatest = {
  queries: [],
  pages: [],
  queryPagePairs: [],
  fetchedAt: null,
  source: "none",
  window: null,
};

const emptyTrends = {
  current: { clicks: 0, impressions: 0, avgCtr: 0, avgPosition: 0 },
  previous: null,
  currentFetchedAt: null,
  previousFetchedAt: null,
  movers: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLatestGscData).mockResolvedValue(emptyLatest as never);
  vi.mocked(getPreviousGscQueries).mockResolvedValue(null);
  vi.mocked(computeTrends).mockReturnValue(emptyTrends);
});

describe("getGscMovers", () => {
  it("returns top 3 risers (highest clicksDelta first) and top 3 fallers (lowest clicksDelta first)", async () => {
    vi.mocked(computeTrends).mockReturnValue({
      ...emptyTrends,
      movers: [
        { query: "a", clicks: 10, clicksDelta: 8, impressionsDelta: 20, positionDelta: -1, direction: "up" },
        { query: "b", clicks: 8, clicksDelta: 6, impressionsDelta: 15, positionDelta: -2, direction: "up" },
        { query: "c", clicks: 6, clicksDelta: 4, impressionsDelta: 10, positionDelta: 0, direction: "up" },
        { query: "d", clicks: 5, clicksDelta: 3, impressionsDelta: 8, positionDelta: 1, direction: "up" },
        { query: "e", clicks: 2, clicksDelta: -5, impressionsDelta: -10, positionDelta: 3, direction: "down" },
        { query: "f", clicks: 1, clicksDelta: -7, impressionsDelta: -15, positionDelta: 5, direction: "down" },
        { query: "g", clicks: 0, clicksDelta: -9, impressionsDelta: -20, positionDelta: 7, direction: "down" },
        { query: "h", clicks: 0, clicksDelta: -12, impressionsDelta: -25, positionDelta: 9, direction: "down" },
      ],
    });

    const result = await getGscMovers();

    expect(result.risers).toHaveLength(3);
    expect(result.risers[0]!.query).toBe("a");
    expect(result.risers[1]!.query).toBe("b");
    expect(result.risers[2]!.query).toBe("c");
    expect(result.fallers).toHaveLength(3);
    expect(result.fallers[0]!.query).toBe("h");
    expect(result.fallers[1]!.query).toBe("g");
    expect(result.fallers[2]!.query).toBe("f");
  });

  it("returns empty arrays when no GSC data", async () => {
    const result = await getGscMovers();

    expect(result.risers).toHaveLength(0);
    expect(result.fallers).toHaveLength(0);
    expect(result.fetchedAt).toBeNull();
  });

  it("passes latest.queries and previous to computeTrends", async () => {
    const queries = [{ query: "shoes", clicks: 10 }];
    const previous = [{ query: "shoes", clicks: 8 }];
    const fetchedAt = new Date("2026-06-25T12:00:00Z");

    vi.mocked(getLatestGscData).mockResolvedValue({
      ...emptyLatest,
      queries: queries as never,
      fetchedAt,
    } as never);
    vi.mocked(getPreviousGscQueries).mockResolvedValue(previous as never);

    await getGscMovers();

    expect(computeTrends).toHaveBeenCalledWith(
      queries,
      previous,
      fetchedAt.toISOString(),
      null,
    );
  });

  it("returns fetchedAt as ISO string from latest data", async () => {
    const fetchedAt = new Date("2026-06-25T08:00:00Z");
    vi.mocked(getLatestGscData).mockResolvedValue({
      ...emptyLatest,
      fetchedAt,
    } as never);

    const result = await getGscMovers();

    expect(result.fetchedAt).toBe(fetchedAt.toISOString());
  });
});
