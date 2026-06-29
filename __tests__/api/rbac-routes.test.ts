import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mockAuth = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  requireAppAuth: vi.fn(),
  getSessionShop: vi.fn(),
  getSessionUser: vi.fn(),
}));

const mockPrisma = vi.hoisted(() => ({
  apiCredential: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  contentProposal: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: {
    SETTINGS_ADMIN: "settings:admin",
    CONTENT_REVIEW: "content:review",
    CONTENT_PUBLISH: "content:publish",
  },
  requirePermission: mockAuth.requirePermission,
  requireAppAuth: mockAuth.requireAppAuth,
  getSessionShop: mockAuth.getSessionShop,
  getSessionUser: mockAuth.getSessionUser,
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/crypto", () => ({ encrypt: (value: string) => `encrypted:${value}` }));

describe("privileged route RBAC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.requirePermission.mockResolvedValue(
      NextResponse.json({ error: "Forbidden", permission: "settings:admin" }, { status: 403 }),
    );
    mockAuth.requireAppAuth.mockResolvedValue(null);
    mockAuth.getSessionShop.mockResolvedValue("test.myshopify.com");
    mockAuth.getSessionUser.mockResolvedValue("user-123");
    mockPrisma.apiCredential.findUnique.mockResolvedValue(null);
    mockPrisma.apiCredential.upsert.mockResolvedValue({
      key: "SHOPIFY_ADMIN_ACCESS_TOKEN",
      updatedAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedBy: "user-123",
    });
    mockPrisma.contentProposal.findUnique.mockResolvedValue({
      id: "proposal-1",
      status: "pending",
    });
    mockPrisma.contentProposal.update.mockResolvedValue({
      id: "proposal-1",
      status: "approved",
    });
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  it("blocks credential writes when actor lacks settings admin permission", async () => {
    const { POST } = await import("@/app/api/settings/credentials/route");

    const res = await POST(new Request("http://test.local/api/settings/credentials", {
      method: "POST",
      body: JSON.stringify({ key: "SHOPIFY_ADMIN_ACCESS_TOKEN", value: "token" }),
    }) as never);

    expect(res.status).toBe(403);
    expect(mockPrisma.apiCredential.upsert).not.toHaveBeenCalled();
  });

  it("blocks content approval when actor lacks content review permission", async () => {
    const { POST } = await import("@/app/api/content-pilot/proposals/[id]/approve/route");

    const res = await POST(
      new Request("http://test.local/api/content-pilot/proposals/proposal-1/approve", {
        method: "POST",
        body: JSON.stringify({ reviewNote: "ok" }),
      }),
      { params: Promise.resolve({ id: "proposal-1" }) },
    );

    expect(res.status).toBe(403);
    expect(mockPrisma.contentProposal.update).not.toHaveBeenCalled();
  });
});
