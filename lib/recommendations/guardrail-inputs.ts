import { prisma } from "@/lib/db";

type GuardrailRecommendation = {
  platform: string;
  targetEntityId: string;
  snapshotId: string;
};

export function deriveGuardrailInputsFromPayload(
  rec: Pick<GuardrailRecommendation, "platform" | "targetEntityId">,
  payload: Record<string, unknown>
): { conversionCount: number | null; dailyBudgetPhp: number } {
  if (rec.platform === "google_ads") {
    const campaigns = (payload.campaigns as Array<Record<string, unknown>>) ?? [];
    const adGroups = (payload.adGroups as Array<Record<string, unknown>>) ?? [];
    const entity = [...campaigns, ...adGroups].find((e) => e.id === rec.targetEntityId);
    const dailyBudgetPhp = Number(entity?.spend ?? 0);
    const conversions = entity?.conversions != null ? Number(entity.conversions) : null;
    return { conversionCount: conversions !== null ? Math.round(conversions) : null, dailyBudgetPhp };
  }

  let dailyBudgetPhp = 0;
  const campaigns = (payload.campaigns as Array<Record<string, unknown>>) ?? [];
  const adSets = (payload.adSets as Array<Record<string, unknown>>) ?? [];
  const entity = [...campaigns, ...adSets].find((e) => e.id === rec.targetEntityId);
  if (entity?.daily_budget) {
    dailyBudgetPhp = parseFloat(String(entity.daily_budget)) / 100;
  }

  let conversionCount = 0;
  const insights = (payload.insights as Array<Record<string, unknown>>) ?? [];
  for (const row of insights) {
    const matchesTarget =
      row.campaign_id === rec.targetEntityId ||
      row.adset_id === rec.targetEntityId ||
      row.ad_id === rec.targetEntityId;
    if (!matchesTarget) continue;
    const actions = (row.actions as Array<{ action_type: string; value: string }>) ?? [];
    for (const action of actions) {
      // Covers pixel purchases (most e-commerce), cross-device purchases, and direct purchases
      if (
        action.action_type === "purchase" ||
        action.action_type === "omni_purchase" ||
        action.action_type === "offsite_conversion.fb_pixel_purchase"
      ) {
        conversionCount += parseFloat(action.value ?? "0");
      }
    }
  }

  return { conversionCount: Math.round(conversionCount), dailyBudgetPhp };
}

export async function deriveGuardrailInputs(
  rec: GuardrailRecommendation
): Promise<{ conversionCount: number | null; dailyBudgetPhp: number }> {
  const snapshot = await prisma.rawSnapshot.findUnique({ where: { id: rec.snapshotId } });
  if (!snapshot) return { conversionCount: null, dailyBudgetPhp: 0 };
  return deriveGuardrailInputsFromPayload(rec, snapshot.payload as Record<string, unknown>);
}
