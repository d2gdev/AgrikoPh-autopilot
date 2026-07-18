import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mockAuthorizePermission = vi.hoisted(() => vi.fn());
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
  requireAppAuth: vi.fn().mockResolvedValue(null),
  authorizePermission: (...args: Parameters<typeof mockAuthorizePermission>) => mockAuthorizePermission(...args),
  PERMISSIONS: {
    RECOMMENDATIONS_REVIEW: "recommendations:review",
    RECOMMENDATIONS_OVERRIDE: "recommendations:override",
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

import { POST as approvePOST } from "@/app/api/recommendations/[id]/approve/route";
import { POST as rejectPOST } from "@/app/api/recommendations/[id]/reject/route";
import { POST as overridePOST } from "@/app/api/recommendations/[id]/request-override/route";

function forbiddenDecision(permission: string) {
  return {
    allowed: false,
    actor: "staff-1",
    permission,
    response: Response.json({ error: "Forbidden", permission }, { status: 403 }),
  };
}

function request(path: string, body: Record<string, unknown> = {}) {
  return new Request(`http://test.local${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe("recommendation mutation permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  it("rejects approve without recommendations:review", async () => {
    mockAuthorizePermission.mockResolvedValueOnce(forbiddenDecision("recommendations:review"));

    const res = await approvePOST(
      request("/api/recommendations/rec-1/approve", { note: "ok" }),
      { params: Promise.resolve({ id: "rec-1" }) },
    );

    expect(res.status).toBe(403);
    expect(mockPrisma.recommendation.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "permission_denied",
        entityType: "recommendation",
        entityId: "rec-1",
        after: expect.objectContaining({ permission: "recommendations:review" }),
      }),
    });
  });

  it("rejects reject without recommendations:review", async () => {
    mockAuthorizePermission.mockResolvedValueOnce(forbiddenDecision("recommendations:review"));

    const res = await rejectPOST(
      request("/api/recommendations/rec-1/reject", { note: "no" }),
      { params: Promise.resolve({ id: "rec-1" }) },
    );

    expect(res.status).toBe(403);
    expect(mockPrisma.recommendation.updateMany).not.toHaveBeenCalled();
  });

  it("rejects override without recommendations:override", async () => {
    mockAuthorizePermission.mockResolvedValueOnce(forbiddenDecision("recommendations:override"));

    const res = await overridePOST(
      request("/api/recommendations/rec-1/request-override", { justification: "approved by owner" }),
      { params: Promise.resolve({ id: "rec-1" }) },
    );

    expect(res.status).toBe(403);
    expect(mockPrisma.recommendation.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "permission_denied",
        entityType: "recommendation",
        entityId: "rec-1",
        after: expect.objectContaining({ permission: "recommendations:override" }),
      }),
    });
  });
});
