import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  rawSnapshot: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const {
  getComparisonSnapshot,
  getLatestSnapshot,
  getSnapshotForWindow,
} = await import("@/lib/seo/snapshot");

function snapshot(overrides: Record<string, unknown>) {
  return {
    id: "snap",
    source: "gsc",
    fetchedAt: new Date("2026-06-24T00:00:00.000Z"),
    dateRangeStart: new Date("2026-05-27T00:00:00.000Z"),
    dateRangeEnd: new Date("2026-06-24T00:00:00.000Z"),
    payload: { topQueries: [] },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getLatestSnapshot", () => {
  it("selects latest snapshots by dateRangeEnd before fetchedAt", async () => {
    mockPrisma.rawSnapshot.findFirst.mockResolvedValue(snapshot({ id: "current" }));

    await getLatestSnapshot("gsc");

    expect(mockPrisma.rawSnapshot.findFirst).toHaveBeenCalledWith({
      where: { source: "gsc" },
      orderBy: [{ dateRangeEnd: "desc" }, { fetchedAt: "desc" }],
    });
  });

  it("selects timeless SEO analysis snapshots by fetchedAt", async () => {
    mockPrisma.rawSnapshot.findFirst.mockResolvedValue(snapshot({ id: "analysis" }));

    await getLatestSnapshot("seo_analysis");

    expect(mockPrisma.rawSnapshot.findFirst).toHaveBeenCalledWith({
      where: { source: "seo_analysis" },
      orderBy: { fetchedAt: "desc" },
    });
  });
});

describe("getSnapshotForWindow", () => {
  it("requires both exact inclusive window boundaries", async () => {
    const start = new Date("2026-06-20T00:00:00.000Z");
    const end = new Date("2026-07-17T00:00:00.000Z");
    mockPrisma.rawSnapshot.findFirst.mockResolvedValue(snapshot({
      dateRangeStart: start,
      dateRangeEnd: end,
    }));

    await getSnapshotForWindow("gsc", start, end);

    expect(mockPrisma.rawSnapshot.findFirst).toHaveBeenCalledWith({
      where: {
        source: "gsc",
        dateRangeStart: start,
        dateRangeEnd: end,
      },
      orderBy: { fetchedAt: "desc" },
    });
  });
});

describe("getComparisonSnapshot", () => {
  it("selects an equally-sized prior window ending before latest start", async () => {
    const latest = {
      id: "current",
      fetchedAt: new Date("2026-06-24T00:00:00.000Z"),
      dateRangeStart: new Date("2026-05-27T00:00:00.000Z"),
      dateRangeEnd: new Date("2026-06-24T00:00:00.000Z"),
      payload: {},
    };
    mockPrisma.rawSnapshot.findMany.mockResolvedValue([snapshot({ id: "prior", dateRangeStart: new Date("2026-04-28T00:00:00.000Z"), dateRangeEnd: new Date("2026-05-26T00:00:00.000Z") })]);

    await getComparisonSnapshot("gsc", latest);

    expect(mockPrisma.rawSnapshot.findMany).toHaveBeenCalledWith({
      where: {
        source: "gsc",
        id: { not: "current" },
        dateRangeEnd: { lt: latest.dateRangeStart },
      },
      orderBy: { dateRangeEnd: "desc" },
      take: 30,
    });
  });

  it("does not compare a different-length prior window", async () => {
    const latest = {
      id: "current",
      fetchedAt: new Date("2026-06-24T00:00:00.000Z"),
      dateRangeStart: new Date("2026-05-27T00:00:00.000Z"),
      dateRangeEnd: new Date("2026-06-24T00:00:00.000Z"),
      payload: {},
    };
    mockPrisma.rawSnapshot.findMany.mockResolvedValue([
      snapshot({ id: "short", dateRangeStart: new Date("2026-05-25T00:00:00.000Z"), dateRangeEnd: new Date("2026-05-26T00:00:00.000Z") }),
    ]);

    await expect(getComparisonSnapshot("gsc", latest)).resolves.toBeNull();
  });
});
