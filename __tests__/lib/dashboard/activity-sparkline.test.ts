import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  auditLog: { findMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { getActivitySparkline } = await import("@/lib/dashboard/activity-sparkline");

beforeEach(() => vi.clearAllMocks());

describe("getActivitySparkline", () => {
  it("returns exactly 30 entries", async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);

    const result = await getActivitySparkline(new Date("2026-06-25T12:00:00Z"));

    expect(result.days).toHaveLength(30);
  });

  it("fills zero for days with no activity", async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);

    const result = await getActivitySparkline(new Date("2026-06-25T12:00:00Z"));

    expect(result.days.every((d) => d.count === 0)).toBe(true);
  });

  it("counts events correctly per day", async () => {
    const today = new Date("2026-06-25T12:00:00Z");
    const yesterday = new Date("2026-06-24T12:00:00Z");
    mockPrisma.auditLog.findMany.mockResolvedValue([
      { createdAt: today },
      { createdAt: today },
      { createdAt: yesterday },
    ]);

    const result = await getActivitySparkline(today);

    const todayStr = today.toISOString().slice(0, 10);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const todayEntry = result.days.find((d) => d.date === todayStr);
    const yesterdayEntry = result.days.find((d) => d.date === yesterdayStr);

    expect(todayEntry?.count).toBe(2);
    expect(yesterdayEntry?.count).toBe(1);
  });

  it("returns days in ascending chronological order", async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);

    const result = await getActivitySparkline(new Date("2026-06-25T12:00:00Z"));

    for (let i = 1; i < result.days.length; i++) {
      expect(result.days[i]!.date > result.days[i - 1]!.date).toBe(true);
    }
  });

  it("captures now once and returns explicit timezone metadata", async () => {
    const now = new Date("2026-06-25T12:34:56.000Z");
    mockPrisma.auditLog.findMany.mockResolvedValue([]);

    const result = await getActivitySparkline(now);

    expect(result.timezone).toBe("UTC");
    expect(result.generatedAt).toBe(now.toISOString());
    expect(result.days[0]!.date).toBe("2026-05-27");
    expect(result.days.at(-1)!.date).toBe("2026-06-25");
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { gte: new Date("2026-05-27T12:34:56.000Z") } },
      }),
    );
  });
});
