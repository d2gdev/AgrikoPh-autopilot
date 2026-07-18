import type { Recommendation } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  fetchProductImages,
  updateProductMediaAlt,
} from "@/lib/shopify-admin";

const ApprovedImageAltText = z.object({
  imageId: z.string().startsWith("gid://shopify/").max(100),
  productId: z.string().startsWith("gid://shopify/Product/").max(100),
  altText: z.string().trim().min(1).max(125),
  currentAltText: z.string().max(125).nullable(),
}).strict();

type Db = typeof prisma;
type QueueInput = z.infer<typeof ApprovedImageAltText> & { actor: string };

export async function queueImageAltTextRecommendation(
  db: Db,
  input: QueueInput,
): Promise<{ recommendationId: string; created: boolean }> {
  const { actor, ...candidate } = input;
  const proposed = ApprovedImageAltText.parse(candidate);
  const proposedValue = JSON.stringify(proposed);
  const snapshot = await db.rawSnapshot.findFirst({
    where: { source: "seo_analysis" },
    orderBy: { fetchedAt: "desc" },
    select: { id: true },
  });
  if (!snapshot) throw new Error("No SEO evidence snapshot is available");

  const existing = await db.recommendation.findFirst({
    where: {
      platform: "shopify",
      actionType: "update_product_image_alt_text",
      targetEntityId: proposed.imageId,
      proposedValue,
      status: { in: ["pending", "approved", "override_approved", "executing"] },
    },
    select: { id: true },
  });
  if (existing) return { recommendationId: existing.id, created: false };

  const recommendation = await db.recommendation.create({
    data: {
      platform: "shopify",
      skillId: "image-alt-text",
      skillName: "Image alt-text review",
      actionType: "update_product_image_alt_text",
      targetEntityType: "product_image",
      targetEntityId: proposed.imageId,
      targetEntityName: proposed.imageId,
      currentValue: proposed.currentAltText,
      proposedValue,
      rationale: "Apply the exact generated alt text after operator approval.",
      guardStatus: "clear",
      status: "pending",
      snapshotId: snapshot.id,
    },
  });
  await db.auditLog.create({
    data: {
      actor,
      action: "image_alt_text_queued",
      entityType: "product_image",
      entityId: proposed.imageId,
      before: { altText: proposed.currentAltText },
      after: { altText: proposed.altText, recommendationId: recommendation.id },
    },
  });
  return { recommendationId: recommendation.id, created: true };
}

export async function applyApprovedImageAltTextRecommendation(
  recommendation: Recommendation,
): Promise<Record<string, unknown>> {
  if (recommendation.platform !== "shopify"
    || recommendation.actionType !== "update_product_image_alt_text"
    || recommendation.status !== "executing") {
    throw new Error("Image alt-text recommendation must be executing");
  }
  if (process.env.EXECUTE_APPROVED_LIVE_ENABLED !== "true") {
    throw new Error("Live Shopify execution is disabled");
  }

  let proposed: z.infer<typeof ApprovedImageAltText>;
  try {
    proposed = ApprovedImageAltText.parse(
      JSON.parse(recommendation.proposedValue ?? "null"),
    );
  } catch {
    throw new Error("Approved image alt-text payload is invalid");
  }
  if (proposed.imageId !== recommendation.targetEntityId) {
    throw new Error("Approved image identity does not match the recommendation");
  }

  const current = (await fetchProductImages()).find((image) =>
    image.imageId === proposed.imageId && image.productId === proposed.productId);
  if (!current) throw new Error("Approved Shopify image no longer exists");
  if ((current.altText ?? null) !== proposed.currentAltText) {
    throw new Error("Shopify image alt text changed after approval");
  }

  const updated = await updateProductMediaAlt(
    proposed.productId,
    proposed.imageId,
    proposed.altText,
  );
  return {
    productId: proposed.productId,
    imageId: proposed.imageId,
    altText: updated.alt ?? proposed.altText,
  };
}
