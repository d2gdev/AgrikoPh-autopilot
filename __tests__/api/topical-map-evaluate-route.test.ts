import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const auth = vi.hoisted(() => ({ requireAppAuth: vi.fn(), requirePermission: vi.fn() }));
const db = vi.hoisted(() => ({ topicalMapActivation: { findUnique: vi.fn() } }));

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: { CONTENT_REVIEW: "content:review" },
  requireAppAuth: auth.requireAppAuth,
  requirePermission: auth.requirePermission,
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

const evaluate = () => import("@/app/api/topical-map/evaluate/route");
const request = (body: unknown) => new Request("http://test.local/api/topical-map/evaluate", { method: "POST", body: JSON.stringify(body) });

describe("topical-map evaluation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireAppAuth.mockResolvedValue(null);
    auth.requirePermission.mockResolvedValue(null);
    db.topicalMapActivation.findUnique.mockResolvedValue(null);
  });

  it("authenticates and authorizes before parsing or strategy access", async () => {
    auth.requirePermission.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const req = request({ type: "redirect", fromUrl: "/old", toUrl: "/new" });

    const response = await (await evaluate()).POST(req as never);

    expect(response.status).toBe(403);
    expect(auth.requireAppAuth.mock.invocationCallOrder[0]).toBeLessThan(auth.requirePermission.mock.invocationCallOrder[0]!);
    expect(db.topicalMapActivation.findUnique).not.toHaveBeenCalled();
  });

  it("returns a safe evidence-only unavailable result without raw strategy bytes", async () => {
    const response = await (await evaluate()).POST(request({ type: "redirect", fromUrl: "/old", toUrl: "/new" }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ proposalOnly: true, executionAuthorized: false, compliance: { result: "unavailable_strategy", packageIdentity: null } });
    expect(JSON.stringify(body)).not.toContain("rawContent");
  });

  it("rejects prose-only candidate fields without evaluating a strategy", async () => {
    const response = await (await evaluate()).POST(request({ type: "redirect", fromUrl: "/old", toUrl: "/new", description: "Please infer the owner" }) as never);

    expect(response.status).toBe(400);
    expect(db.topicalMapActivation.findUnique).not.toHaveBeenCalled();
  });
});
