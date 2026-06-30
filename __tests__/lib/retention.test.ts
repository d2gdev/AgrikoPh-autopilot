import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  rawSnapshot: {
    count: vi.fn(),
    deleteMany: vi.fn(),
  },
  jobRun: {
    deleteMany: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

import { cleanupDashboardRetention, getRetentionConfig } from "@/lib/retention";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mockPrisma.rawSnapshot.count.mockResolvedValue(2);
  mockPrisma.rawSnapshot.deleteMany.mockResolvedValue({ count: 7 });
  mockPrisma.jobRun.deleteMany.mockResolvedValue({ count: 11 });
});

describe("retention cleanup", () => {
  it("uses safe defaults when retention env values are absent or invalid", () => {
    expect(getRetentionConfig({} as NodeJS.ProcessEnv)).toEqual({
      rawSnapshotRetentionDays: 30,
      jobRunRetentionDays: 90,
    });

    expect(getRetentionConfig({
      RAW_SNAPSHOT_RETENTION_DAYS: "0",
      JOB_RUN_RETENTION_DAYS: "nope",
    } as unknown as NodeJS.ProcessEnv)).toEqual({
      rawSnapshotRetentionDays: 30,
      jobRunRetentionDays: 90,
    });
  });

  it("deletes only unreferenced old raw snapshots and terminal old job runs", async () => {
    vi.stubEnv("RAW_SNAPSHOT_RETENTION_DAYS", "14");
    vi.stubEnv("JOB_RUN_RETENTION_DAYS", "45");
    const now = new Date("2026-06-25T00:00:00.000Z");

    const summary = await cleanupDashboardRetention(now);

    const rawSnapshotCutoff = new Date("2026-06-11T00:00:00.000Z");
    const jobRunCutoff = new Date("2026-05-11T00:00:00.000Z");

    expect(mockPrisma.rawSnapshot.count).toHaveBeenCalledWith({
      where: {
        fetchedAt: { lt: rawSnapshotCutoff },
        source: { not: "seo_history" },
        recommendations: { some: {} },
      },
    });
    expect(mockPrisma.rawSnapshot.deleteMany).toHaveBeenCalledWith({
      where: {
        fetchedAt: { lt: rawSnapshotCutoff },
        source: { not: "seo_history" },
        recommendations: { none: {} },
      },
    });
    expect(mockPrisma.jobRun.deleteMany).toHaveBeenCalledWith({
      where: {
        startedAt: { lt: jobRunCutoff },
        status: { in: ["success", "failed", "partial", "skipped"] },
      },
    });
    expect(summary).toMatchObject({
      rawSnapshotRetentionDays: 14,
      jobRunRetentionDays: 45,
      snapshotsDeleted: 7,
      snapshotsRetainedWithRecommendations: 2,
      jobRunsDeleted: 11,
    });
  });
});
