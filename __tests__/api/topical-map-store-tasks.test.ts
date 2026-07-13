import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const auth = vi.hoisted(() => ({ app: vi.fn(), permission: vi.fn(), user: vi.fn(), shop: vi.fn() }));
const service = vi.hoisted(() => ({ sync: vi.fn(), apply: vi.fn() }));
const rate = vi.hoisted(() => vi.fn());
const db = vi.hoisted(() => ({}));
vi.mock("@/lib/auth", () => ({ requireAppAuth: auth.app, requirePermission: auth.permission, getSessionUser: auth.user, getSessionShop: auth.shop, PERMISSIONS: { CONTENT_REVIEW: "content:review", CONTENT_PUBLISH: "content:publish" } }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: rate }));
vi.mock("@/lib/store-tasks/topical-map", () => ({ syncTopicalMapStoreTasks: service.sync }));
vi.mock("@/lib/store-tasks/apply-topical-map", () => ({ applyTopicalMapStoreTask: service.apply, TopicalMapApplyError: class extends Error { constructor(public code: string) { super(code); } } }));
const request = (path: string) => new Request(`http://test.local${path}`, { method: "POST" });

beforeEach(() => { vi.clearAllMocks(); auth.app.mockResolvedValue(null); auth.permission.mockResolvedValue(null); auth.user.mockResolvedValue("actor-1"); auth.shop.mockResolvedValue("shop"); rate.mockReturnValue(true); });

describe("topical-map Store Task routes", () => {
  it.each([["sync", () => import("@/app/api/store-tasks/topical-map/sync/route")], ["apply", () => import("@/app/api/store-tasks/[id]/apply/route")]])("authenticates before permission and all boundaries for %s", async (name, load) => {
    auth.app.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const route = await load(); const response = name === "sync" ? await (route.POST as any)(request("/sync")) : await route.POST(request("/task-1/apply"), { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(401); expect(auth.permission).not.toHaveBeenCalled(); expect(service.sync).not.toHaveBeenCalled(); expect(service.apply).not.toHaveBeenCalled();
  });

  it.each([["sync", () => import("@/app/api/store-tasks/topical-map/sync/route")], ["apply", () => import("@/app/api/store-tasks/[id]/apply/route")]])("stops on permission denial before downstream boundaries for %s", async (name, load) => {
    auth.permission.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const route = await load();
    const response = name === "sync"
      ? await (route.POST as any)(request("/sync"))
      : await route.POST(request("/task-1/apply"), { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(403);
    expect(service.sync).not.toHaveBeenCalled();
    expect(service.apply).not.toHaveBeenCalled();
    expect(rate).not.toHaveBeenCalled();
  });

  it("checks CONTENT_REVIEW, rate limits by actor, and returns synchronization unchanged", async () => {
    const summary = { executable: 1, advisory: 2, unchanged: 3, suppressed: 4 }; service.sync.mockResolvedValue(summary);
    const response = await (await import("@/app/api/store-tasks/topical-map/sync/route")).POST(request("/sync"));
    expect(auth.app.mock.invocationCallOrder[0]).toBeLessThan(auth.permission.mock.invocationCallOrder[0]!);
    expect(auth.permission).toHaveBeenCalledWith(expect.any(Request), "content:review"); expect(rate).toHaveBeenCalledWith("topical-map-store-task-sync:actor-1", 5, 60_000);
    expect(await response.json()).toEqual(summary);
  });

  it("applies only the route id with CONTENT_PUBLISH and maps typed failures safely", async () => {
    service.apply.mockRejectedValue(Object.assign(new Error("source bytes"), { code: "OBSERVATION_CHANGED" }));
    const response = await (await import("@/app/api/store-tasks/[id]/apply/route")).POST(request("/task-1/apply"), { params: Promise.resolve({ id: "task-1" }) });
    expect(auth.permission).toHaveBeenCalledWith(expect.any(Request), "content:publish");
    expect(service.apply).toHaveBeenCalledWith(db, { id: "task-1", actor: "actor-1" });
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "The task no longer matches the current store observation.", code: "OBSERVATION_CHANGED" });
  });
});
