import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => {
  const base = {
    adApproval: { findUnique: vi.fn(), updateMany: vi.fn() },
    adRevision: { count: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
    reviewerAssignment: { findUnique: vi.fn() },
    adAIJobQueue: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  // Interactive-transaction passthrough: the callback receives the same mocks.
  base.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(base));
  return base;
});

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({
  requireAppAuth: vi.fn().mockResolvedValue(null),
  getSessionUser: vi.fn().mockResolvedValue("user-1"),
  authorizePermission: vi.fn().mockResolvedValue({ allowed: false }), // not admin
  PERMISSIONS: { AD_APPROVAL_ADMIN: "ad_approval:admin" },
}));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyMany: vi.fn(), ADMIN_RECIPIENT: "ADMIN" }));

import { POST } from "@/app/api/ad-approvals/[id]/submit/route";
import { STATUS } from "@/lib/ad-approval/constants";

function req() {
  return new Request("http://test.local/api/ad-approvals/ap-1/submit", { method: "POST", body: "{}" });
}
const params = Promise.resolve({ id: "ap-1" });

const draft = {
  id: "ap-1",
  campaignId: "2026-08-01-Rice-Health",
  submitterId: "user-1",
  status: STATUS.DRAFT,
  version: 0,
  currentRevision: 1,
  draftCopy: { primary_text: "Fresh rice", headline: "Buy now", cta: "Shop Now" },
  draftCreative: { destination_url: "https://agrikoph.com" },
};

describe("POST /api/ad-approvals/[id]/submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.adApproval.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.adRevision.create.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.reviewerAssignment.findUnique.mockResolvedValue(null);
    mockPrisma.adAIJobQueue.create.mockResolvedValue({});
  });

  it("freezes revision 1 on first submit and starts the workflow", async () => {
    mockPrisma.adApproval.findUnique.mockResolvedValue(draft);
    mockPrisma.adRevision.count.mockResolvedValue(0);

    const res = await POST(req(), { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.revisionNumber).toBe(1);
    expect(mockPrisma.adRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revisionNumber: 1 }) }),
    );
    expect(mockPrisma.adAIJobQueue.create).toHaveBeenCalled(); // pre-review enqueued
  });

  it("increments the revision number on resubmit", async () => {
    mockPrisma.adApproval.findUnique.mockResolvedValue(draft);
    mockPrisma.adRevision.count.mockResolvedValue(1); // one prior revision

    const res = await POST(req(), { params });
    const body = await res.json();
    expect(body.revisionNumber).toBe(2);
  });

  it("returns 409 on duplicate submission (status no longer draft)", async () => {
    mockPrisma.adApproval.findUnique.mockResolvedValue({ ...draft, status: STATUS.FOR_AI_PRE_REVIEW });

    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
  });

  it("returns 409 (not 500) when a concurrent submit wins the revision unique constraint", async () => {
    mockPrisma.adApproval.findUnique.mockResolvedValue(draft);
    mockPrisma.adRevision.count.mockResolvedValue(0);
    mockPrisma.adRevision.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));

    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
  });

  it("returns 400 when required copy fields are missing", async () => {
    mockPrisma.adApproval.findUnique.mockResolvedValue({ ...draft, draftCopy: { headline: "x" } });
    mockPrisma.adRevision.count.mockResolvedValue(0);

    const res = await POST(req(), { params });
    expect(res.status).toBe(400);
  });
});
