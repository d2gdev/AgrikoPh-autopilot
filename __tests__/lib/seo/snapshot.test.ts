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
