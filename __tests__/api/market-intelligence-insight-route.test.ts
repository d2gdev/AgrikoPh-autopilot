import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ app: vi.fn() }));
const db = vi.hoisted(() => ({ marketInsight: { updateMany: vi.fn() } }));

vi.mock("@/lib/auth", () => ({ requireAppAuth: auth.app }));
vi.mock("@/lib/db", () => ({ prisma: db }));

beforeEach(() => {
  vi.clearAllMocks();
  auth.app.mockResolvedValue(null);
});

describe("PATCH /api/market-intelligence/insights/[id]", () => {
  it("resolves only an open insight", async () => {
    db.marketInsight.updateMany.mockResolvedValue({ count: 1 });
    const { PATCH } = await import("@/app/api/market-intelligence/insights/[id]/route");
    const response = await PATCH(new Request("http://test.local/api/market-intelligence/insights/insight-1", { method: "PATCH" }), {
      params: Promise.resolve({ id: "insight-1" }),
    });

    expect(response.status).toBe(200);
    expect(db.marketInsight.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "insight-1", status: "open" },
      data: expect.objectContaining({ status: "resolved", resolvedAt: expect.any(Date) }),
    }));
  });
});
