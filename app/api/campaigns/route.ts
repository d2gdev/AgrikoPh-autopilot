export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAppAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const VALID_PLATFORMS = ["meta"];
  const rawPlatform = req.nextUrl.searchParams.get("platform") ?? "meta";
  if (!VALID_PLATFORMS.includes(rawPlatform)) {
    return NextResponse.json({ error: `Invalid platform. Must be one of: ${VALID_PLATFORMS.join(", ")}` }, { status: 400 });
  }
  const platform = rawPlatform;

  try {
    const snapshot = await prisma.rawSnapshot.findFirst({
      where: { source: platform },
      orderBy: { fetchedAt: "desc" },
    });

    if (!snapshot) {
      return NextResponse.json({ campaigns: [], message: "No data yet — run the analyzer first" });
    }

    const payload = snapshot.payload as Record<string, unknown>;
    const campaigns = (payload.campaigns as Array<Record<string, unknown>>) ?? [];
    const insights = (payload.insights as Array<Record<string, unknown>>) ?? [];

    // Build a map of campaign_id → aggregated insight metrics
    const insightMap: Record<string, {
      spend: number; clicks: number; impressions: number;
      conversions: number; conversionValue: number;
    }> = {};

    const safeFloat = (v: unknown): number => { const n = parseFloat(String(v ?? "0")); return isNaN(n) ? 0 : n; };
    const safeInt = (v: unknown): number => { const n = parseInt(String(v ?? "0"), 10); return isNaN(n) ? 0 : n; };

    for (const row of insights) {
      const cid = (row.campaign_id ?? row.campaignId) as string;
      if (!cid) continue;
      if (!insightMap[cid]) insightMap[cid] = { spend: 0, clicks: 0, impressions: 0, conversions: 0, conversionValue: 0 };

      insightMap[cid].spend += safeFloat(row.spend);
      insightMap[cid].clicks += safeInt(row.clicks);
      insightMap[cid].impressions += safeInt(row.impressions);

      // Meta: count purchase actions
      const actions = (row.actions as Array<{ action_type: string; value: string }>) ?? [];
      const actionValues = (row.action_values as Array<{ action_type: string; value: string }>) ?? [];
      for (const a of actions) {
        if (a.action_type === "purchase" || a.action_type === "omni_purchase") {
          insightMap[cid].conversions += safeFloat(a.value);
        }
      }
      for (const av of actionValues) {
        if (av.action_type === "purchase" || av.action_type === "omni_purchase") {
          insightMap[cid].conversionValue += safeFloat(av.value);
        }
      }
    }

    // Attach pending rec counts per campaign
    const campaignIds = campaigns.map((c) => c.id as string);
    const recCounts = campaignIds.length > 0 ? await prisma.recommendation.groupBy({
      by: ["targetEntityId"],
      where: { targetEntityId: { in: campaignIds }, status: "pending" },
      _count: { id: true },
    }) : [];
    const countMap = Object.fromEntries(recCounts.map((r) => [r.targetEntityId, r._count.id]));

    const enriched = campaigns.map((c) => {
      const m = insightMap[c.id as string] ?? { spend: 0, clicks: 0, impressions: 0, conversions: 0, conversionValue: 0 };
      const ctr = m.impressions > 0 ? ((m.clicks / m.impressions) * 100).toFixed(2) + "%" : "—";
      const cpa = m.conversions > 0 ? "₱" + (m.spend / m.conversions).toFixed(2) : "—";
      const roas = m.spend > 0 ? (m.conversionValue / m.spend).toFixed(2) + "x" : "—";
      const dailyBudgetCents = safeFloat(c.daily_budget ?? c.dailyBudget);
      const budget = dailyBudgetCents > 0 ? "₱" + (dailyBudgetCents / 100).toFixed(0) + "/day" : "—";

      const roasValue = m.spend > 0 ? m.conversionValue / m.spend : null;
      return {
        id: c.id,
        name: c.name,
        status: c.status ?? c.effective_status,
        objective: c.objective,
        budget,
        spend7d: m.spend > 0 ? "₱" + m.spend.toFixed(2) : "₱0",
        spendValue: m.spend,
        impressions: m.impressions,
        clicks: m.clicks,
        ctr,
        conversions: Math.round(m.conversions),
        conversionValue: m.conversionValue,
        cpa,
        roas,
        roasValue,
        pendingRecs: countMap[c.id as string] ?? 0,
      };
    });

    return NextResponse.json({ campaigns: enriched, fetchedAt: snapshot.fetchedAt });
  } catch (err) {
    console.error("[campaigns] DB error:", err);
    return NextResponse.json({ error: "Failed to load campaigns", detail: String(err) }, { status: 500 });
  }
}
