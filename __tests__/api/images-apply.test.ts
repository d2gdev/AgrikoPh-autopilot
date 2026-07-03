import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mockUpdateAlt = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({ auditLog: { create: vi.fn().mockResolvedValue({}) } }));

vi.mock("@/lib/shopify-admin", () => ({
  fetchProductImages: vi.fn().mockResolvedValue([]),
  updateProductMediaAlt: mockUpdateAlt,
}));
vi.mock("@/lib/auth", () => ({
  requireAppAuth: vi.fn().mockResolvedValue(null),
  getSessionShop: vi.fn().mockResolvedValue("agrikoph.myshopify.com"),
  getSessionUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn().mockReturnValue(true) }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/ai/client", () => ({ getAiClient: vi.fn() }));

import { PATCH } from "@/app/api/images/route";

function request(body: unknown) {
  return new Request("http://test.local/api/images", {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const VALID = {
  imageId: "gid://shopify/MediaImage/123",
  productId: "gid://shopify/Product/456",
  altText: "Agriko turmeric tea blend in resealable pouch",
};

describe("PATCH /api/images (apply alt text)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockUpdateAlt.mockResolvedValue({ id: VALID.imageId, alt: VALID.altText });
  });

  it("applies alt text to Shopify and audit-logs the write", async () => {
    const res = await PATCH(request(VALID));
    expect(res.status).toBe(200);
    expect(mockUpdateAlt).toHaveBeenCalledWith(VALID.productId, VALID.imageId, VALID.altText);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "image_alt_text_applied",
        entityId: VALID.imageId,
      }),
    });
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, imageId: VALID.imageId });
  });

  it("rejects non-Shopify GIDs", async () => {
    const res = await PATCH(request({ ...VALID, productId: "456" }));
    expect(res.status).toBe(400);
    expect(mockUpdateAlt).not.toHaveBeenCalled();
  });

  it("rejects empty or over-length alt text", async () => {
    expect((await PATCH(request({ ...VALID, altText: "  " }))).status).toBe(400);
    expect((await PATCH(request({ ...VALID, altText: "x".repeat(126) }))).status).toBe(400);
  });

  it("returns 502 when Shopify rejects the mutation", async () => {
    mockUpdateAlt.mockRejectedValueOnce(new Error("Media not found"));
    const res = await PATCH(request(VALID));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Media not found/);
  });
});
