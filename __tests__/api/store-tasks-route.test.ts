import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ app: vi.fn(), shop: vi.fn() }));
const db = vi.hoisted(() => ({ storeTask: { findUnique: vi.fn(), update: vi.fn() }, opportunity: { updateMany: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ requireAppAuth: auth.app, getSessionShop: auth.shop }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/store-tasks/route-opportunities", () => ({ routeOpenStoreTaskOpportunities: vi.fn() }));
const source = { source: "topical-map", strategyVersionId: "v1", packageSha256: "a".repeat(64), ruleIds: ["r1"], ruleDomains: ["content_decisions"], targetType: "product", targetUrl: "/products/rice", observedAt: "2026-07-13T00:00:00.000Z", observedStateHash: "b".repeat(64), executable: true };
const proposed = { action: "seo_update", before: { seoTitle: "Old" }, after: { seoTitle: "New" } };
const request = (status: string) => new Request("http://test.local/api/store-tasks", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "task-1", status }) });
beforeEach(() => { vi.clearAllMocks(); auth.app.mockResolvedValue(null); auth.shop.mockResolvedValue("actor"); db.storeTask.update.mockImplementation(async ({ data }) => ({ id: "task-1", opportunityId: null, ...data })); });

describe("legacy Store Task PATCH", () => {
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
    const response = await (await import("@/app/api/store-tasks/route")).PATCH(request(status));
    expect(response.status).toBe(200); expect(db.storeTask.update).toHaveBeenCalled();
  });
});
