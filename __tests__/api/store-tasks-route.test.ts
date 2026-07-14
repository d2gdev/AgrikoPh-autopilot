import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ app: vi.fn(), shop: vi.fn() }));
const db = vi.hoisted(() => ({ storeTask: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn() }, opportunity: { updateMany: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ requireAppAuth: auth.app, getSessionShop: auth.shop }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/store-tasks/route-opportunities", () => ({ routeOpenStoreTaskOpportunities: vi.fn() }));
const source = { source: "topical-map", strategyVersionId: "v1", packageSha256: "a".repeat(64), ruleIds: ["r1"], ruleDomains: ["content_decisions"], targetType: "product", targetUrl: "/products/rice", observedAt: "2026-07-13T00:00:00.000Z", observedStateHash: "b".repeat(64), executable: true };
const proposed = { action: "seo_update", before: { seoTitle: "Old" }, after: { seoTitle: "New" } };
const request = (status: string, completionNote?: string) => new Request("http://test.local/api/store-tasks", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "task-1", status, completionNote }) });
beforeEach(() => { vi.clearAllMocks(); auth.app.mockResolvedValue(null); auth.shop.mockResolvedValue("actor"); db.storeTask.update.mockImplementation(async ({ data }) => ({ id: "task-1", opportunityId: null, ...data })); });

const listRow = {
  id: "task-1",
  createdAt: new Date("2026-07-13T00:00:00.000Z"),
  taskType: "topical_map",
  targetType: "product",
  targetId: "product-1",
  targetUrl: "/products/rice",
  title: "Canonical review",
  description: "Review canonical evidence",
  proposedState: { action: "advisory", advisory: "canonicalization_execution_prohibited" },
  sourceData: { ...source, executable: false },
  priority: "high",
  status: "pending",
  completedAt: null,
  completionNote: null,
};

