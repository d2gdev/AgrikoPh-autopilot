import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  requireAppAuth: vi.fn(),
}));

const mockPrisma = vi.hoisted(() => ({
  auditLog: {
    create: vi.fn(),
  },
  contentProposal: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
}));

const mockMarkDismissed = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getSessionUser: mockAuth.getSessionUser,
  requireAppAuth: mockAuth.requireAppAuth,
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/opportunities/content-proposal-outcomes", () => ({
  markContentProposalOpportunityDismissed: mockMarkDismissed,
}));

function request(body: Record<string, unknown> = {}) {
  return new Request("http://test.local/api/content-pilot/proposals/proposal-1/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "proposal-1",
    status: "approved",
    draftStatus: "ready",
    sourceData: {},
    ...overrides,
  };
}

describe("Content Pilot reject route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.requireAppAuth.mockResolvedValue(null);
    mockAuth.getSessionUser.mockResolvedValue("operator");
    mockPrisma.contentProposal.findUnique.mockResolvedValue(proposal());
    mockPrisma.contentProposal.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockMarkDismissed.mockResolvedValue({});
  });

  it.each([
    ["approved no-draft proposal", proposal({ draftStatus: null })],
    ["ready draft", proposal({ draftStatus: "ready" })],
    ["failed draft", proposal({ draftStatus: "failed" })],
  ])("allows rejecting an %s before publishing", async (_label, existing) => {
    mockPrisma.contentProposal.findUnique
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ ...existing, status: "rejected", reviewNote: "changed my mind" });

    const { POST } = await import("@/app/api/content-pilot/proposals/[id]/reject/route");
    const res = await POST(request({ reviewNote: "changed my mind" }), {
      params: Promise.resolve({ id: "proposal-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.proposal).toEqual(expect.objectContaining({ status: "rejected", reviewNote: "changed my mind" }));
    expect(mockPrisma.contentProposal.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "proposal-1",
        status: { not: "rejected" },
        OR: [
          { draftStatus: null },
          { draftStatus: { notIn: ["publishing", "published"] } },
        ],
      }),
      data: expect.objectContaining({
        status: "rejected",
        reviewNote: "changed my mind",
      }),
    });
    expect(mockMarkDismissed).toHaveBeenCalledWith(mockPrisma, {
      proposalId: "proposal-1",
      sourceData: existing.sourceData,
    });
  });

  it.each([
    ["publishing draft", proposal({ draftStatus: "publishing" })],
    ["published draft", proposal({ draftStatus: "published" })],
    ["already rejected proposal", proposal({ status: "rejected", draftStatus: null })],
  ])("blocks rejecting a %s", async (_label, existing) => {
    mockPrisma.contentProposal.findUnique.mockResolvedValueOnce(existing);

    const { POST } = await import("@/app/api/content-pilot/proposals/[id]/reject/route");
    const res = await POST(request({ reviewNote: "too late" }), {
      params: Promise.resolve({ id: "proposal-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("Cannot reject");
    expect(mockPrisma.contentProposal.updateMany).not.toHaveBeenCalled();
    expect(mockMarkDismissed).not.toHaveBeenCalled();
  });
});
