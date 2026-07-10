import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  requireAppAuth: vi.fn(),
  requirePermission: vi.fn(),
}));
const mockPrisma = vi.hoisted(() => ({
  auditLog: { create: vi.fn() },
  contentProposal: { findUnique: vi.fn(), update: vi.fn() },
  contentProposalDraftHistory: { create: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: { CONTENT_REVIEW: "content:review" },
  getSessionUser: mockAuth.getSessionUser,
  requireAppAuth: mockAuth.requireAppAuth,
  requirePermission: mockAuth.requirePermission,
}));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/content-pilot/generate-draft", () => ({
  getDraftSchema: () => ({ safeParse: (value: unknown) => ({ success: true, data: value }) }),
}));

function request() {
  return new Request("http://test.local/api/content-pilot/proposals/proposal-1", {
    method: "PATCH",
    body: JSON.stringify({ draftContent: { title: "Updated draft" } }),
  });
}

describe("PATCH /api/content-pilot/proposals/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.requireAppAuth.mockResolvedValue(null);
    mockAuth.requirePermission.mockResolvedValue(null);
    mockAuth.getSessionUser.mockResolvedValue("operator-1");
    mockPrisma.contentProposal.findUnique.mockResolvedValue({
      id: "proposal-1",
      status: "approved",
      draftStatus: "ready",
      proposalType: "seo-fix",
      draftContent: { title: "Before" },
    });
  });

  it("returns conflict without audit or history writes when approval is revoked after the editable read", async () => {
    mockPrisma.contentProposal.update.mockRejectedValue({ code: "P2025" });

    const { PATCH } = await import("@/app/api/content-pilot/proposals/[id]/route");
    const response = await PATCH(request(), { params: Promise.resolve({ id: "proposal-1" }) });

    expect(response.status).toBe(409);
    expect(mockPrisma.contentProposal.update).toHaveBeenCalledWith({
      where: {
        id: "proposal-1",
        status: { in: ["approved", "override_approved"] },
        draftStatus: "ready",
      },
      data: { draftContent: { title: "Updated draft" } },
    });
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    expect(mockPrisma.contentProposalDraftHistory.create).not.toHaveBeenCalled();
  });
});
