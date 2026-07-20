import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const auth = vi.hoisted(() => ({
  requireAppAuth: vi.fn(),
  requirePermission: vi.fn(),
  getSessionUser: vi.fn(),
}));
const service = vi.hoisted(() => ({
  listBacklogItems: vi.fn(),
  createBacklogItem: vi.fn(),
  mutateBacklogItem: vi.fn(),
  deleteBacklogItem: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: { CONTENT_REVIEW: "content:review" },
  requireAppAuth: auth.requireAppAuth,
  requirePermission: auth.requirePermission,
  getSessionUser: auth.getSessionUser,
}));
vi.mock("@/lib/backlog/service", () => service);

const collection = () => import("@/app/api/backlog/route");
const detail = () => import("@/app/api/backlog/[id]/route");
const context = { params: Promise.resolve({ id: "backlog-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireAppAuth.mockResolvedValue(null);
  auth.requirePermission.mockResolvedValue(null);
  auth.getSessionUser.mockResolvedValue("operator-1");
  service.listBacklogItems.mockResolvedValue({
    items: [],
    counts: { open: 0, completed: 0 },
    asOf: "2026-07-20T00:00:00.000Z",
  });
  service.createBacklogItem.mockResolvedValue({ id: "backlog-1" });
  service.mutateBacklogItem.mockResolvedValue({
    outcome: "updated",
    item: { id: "backlog-1" },
  });
  service.deleteBacklogItem.mockResolvedValue({ outcome: "deleted" });
});

describe("backlog API", () => {
  it("authenticates before reading list parameters", async () => {
    auth.requireAppAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const response = await (await collection()).GET(
      new Request("http://test.local/api/backlog?status=invalid") as never,
    );

    expect(response.status).toBe(401);
    expect(service.listBacklogItems).not.toHaveBeenCalled();
  });

  it("requires permission before parsing a create body", async () => {
    auth.requirePermission.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const response = await (await collection()).POST(new Request(
      "http://test.local/api/backlog",
      { method: "POST", body: "{invalid" },
    ) as never);

    expect(response.status).toBe(403);
    expect(auth.requireAppAuth.mock.invocationCallOrder[0])
      .toBeLessThan(auth.requirePermission.mock.invocationCallOrder[0]!);
    expect(service.createBacklogItem).not.toHaveBeenCalled();
  });

  it("creates a due-dated item and attributes the actor", async () => {
    const response = await (await collection()).POST(new Request(
      "http://test.local/api/backlog",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Recheck Shopify cache",
          description: "Check the canonical article response.",
          dueAt: "2026-07-22T15:59:59.999Z",
        }),
      },
    ) as never);

    expect(response.status).toBe(201);
    expect(service.createBacklogItem).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Recheck Shopify cache" }),
      "operator-1",
    );
  });

  it("supports authenticated update and delete actions", async () => {
    const route = await detail();
    const updated = await route.PATCH(new Request(
      "http://test.local/api/backlog/backlog-1",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "complete", expectedVersion: 1 }),
      },
    ) as never, context);
    expect(updated.status).toBe(200);

    const deleted = await route.DELETE(new Request(
      "http://test.local/api/backlog/backlog-1",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 2 }),
      },
    ) as never, context);
    expect(deleted.status).toBe(200);
    expect(service.deleteBacklogItem).toHaveBeenCalledWith(
      "backlog-1",
      2,
      "operator-1",
    );
  });
});
