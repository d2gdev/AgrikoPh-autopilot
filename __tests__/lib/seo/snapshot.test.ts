import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  rawSnapshot: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { getComparisonSnapshot, getLatestSnapshot } = await import("@/lib/seo/snapshot");

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
});

describe("getComparisonSnapshot", () => {
  it("selects a non-overlapping prior window ending at or before latest start", async () => {
    const latest = {
      id: "current",
      fetchedAt: new Date("2026-06-24T00:00:00.000Z"),
      dateRangeStart: new Date("2026-05-27T00:00:00.000Z"),
      dateRangeEnd: new Date("2026-06-24T00:00:00.000Z"),
      payload: {},
    };
    mockPrisma.rawSnapshot.findFirst.mockResolvedValue(snapshot({ id: "prior" }));

    await getComparisonSnapshot("gsc", latest);

    expect(mockPrisma.rawSnapshot.findFirst).toHaveBeenCalledWith({
      where: {
        source: "gsc",
        id: { not: "current" },
        dateRangeEnd: { lte: latest.dateRangeStart },
      },
      orderBy: { dateRangeEnd: "desc" },
    });
  });
});

