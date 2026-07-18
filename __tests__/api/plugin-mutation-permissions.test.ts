import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  app: vi.fn(),
  permission: vi.fn(),
}));
const prisma = vi.hoisted(() => ({
  storeTask: { findUnique: vi.fn(), update: vi.fn() },
  opportunity: { update: vi.fn(), updateMany: vi.fn() },
}));
const operations = vi.hoisted(() => ({
  routeStoreTasks: vi.fn(),
  generate: vi.fn(),
  routeAll: vi.fn(),
  routeOne: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAppAuth: auth.app,
  requirePermission: auth.permission,
  getSessionShop: vi.fn(),
  PERMISSIONS: { CONTENT_REVIEW: "content:review" },
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/store-tasks/route-opportunities", () => ({
  routeOpenStoreTaskOpportunities: operations.routeStoreTasks,
}));
vi.mock("@/lib/store-tasks/dto", () => ({ toStoreTaskListDto: vi.fn() }));
vi.mock("@/lib/opportunities/generate", () => ({
  generateAllOpportunities: operations.generate,
}));
vi.mock("@/lib/opportunities/route", () => ({
  routeOpenOpportunities: operations.routeAll,
  routeOpportunity: operations.routeOne,
}));

describe("plugin mutation permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.app.mockResolvedValue(null);
    auth.permission.mockResolvedValue(new Response(null, { status: 403 }));
  });

  it("blocks Store Task routing and status mutations without content review", async () => {
    const route = await import("@/app/api/store-tasks/route");

    expect((await route.POST(new Request("http://test.local/api/store-tasks", { method: "POST" }))).status).toBe(403);
    expect((await route.PATCH(new Request("http://test.local/api/store-tasks", {
      method: "PATCH",
      body: JSON.stringify({ id: "task-1", status: "dismissed" }),
    }))).status).toBe(403);
    expect(operations.routeStoreTasks).not.toHaveBeenCalled();
    expect(prisma.storeTask.findUnique).not.toHaveBeenCalled();
  });

  it("blocks Opportunity generation, routing, and status mutations without content review", async () => {
    const list = await import("@/app/api/opportunities/route");
    const detail = await import("@/app/api/opportunities/[id]/route");
    const context = { params: Promise.resolve({ id: "opportunity-1" }) };

    expect((await list.POST(new Request("http://test.local/api/opportunities", { method: "POST" }))).status).toBe(403);
    expect((await detail.PATCH(new Request("http://test.local/api/opportunities/opportunity-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "route" }),
    }), context)).status).toBe(403);
    expect((await detail.POST(new Request("http://test.local/api/opportunities/opportunity-1", {
      method: "POST",
      body: JSON.stringify({ action: "dismiss" }),
    }), context)).status).toBe(403);
    expect(operations.generate).not.toHaveBeenCalled();
    expect(operations.routeOne).not.toHaveBeenCalled();
    expect(prisma.opportunity.update).not.toHaveBeenCalled();
  });
});
