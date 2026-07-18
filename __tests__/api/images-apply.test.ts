import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mockUpdateAlt = vi.hoisted(() => vi.fn());
const mockPermission = vi.hoisted(() => vi.fn());
const mockQueue = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({}));

vi.mock("@/lib/shopify-admin", () => ({
  fetchProductImages: vi.fn().mockResolvedValue([]),
  updateProductMediaAlt: mockUpdateAlt,
}));
vi.mock("@/lib/auth", () => ({
  PERMISSIONS: {
    CONTENT_REVIEW: "content:review",
    CONTENT_PUBLISH: "content:publish",
  },
  requireAppAuth: vi.fn().mockResolvedValue(null),
  requirePermission: mockPermission,
  getSessionShop: vi.fn().mockResolvedValue("agrikoph.myshopify.com"),
  getSessionUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn().mockReturnValue(true) }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/ai/client", () => ({ getAiClient: vi.fn() }));
vi.mock("@/lib/images/alt-text-recommendation", () => ({
  queueImageAltTextRecommendation: mockQueue,
}));

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
  currentAltText: null,
};

describe("PATCH /api/images (apply alt text)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPermission.mockResolvedValue(null);
    mockQueue.mockResolvedValue({ recommendationId: "rec-1", created: true });
    mockUpdateAlt.mockResolvedValue({ id: VALID.imageId, alt: VALID.altText });
  });

  it("queues an approval record without writing directly to Shopify", async () => {
    const res = await PATCH(request(VALID));
    expect(res.status).toBe(202);
    expect(mockUpdateAlt).not.toHaveBeenCalled();
    expect(mockQueue).toHaveBeenCalledWith(mockPrisma, expect.objectContaining(VALID));
    const body = await res.json();
    expect(body).toMatchObject({ queued: true, recommendationId: "rec-1" });
  });

  it("requires content publish permission before parsing or queueing", async () => {
    mockPermission.mockResolvedValueOnce(new Response(null, { status: 403 }));

    const res = await PATCH(request(VALID));

    expect(res.status).toBe(403);
    expect(mockPermission).toHaveBeenCalledWith(expect.any(Request), "content:publish");
    expect(mockQueue).not.toHaveBeenCalled();
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

  it("returns 409 when no recommendation evidence snapshot is available", async () => {
    mockQueue.mockRejectedValueOnce(new Error("No SEO evidence snapshot is available"));
    const res = await PATCH(request(VALID));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/evidence snapshot/i);
  });
});
