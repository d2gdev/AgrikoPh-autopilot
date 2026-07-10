import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  requirePermission: vi.fn(),
}));
const mockPrisma = vi.hoisted(() => ({
  auditLog: { create: vi.fn() },
  contentProposal: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: { CONTENT_PUBLISH: "content:publish" },
  getSessionUser: mockAuth.getSessionUser,
  requirePermission: mockAuth.requirePermission,
}));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

function request() {
  return new Request("http://test.local/api/content-pilot/proposals/proposal-1/schedule", {
    method: "PATCH",
    body: JSON.stringify({ scheduledPublishAt: "2026-08-01T12:00:00.000Z" }),
  });
}

function readyProposal(status: string) {
  return {
    id: "proposal-1",
    status,
    draftStatus: "ready",
    scheduledPublishAt: null,
  };
}

describe("PATCH /api/content-pilot/proposals/[id]/schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.requirePermission.mockResolvedValue(null);
    mockAuth.getSessionUser.mockResolvedValue("operator-1");
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  it.each(["pending", "rejected"])("does not schedule a ready %s proposal", async (status) => {
    mockPrisma.contentProposal.findUnique.mockResolvedValue(readyProposal(status));

    const { PATCH } = await import("@/app/api/content-pilot/proposals/[id]/schedule/route");
    const response = await PATCH(request(), { params: Promise.resolve({ id: "proposal-1" }) });

    expect(response.status).toBe(409);
    expect(mockPrisma.contentProposal.update).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(["approved", "override_approved"])("schedules a ready %s proposal", async (status) => {
    const proposal = readyProposal(status);
    mockPrisma.contentProposal.findUnique.mockResolvedValue(proposal);
    mockPrisma.contentProposal.update.mockResolvedValue({
      ...proposal,
      scheduledPublishAt: new Date("2026-08-01T12:00:00.000Z"),
    });

    const { PATCH } = await import("@/app/api/content-pilot/proposals/[id]/schedule/route");
    const response = await PATCH(request(), { params: Promise.resolve({ id: "proposal-1" }) });

    expect(response.status).toBe(200);
    expect(mockPrisma.contentProposal.update).toHaveBeenCalledWith({
      where: {
        id: "proposal-1",
        status: { in: ["approved", "override_approved"] },
        draftStatus: "ready",
      },
      data: { scheduledPublishAt: new Date("2026-08-01T12:00:00.000Z") },
    });
  });
});
