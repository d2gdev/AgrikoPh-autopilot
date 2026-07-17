import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const auth = vi.hoisted(() => ({
  requireAppAuth: vi.fn(),
  requirePermission: vi.fn(),
  getSessionUser: vi.fn(),
}));
const service = vi.hoisted(() => ({
  listSeoTasks: vi.fn(),
  createSeoTask: vi.fn(),
  getSeoTaskDetail: vi.fn(),
  mutateSeoTask: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: { CONTENT_REVIEW: "content:review" },
  requireAppAuth: auth.requireAppAuth,
  requirePermission: auth.requirePermission,
  getSessionUser: auth.getSessionUser,
}));
vi.mock("@/lib/seo-tasks/service", () => service);

const collection = () => import("@/app/api/seo/tasks/route");
const detail = () => import("@/app/api/seo/tasks/[id]/route");
const context = (id = "task-1") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireAppAuth.mockResolvedValue(null);
  auth.requirePermission.mockResolvedValue(null);
  auth.getSessionUser.mockResolvedValue("operator-1");
  service.listSeoTasks.mockResolvedValue({
    tasks: [],
    total: 0,
    page: 1,
    pageSize: 25,
    hasMore: false,
    counts: { ready: 0, waiting: 0, scheduled: 0, closed: 0 },
    asOf: "2026-07-18T00:00:00.000Z",
  });
});

describe("GET /api/seo/tasks", () => {
  it("stops at authentication before validation or service access", async () => {
    auth.requireAppAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const response = await (await collection()).GET(new Request("http://test.local/api/seo/tasks?page=invalid") as never);

    expect(response.status).toBe(401);
    expect(service.listSeoTasks).not.toHaveBeenCalled();
  });

  it("rejects invalid queries and delegates valid bounded queries", async () => {
    const route = await collection();
    const invalid = await route.GET(new Request("http://test.local/api/seo/tasks?pageSize=101") as never);
    expect(invalid.status).toBe(400);

    const valid = await route.GET(new Request("http://test.local/api/seo/tasks?bucket=waiting&page=2&pageSize=10") as never);
    expect(valid.status).toBe(200);
    expect(service.listSeoTasks).toHaveBeenCalledWith(expect.objectContaining({
      bucket: "waiting",
      page: 2,
      pageSize: 10,
    }), expect.any(Date));
  });
});

describe("POST /api/seo/tasks", () => {
  it("authorizes before parsing the request body", async () => {
    auth.requirePermission.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const request = new Request("http://test.local/api/seo/tasks", {
      method: "POST",
      body: "{not-json",
    });

    const response = await (await collection()).POST(request as never);

    expect(response.status).toBe(403);
    expect(auth.requireAppAuth.mock.invocationCallOrder[0]).toBeLessThan(auth.requirePermission.mock.invocationCallOrder[0]!);
    expect(service.createSeoTask).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed input and 409 with the existing task ID for duplicates", async () => {
    const route = await collection();
    const malformed = await route.POST(new Request("http://test.local/api/seo/tasks", {
      method: "POST",
      body: "{}",
    }) as never);
    expect(malformed.status).toBe(400);

    service.createSeoTask.mockResolvedValueOnce({ outcome: "duplicate", existingId: "existing-1" });
    const response = await route.POST(new Request("http://test.local/api/seo/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskType: "other",
        title: "Review",
        description: "Review description",
        priority: "P2",
        earliestReviewAt: "2026-08-01T00:00:00.000Z",
        requiresEvidence: false,
        evidenceRequirement: {},
        evidenceStatus: "not_required",
        sourceType: "operator",
        sourceKey: "review-1",
        sourceData: {},
      }),
    }) as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "An SEO task with the same identity already exists.",
      existingId: "existing-1",
    });
  });
});

describe("detail route", () => {
  it("returns 404 for a missing task", async () => {
    service.getSeoTaskDetail.mockResolvedValue(null);
    const response = await (await detail()).GET(
      new Request("http://test.local/api/seo/tasks/missing") as never,
      context("missing"),
    );
    expect(response.status).toBe(404);
  });

  it("maps optimistic conflicts and invalid transitions to 409", async () => {
    const route = await detail();
    service.mutateSeoTask.mockResolvedValueOnce({ outcome: "conflict" });
    const conflict = await route.PATCH(new Request("http://test.local/api/seo/tasks/task-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel", expectedVersion: 1, note: "Superseded." }),
    }) as never, context());
    expect(conflict.status).toBe(409);

    service.mutateSeoTask.mockResolvedValueOnce({
      outcome: "invalid_transition",
      message: "Closed SEO tasks cannot be changed or reopened.",
    });
    const invalid = await route.PATCH(new Request("http://test.local/api/seo/tasks/task-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "edit", expectedVersion: 1, fields: { title: "Changed" } }),
    }) as never, context());
    expect(invalid.status).toBe(409);
  });
});
