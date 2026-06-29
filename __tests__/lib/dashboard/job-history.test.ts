import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  jobRun: {
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { getJobHistory } = await import("@/lib/dashboard/job-history");
const { JOB_NAMES } = await import("@/lib/dashboard/jobs-status");

beforeEach(() => vi.clearAllMocks());

describe("getJobHistory", () => {
  it("returns last 7 runs per job, newest-first, keyed by jobName", async () => {
    mockPrisma.jobRun.findMany.mockImplementation(({ where }: { where: { jobName: string } }) => {
      if (where.jobName === "fetch-ads-data") {
        return Promise.resolve([
          { status: "success", startedAt: new Date("2026-06-25T10:00:00Z") },
          { status: "failed", startedAt: new Date("2026-06-24T10:00:00Z") },
        ]);
      }
      if (where.jobName === "run-skills") {
        return Promise.resolve([
          { status: "success", startedAt: new Date("2026-06-25T11:00:00Z") },
        ]);
      }
      return Promise.resolve([]);
    });

    const result = await getJobHistory();

    expect(result["fetch-ads-data"]).toHaveLength(2);
    expect(result["fetch-ads-data"]![0]!.status).toBe("success");
    expect(result["fetch-ads-data"]![1]!.status).toBe("failed");
    expect(result["run-skills"]).toHaveLength(1);
    expect(result["run-skills"]![0]!.status).toBe("success");
  });

  it("returns empty arrays for jobs with no runs", async () => {
    mockPrisma.jobRun.findMany.mockResolvedValue([]);

    const result = await getJobHistory();

    expect(Object.values(result).every((arr) => arr.length === 0)).toBe(true);
  });

  it("limits each job to 7 entries even if DB returns more", async () => {
    const manyRuns = Array.from({ length: 10 }, (_, i) => ({
      status: "success",
      startedAt: new Date(Date.now() - i * 86400000),
    }));
    mockPrisma.jobRun.findMany.mockImplementation(({ where }: { where: { jobName: string } }) =>
      Promise.resolve(where.jobName === "run-skills" ? manyRuns.slice(0, 7) : []),
    );

    const result = await getJobHistory();

    expect(result["run-skills"]!).toHaveLength(7);
    expect(mockPrisma.jobRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobName: "run-skills" },
        take: 7,
      }),
    );
  });

  it("serialises startedAt as ISO string", async () => {
    const date = new Date("2026-06-25T10:00:00Z");
    mockPrisma.jobRun.findMany.mockImplementation(({ where }: { where: { jobName: string } }) =>
      Promise.resolve(where.jobName === "fetch-ads-data" ? [{ status: "success", startedAt: date }] : []),
    );

    const result = await getJobHistory();

    expect(result["fetch-ads-data"]![0]!.startedAt).toBe(date.toISOString());
  });

  it("queries each job independently so noisy jobs cannot starve quiet jobs", async () => {
    mockPrisma.jobRun.findMany.mockImplementation(({ where }: { where: { jobName: string } }) =>
      Promise.resolve(
        where.jobName === "fetch-keyword-research"
          ? [{ status: "success", startedAt: new Date("2026-06-20T10:00:00Z") }]
          : [],
      ),
    );

    const result = await getJobHistory();

    expect(mockPrisma.jobRun.findMany).toHaveBeenCalledTimes(JOB_NAMES.length);
    expect(result["fetch-keyword-research"]).toHaveLength(1);
    expect(result["fetch-keyword-research"]![0]!.startedAt).toBe("2026-06-20T10:00:00.000Z");
  });
});
