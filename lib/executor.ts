import type { Recommendation } from "@prisma/client";

// Google Ads execution is blocked for this release — connector is keyword research only.
const SUPPORTED_ACTIONS: Record<string, readonly string[]> = {
  meta: ["pause_campaign", "pause_ad", "adjust_budget"],
  google_ads: [],
};

export function isSupportedAction(platform: string, actionType: string): boolean {
  const supported = SUPPORTED_ACTIONS[platform];
  return supported !== undefined && supported.includes(actionType);
}

export async function executeRecommendation(rec: Recommendation): Promise<Record<string, unknown>> {
  if (rec.platform === "google_ads") {
    const { executeGoogleAdsAction } = await import("@/lib/connectors/google-ads");
    return executeGoogleAdsAction(rec);
  }

  if (rec.platform === "meta") {
    const { executeMetaAction } = await import("@/lib/connectors/meta");
    return executeMetaAction(rec);
  }

  throw new Error(`Unknown platform: ${rec.platform}`);
}