describe("Store Task GET inventory", () => {
  beforeEach(() => {
    db.storeTask.count.mockResolvedValue(704);
    db.storeTask.findMany.mockResolvedValue([listRow]);
  });

  it.each(["page=0", "page=x", "pageSize=0", "pageSize=101", "executionClass=unknown"])(
    "rejects invalid query %s before Prisma",
    async (query) => {
      const response = await (await import("@/app/api/store-tasks/route")).GET(
        new Request(`http://test.local/api/store-tasks?${query}`),
      );

      expect(response.status).toBe(400);
      expect(db.storeTask.count).not.toHaveBeenCalled();
      expect(db.storeTask.findMany).not.toHaveBeenCalled();
    },
  );

  it("uses the same where clause for count and page data", async () => {
    const response = await (await import("@/app/api/store-tasks/route")).GET(
      new Request("http://test.local/api/store-tasks?status=pending&executionClass=advisory&q=canonical&page=2&pageSize=50"),
    );
    const expectedWhere = {
      status: "pending",
      AND: [
        { sourceData: { path: ["source"], equals: "topical-map" } },
        { sourceData: { path: ["executable"], equals: false } },
      ],
      OR: [
        { title: { contains: "canonical", mode: "insensitive" } },
        { targetUrl: { contains: "canonical", mode: "insensitive" } },
        { description: { contains: "canonical", mode: "insensitive" } },
      ],
    };

    expect(db.storeTask.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(db.storeTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expectedWhere,
      skip: 50,
      take: 50,
    }));
    await expect(response.json()).resolves.toEqual({
      tasks: expect.any(Array),
      total: 704,
      page: 2,
      pageSize: 50,
      hasMore: true,
    });
  });

  it("authenticates before parsing or accessing Prisma", async () => {
    const authFailure = Response.json({ error: "Unauthorized" }, { status: 401 });
    auth.app.mockResolvedValue(authFailure);
    const req = { get url(): string { throw new Error("query parsed before auth"); } } as Request;

    const response = await (await import("@/app/api/store-tasks/route")).GET(req);

    expect(response).toBe(authFailure);
    expect(db.storeTask.count).not.toHaveBeenCalled();
    expect(db.storeTask.findMany).not.toHaveBeenCalled();
  });

  it("returns a safe JSON 500 when a persisted row violates the DTO boundary", async () => {
    db.storeTask.findMany.mockResolvedValue([{ ...listRow, title: "x".repeat(501) }]);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await (await import("@/app/api/store-tasks/route")).GET(
      new Request("http://test.local/api/store-tasks"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Internal server error" });
    expect(error).toHaveBeenCalledWith("[store-tasks] invalid list DTO:", "task-1");
    error.mockRestore();
  });

  it("does not let a valid persisted redirect make the task list fail", async () => {
    db.storeTask.findMany.mockResolvedValue([listRow, {
      ...listRow,
      id: "redirect-1",
      targetType: "redirect",
      targetId: null,
      targetUrl: "/old-rice",
      sourceData: { ...source, targetType: "redirect", targetUrl: "/old-rice", action: "redirect_create", redirectTarget: "/products/rice" },
      proposedState: { action: "redirect_create", before: { state: "absent" }, after: { target: "/products/rice" } },
    }]);

    const response = await (await import("@/app/api/store-tasks/route")).GET(new Request("http://test.local/api/store-tasks"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ tasks: [{ id: "task-1" }, { id: "redirect-1", proposedState: { after: { target: "/products/rice" } } }] });
  });
});

describe("legacy Store Task PATCH", () => {
  it("requires completion evidence before closing a manually completed task", async () => {
    db.storeTask.findUnique.mockResolvedValue({ id: "task-1", status: "pending", taskType: "ordinary", sourceData: {}, proposedState: {} });
    const response = await (await import("@/app/api/store-tasks/route")).PATCH(request("completed"));
    expect(response.status).toBe(400);
    expect(db.storeTask.update).not.toHaveBeenCalled();
  });
  it("blocks manual completion of executable topical-map tasks", async () => {
    db.storeTask.findUnique.mockResolvedValue({ id: "task-1", status: "pending", taskType: "topical_map", sourceData: source, proposedState: proposed });
    const response = await (await import("@/app/api/store-tasks/route")).PATCH(request("completed"));
    expect(response.status).toBe(409); expect(db.storeTask.update).not.toHaveBeenCalled();
  });
  it("blocks manual completion when executable topical-map source details are malformed", async () => {
    db.storeTask.findUnique.mockResolvedValue({ id: "task-1", status: "pending", taskType: "ordinary", sourceData: { source: "topical-map", executable: true, malformed: true }, proposedState: {} });
    const response = await (await import("@/app/api/store-tasks/route")).PATCH(request("completed"));
    expect(response.status).toBe(409);
    expect(db.storeTask.update).not.toHaveBeenCalled();
  });
  it.each([["dismissed", { taskType: "topical_map", sourceData: source, proposedState: proposed }], ["completed", { taskType: "ordinary", sourceData: {}, proposedState: {} }]])("preserves %s behavior where allowed", async (status, extra) => {
    db.storeTask.findUnique.mockResolvedValue({ id: "task-1", status: "pending", ...extra });
    const response = await (await import("@/app/api/store-tasks/route")).PATCH(request(status, status === "completed" ? "Verified in Shopify Admin" : undefined));
    expect(response.status).toBe(200); expect(db.storeTask.update).toHaveBeenCalled();
  });
});

describe("Store Task detail GET", () => {
  it("returns a persisted create-only redirect through the strict detail DTO", async () => {
    db.storeTask.findUnique.mockResolvedValue({
      id: "redirect-1", targetUrl: "/old-rice", status: "pending", completionNote: null,
      sourceData: { ...source, targetType: "redirect", targetUrl: "/old-rice", action: "redirect_create", redirectTarget: "/products/rice" },
      proposedState: { action: "redirect_create", before: { state: "absent" }, after: { target: "/products/rice" } },
    });
    const response = await (await import("@/app/api/store-tasks/[id]/route")).GET(
      new Request("http://test.local/api/store-tasks/redirect-1"),
      { params: Promise.resolve({ id: "redirect-1" }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ task: { id: "redirect-1", targetUrl: "/old-rice", proposedState: { after: { target: "/products/rice" } } } });
  });
});
