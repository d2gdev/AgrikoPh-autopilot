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

import { POST } from "@/app/api/recommendations/[id]/revert/route";

function request() {
  return new Request("http://test.local/api/recommendations/rec-1/revert", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

describe("recommendation revert route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.recommendation.findUnique.mockResolvedValue({
      id: "rec-1",
      status: "approved",
      reviewedBy: "operator-1",
      reviewNote: null,
    });
    mockPrisma.recommendation.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  it("reverts an approved recommendation back to pending", async () => {
    const res = await POST(request() as NextRequest, { params: Promise.resolve({ id: "rec-1" }) });

    expect(res.status).toBe(200);
    expect(mockPrisma.recommendation.updateMany).toHaveBeenCalledWith({
      where: { id: "rec-1", status: { in: ["approved", "rejected"] } },
      data: { status: "pending", reviewedAt: null, reviewedBy: null, reviewNote: null },
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "recommendation_review_reverted",
        before: expect.objectContaining({ status: "approved" }),
        after: { status: "pending" },
      }),
    });
  });

  it("refuses to revert once the executor has claimed the recommendation", async () => {
    mockPrisma.recommendation.findUnique.mockResolvedValueOnce({ id: "rec-1", status: "executing" });
    mockPrisma.recommendation.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await POST(request() as NextRequest, { params: Promise.resolve({ id: "rec-1" }) });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already been picked up/i);
  });

  it("refuses to revert an override_approved recommendation", async () => {
    mockPrisma.recommendation.findUnique.mockResolvedValueOnce({ id: "rec-1", status: "override_approved" });
    mockPrisma.recommendation.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await POST(request() as NextRequest, { params: Promise.resolve({ id: "rec-1" }) });

    expect(res.status).toBe(409);
  });
});
