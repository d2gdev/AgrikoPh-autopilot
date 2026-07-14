import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const auth = vi.hoisted(() => ({ app: vi.fn(), permission: vi.fn(), user: vi.fn() }));
const db = vi.hoisted(() => ({
  storeTask: { findUnique: vi.fn() },
  recommendation: { findFirst: vi.fn() },
}));
const executor = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAppAuth: auth.app,
  requirePermission: auth.permission,
  getSessionUser: auth.user,
  PERMISSIONS: { CONTENT_PUBLISH: "content:publish" },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/jobs/execute-approved", () => ({ executeApprovedHandler: executor.run }));

const source = {
  source: "topical-map", strategyVersionId: "v1", packageSha256: "a".repeat(64), ruleIds: ["rule-1"],
  ruleDomains: ["content_decisions"], sourceReferences: [{ kind: "rule", id: "rule-1" }],
  generationProvenance: "bounded_ai_draft", targetType: "product", targetUrl: "/products/rice",
  action: "seo_update", observedAt: "2026-07-13T00:00:00.000Z", observedStateHash: "b".repeat(64),
  recommendationId: "rec-1", executable: true,
};
const request = () => new Request("http://test.local/api/store-tasks/task-1/execute", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  db.storeTask.findUnique.mockReset();
  auth.app.mockResolvedValue(null); auth.permission.mockResolvedValue(null); auth.user.mockResolvedValue("operator-1");
  db.storeTask.findUnique.mockResolvedValueOnce({ id: "task-1", sourceData: source }).mockResolvedValueOnce({ id: "task-1", status: "completed", completionNote: "Shopify update verified." });
  db.recommendation.findFirst.mockResolvedValue({ id: "rec-1" });
  executor.run.mockResolvedValue({ runId: "run-1", status: "success", summary: { considered: 1, dryRun: false }, errors: [] });
});

async function post() {
  const route = await import("@/app/api/store-tasks/[id]/execute/route");
  return route.POST(request(), { params: Promise.resolve({ id: "task-1" }) });
}

describe("Store Task exact execution route", () => {
  it("authenticates before permission and all other boundaries", async () => {
    auth.app.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const response = await post();
    expect(response.status).toBe(401); expect(auth.permission).not.toHaveBeenCalled(); expect(db.storeTask.findUnique).not.toHaveBeenCalled(); expect(executor.run).not.toHaveBeenCalled();
  });

  it("checks CONTENT_PUBLISH before params, Prisma, or dispatch", async () => {
    auth.permission.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const params = { then: vi.fn() } as any;
    const route = await import("@/app/api/store-tasks/[id]/execute/route");
    const response = await route.POST(request(), { params });
    expect(response.status).toBe(403); expect(auth.permission).toHaveBeenCalledWith(expect.any(Request), "content:publish"); expect(params.then).not.toHaveBeenCalled(); expect(db.storeTask.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    [null],
    [{ id: "task-1", sourceData: { arbitrary: "browser bytes" } }],
  ])("returns a safe conflict for missing or malformed task linkage", async (task) => {
    db.storeTask.findUnique.mockReset().mockResolvedValue(task);
    const response = await post();
    expect(response.status).toBe(409); expect(executor.run).not.toHaveBeenCalled();
  });

  it("requires the exact approved Shopify recommendation linkage", async () => {
    db.recommendation.findFirst.mockResolvedValue(null);
    const response = await post();
    expect(response.status).toBe(409);
    expect(db.recommendation.findFirst).toHaveBeenCalledWith({ where: {
      id: "rec-1", targetEntityId: "task-1", platform: "shopify", actionType: "apply_topical_map_store_task",
      status: { in: ["approved", "override_approved"] },
    }, select: { id: true } });
    expect(executor.run).not.toHaveBeenCalled();
  });

  it("dispatches only the linked recommendation and returns a bounded refreshed task", async () => {
    const response = await post();
    expect(executor.run).toHaveBeenCalledTimes(1);
    expect(executor.run).toHaveBeenCalledWith({ liveRequested: true, triggeredBy: "store-pilot:operator-1", recommendationId: "rec-1" });
    expect(await response.json()).toEqual({ runId: "run-1", status: "success", summary: { considered: 1, dryRun: false }, errors: [], task: { id: "task-1", status: "completed", completionNote: "Shopify update verified." } });
  });

  it("returns 409 when the approved claim is lost before dispatch", async () => {
    executor.run.mockResolvedValue({ runId: "run-1", status: "success", summary: { considered: 0, dryRun: false }, errors: [] });
    const response = await post();
    expect(response.status).toBe(409);
  });
});
