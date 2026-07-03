import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  jobRun: {
    create: vi.fn().mockResolvedValue({ id: "run_1" }),
    update: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue(1),
  },
  recommendation: {
    count: vi.fn(),
    findMany: vi.fn().mockResolvedValue([
      { outcome: { verdict: "improved" } },
      { outcome: { verdict: "improved" } },
      { outcome: { verdict: "worsened" } },
    ]),
  },
  auditLog: { count: vi.fn().mockResolvedValue(2) },
  contentProposal: { count: vi.fn().mockResolvedValue(1) },
  adApproval: { count: vi.fn().mockResolvedValue(4) },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/alerts", () => ({ sendOperatorAlert: vi.fn().mockResolvedValue(undefined) }));

import { dailyDigestHandler } from "@/jobs/daily-digest";
import { sendOperatorAlert } from "@/lib/alerts";

describe("dailyDigestHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.jobRun.create.mockResolvedValue({ id: "run_1" });
    // pending → 5, pendingOver7Days → 2, executedYesterday → 3, in call order
    prismaMock.recommendation.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
  });

  it("assembles the digest and sends exactly one daily_digest alert", async () => {
    const result = await dailyDigestHandler();
    expect(result.status).toBe("success");
    expect(result.summary.pendingRecommendations).toBe(5);
    expect(result.summary.pendingOver7Days).toBe(2);
    expect(result.summary.executedYesterday).toBe(3);
    expect(result.summary.outcomesCheckedYesterday).toEqual({ improved: 2, worsened: 1 });
    expect(sendOperatorAlert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendOperatorAlert).mock.calls[0]?.[0]).toBe("daily_digest");
  });

  it("marks the JobRun failed and rethrows nothing when a query throws", async () => {
    prismaMock.recommendation.count.mockReset().mockRejectedValue(new Error("db down"));
    const result = await dailyDigestHandler();
    expect(result.status).toBe("failed");
    expect(prismaMock.jobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }),
    );
  });
});
