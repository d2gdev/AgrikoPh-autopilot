import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ app: vi.fn(), permission: vi.fn(), user: vi.fn() }));
const tx = vi.hoisted(() => ({ marketInsight: { updateMany: vi.fn() }, auditLog: { create: vi.fn() } }));
const db = vi.hoisted(() => ({ $transaction: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: { CONTENT_REVIEW: "content:review" },
  requireAppAuth: auth.app,
  requirePermission: auth.permission,
  getSessionUser: auth.user,
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

beforeEach(() => {
  vi.clearAllMocks();
  auth.app.mockResolvedValue(null);
  auth.permission.mockResolvedValue(null);
  auth.user.mockResolvedValue("owner@agrikoph.com");
  db.$transaction.mockImplementation((callback: (client: typeof tx) => unknown) => callback(tx));
  tx.marketInsight.updateMany.mockResolvedValue({ count: 1 });
  tx.auditLog.create.mockResolvedValue({ id: "audit-1" });
});

function request(reason?: string) {
  return new Request("http://test.local/api/market-intelligence/insights/insight-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(reason === undefined ? {} : { reason }),
  });
}

describe("PATCH /api/market-intelligence/insights/[id]", () => {
  it("requires an operator-entered resolution reason", async () => {
    const { PATCH } = await import("@/app/api/market-intelligence/insights/[id]/route");
    const response = await PATCH(request(), { params: Promise.resolve({ id: "insight-1" }) });

    expect(response.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("checks review permission before resolving", async () => {
    const denied = new Response("forbidden", { status: 403 });
    auth.permission.mockResolvedValue(denied);
    const { PATCH } = await import("@/app/api/market-intelligence/insights/[id]/route");
    const response = await PATCH(request("Not relevant to the current strategy"), { params: Promise.resolve({ id: "insight-1" }) });

    expect(response).toBe(denied);
    expect(auth.permission).toHaveBeenCalledWith(expect.any(Request), "content:review");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("atomically resolves an open insight and records the authenticated actor and reason", async () => {
    const { PATCH } = await import("@/app/api/market-intelligence/insights/[id]/route");
    const response = await PATCH(request("Handled in the July content plan"), { params: Promise.resolve({ id: "insight-1" }) });

    expect(response.status).toBe(200);
    expect(tx.marketInsight.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "insight-1", status: "open" },
      data: expect.objectContaining({ status: "resolved", resolvedAt: expect.any(Date) }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actor: "owner@agrikoph.com",
      action: "market_insight_resolved",
      entityId: "insight-1",
      meta: { reason: "Handled in the July content plan" },
    }) });
  });
});
