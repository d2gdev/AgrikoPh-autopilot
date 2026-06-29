import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mockPrisma = vi.hoisted(() => ({
  recommendation: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  authorizePermission: vi.fn().mockResolvedValue({
    allowed: true,
    actor: "operator-1",
    permission: "recommendations:review",
  }),
  PERMISSIONS: {
    RECOMMENDATIONS_REVIEW: "recommendations:review",
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

import { POST } from "@/app/api/recommendations/[id]/reject/route";

function request(note = "not safe to execute") {
  return new Request("http://test.local/api/recommendations/rec-1/reject", {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

describe("recommendation reject route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.recommendation.findUnique.mockResolvedValue({
      id: "rec-1",
      status: "pending",
      reviewedAt: new Date("2026-06-19T00:00:00.000Z"),
    });
    mockPrisma.recommendation.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  it("allows pending recommendations to be rejected before execution", async () => {
    const res = await POST(request() as NextRequest, { params: Promise.resolve({ id: "rec-1" }) });

    expect(res.status).toBe(200);
    expect(mockPrisma.recommendation.updateMany).toHaveBeenCalledWith({
      where: { id: "rec-1", status: "pending" },
      data: expect.objectContaining({
        status: "rejected",
        reviewNote: "not safe to execute",
        reviewedBy: "operator-1",
      }),
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "recommendation_rejected",
        before: { status: "pending" },
        after: { status: "rejected" },
      }),
    });
  });

  it("does not reject recommendations already executing or executed", async () => {
    mockPrisma.recommendation.findUnique.mockResolvedValueOnce({ id: "rec-1", status: "executing" });
    mockPrisma.recommendation.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await POST(request() as NextRequest, { params: Promise.resolve({ id: "rec-1" }) });

    expect(res.status).toBe(409);
  });
});
