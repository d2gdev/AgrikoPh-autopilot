import { beforeEach, describe, expect, it, vi } from "vitest";

const shopify = vi.hoisted(() => ({
  fetch: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/shopify-admin", () => ({
  fetchProductImages: shopify.fetch,
  updateProductMediaAlt: shopify.update,
}));

import {
  applyApprovedImageAltTextRecommendation,
  queueImageAltTextRecommendation,
} from "@/lib/images/alt-text-recommendation";

const input = {
  imageId: "gid://shopify/MediaImage/123",
  productId: "gid://shopify/Product/456",
  altText: "Agriko turmeric tea blend",
  currentAltText: null,
  actor: "operator",
};
const approvedInput = {
  imageId: input.imageId,
  productId: input.productId,
  altText: input.altText,
  currentAltText: input.currentAltText,
};

describe("image alt-text recommendation workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EXECUTE_APPROVED_LIVE_ENABLED", "true");
  });

  it("creates a pending Shopify recommendation from a persisted SEO snapshot", async () => {
    const db: any = {
      rawSnapshot: {
        findFirst: vi.fn().mockResolvedValue({ id: "snapshot-1" }),
      },
      recommendation: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "rec-1" }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };

    const result = await queueImageAltTextRecommendation(db, input);

    expect(result).toEqual({ recommendationId: "rec-1", created: true });
    expect(db.recommendation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        platform: "shopify",
        actionType: "update_product_image_alt_text",
        status: "pending",
        snapshotId: "snapshot-1",
      }),
    });
    expect(shopify.update).not.toHaveBeenCalled();
  });

  it("requires an executing recommendation and the live flag at the mutation boundary", async () => {
    const rec = {
      status: "approved",
      platform: "shopify",
      actionType: "update_product_image_alt_text",
      targetEntityId: input.imageId,
      proposedValue: JSON.stringify(approvedInput),
    } as any;

    await expect(applyApprovedImageAltTextRecommendation(rec)).rejects.toThrow(/executing/i);
    vi.stubEnv("EXECUTE_APPROVED_LIVE_ENABLED", "false");
    await expect(applyApprovedImageAltTextRecommendation({ ...rec, status: "executing" })).rejects.toThrow(/disabled/i);
    expect(shopify.update).not.toHaveBeenCalled();
  });

  it("rejects stale image state before the Shopify mutation", async () => {
    shopify.fetch.mockResolvedValue([{
      imageId: input.imageId,
      productId: input.productId,
      altText: "Already changed",
    }]);

    await expect(applyApprovedImageAltTextRecommendation({
      status: "executing",
      platform: "shopify",
      actionType: "update_product_image_alt_text",
      targetEntityId: input.imageId,
      proposedValue: JSON.stringify(approvedInput),
    } as any)).rejects.toThrow(/changed/i);
    expect(shopify.update).not.toHaveBeenCalled();
  });

  it("applies the exact approved alt text after revalidating current state", async () => {
    shopify.fetch.mockResolvedValue([{
      imageId: input.imageId,
      productId: input.productId,
      altText: null,
    }]);
    shopify.update.mockResolvedValue({ id: input.imageId, alt: input.altText });

    const result = await applyApprovedImageAltTextRecommendation({
      status: "executing",
      platform: "shopify",
      actionType: "update_product_image_alt_text",
      targetEntityId: input.imageId,
      proposedValue: JSON.stringify(approvedInput),
    } as any);

    expect(shopify.update).toHaveBeenCalledWith(input.productId, input.imageId, input.altText);
    expect(result).toMatchObject({ imageId: input.imageId, altText: input.altText });
  });
});
