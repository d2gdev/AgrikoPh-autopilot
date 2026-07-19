import type { Recommendation } from "@prisma/client";

const SUPPORTED_ACTIONS: Record<string, readonly string[]> = {
  meta: ["pause_campaign", "pause_ad", "adjust_budget"],
  shopify: [
    "apply_topical_map_store_task",
    "remove_homepage_offer_catalog",
    "update_product_image_alt_text",
  ],
};

export function isSupportedAction(platform: string, actionType: string): boolean {
  const supported = SUPPORTED_ACTIONS[platform];
  return supported !== undefined && supported.includes(actionType);
}

export async function executeRecommendation(rec: Recommendation): Promise<Record<string, unknown>> {
  if (rec.platform === "meta") {
    const { executeMetaAction } = await import("@/lib/connectors/meta");
    return executeMetaAction(rec);
  }

  throw new Error(`Unknown platform: ${rec.platform}`);
}
