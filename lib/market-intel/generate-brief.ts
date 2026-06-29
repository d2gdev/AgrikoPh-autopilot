import { prisma } from "@/lib/db";
import { getAiClient } from "@/lib/ai/client";
import { getBrandGuidelines } from "@/lib/content-pilot/brand-guidelines";
import { shopifyFetch } from "@/lib/shopify-admin";

export interface BriefSections {
  adsActivity: string;
  pricingMovements: string;
  opportunities: string;
  recommendedActions: Array<{
    priority: "high" | "medium" | "low";
    action: string;
    reason: string;
  }>;
  generatedAt: string;
}

const BRIEF_FALLBACK: BriefSections = {
  adsActivity: "Brief generation unavailable — AI response was malformed.",
  pricingMovements: "Brief generation unavailable.",
  opportunities: "Brief generation unavailable.",
  recommendedActions: [],
  generatedAt: new Date().toISOString(),
};

const OUR_PRODUCTS_QUERY = `
  query OurProducts($after: String) {
    products(first: 100, after: $after) {
      edges { node { title priceRangeV2 { minVariantPrice { amount currencyCode } } } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface ProductsGql {
  products: {
    edges: { node: { title: string; priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } } } }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

async function fetchOurProducts(): Promise<{ title: string; price: number; currency: string }[]> {
  try {
    const products: { title: string; price: number; currency: string }[] = [];
    let after: string | null = null;
    for (let page = 0; page < 5; page++) {
      const data: ProductsGql = await shopifyFetch<ProductsGql>(OUR_PRODUCTS_QUERY, after ? { after } : {});
      for (const { node } of data.products.edges) {
        products.push({
          title: node.title,
          price: parseFloat(node.priceRangeV2.minVariantPrice.amount),
          currency: node.priceRangeV2.minVariantPrice.currencyCode,
        });
      }
      if (!data.products.pageInfo.hasNextPage) break;
      after = data.products.pageInfo.endCursor;
    }
    return products;
  } catch {
    return [];
  }
}

function parseBriefJson(raw: string): BriefSections | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    if (
      typeof parsed.adsActivity !== "string" ||
      typeof parsed.pricingMovements !== "string" ||
      typeof parsed.opportunities !== "string" ||
      !Array.isArray(parsed.recommendedActions)
    ) return null;
    return {
      adsActivity: parsed.adsActivity,
      pricingMovements: parsed.pricingMovements,
      opportunities: parsed.opportunities,
      recommendedActions: (parsed.recommendedActions as Array<Record<string, unknown>>).map((r) => ({
        priority: (["high", "medium", "low"].includes(r.priority as string) ? r.priority : "low") as "high" | "medium" | "low",
        action: String(r.action ?? ""),
        reason: String(r.reason ?? ""),
      })),
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function generateBrief(): Promise<BriefSections> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [recentAds, priceHistory, insights, ourProducts, brandGuidelines] = await Promise.all([
    prisma.competitorAd.findMany({
      where: { capturedAt: { gte: sevenDaysAgo } },
      select: {
        pageName: true, headline: true, adCopy: true, adCopyEn: true, headlineEn: true,
        creativeAngle: true, activeStatus: true, startDate: true, platforms: true,
        competitor: { select: { name: true } },
      },
      orderBy: { capturedAt: "desc" },
      take: 50,
    }),
    prisma.shoppingPriceHistory.findMany({
      where: { capturedAt: { gte: sevenDaysAgo }, priceDelta: { not: null } },
      select: { title: true, store: true, price: true, previousPrice: true, priceDelta: true, priceDeltaPct: true, currency: true, marketKeyword: { select: { keyword: true } } },
      orderBy: { capturedAt: "desc" },
      take: 30,
    }),
    prisma.marketInsight.findMany({
      where: { status: "open", createdAt: { gte: sevenDaysAgo } },
      select: { type: true, severity: true, title: true, summary: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    fetchOurProducts(),
    getBrandGuidelines(),
  ]);

  // Summarise long-running ads (active + started > 30 days ago)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const provenAds = recentAds.filter(
    (a) => a.activeStatus === "ACTIVE" && a.startDate && new Date(a.startDate) < thirtyDaysAgo
  );
  const angleCount: Record<string, number> = {};
  for (const ad of recentAds) {
    if (ad.creativeAngle) angleCount[ad.creativeAngle] = (angleCount[ad.creativeAngle] ?? 0) + 1;
  }

  const context = {
    period: "last 7 days",
    ourProducts: ourProducts.slice(0, 20),
    brandGuidelines: brandGuidelines || "No brand guidelines set.",
    newAds: recentAds.length,
    provenAds: provenAds.map((a) => ({
      competitor: a.competitor?.name ?? a.pageName,
      headline: a.headlineEn ?? a.headline,
      angle: a.creativeAngle,
    })),
    angleDistribution: angleCount,
    priceMovements: priceHistory.map((p) => ({
      product: p.title,
      store: p.store,
      keyword: p.marketKeyword?.keyword ?? null,
      from: p.previousPrice,
      to: p.price,
      deltaPct: p.priceDeltaPct ? Math.round(p.priceDeltaPct * 10) / 10 : null,
      currency: p.currency,
    })),
    openInsights: insights.map((i) => ({ type: i.type, severity: i.severity, title: i.title, summary: i.summary })),
  };

  const ai = await getAiClient();
  const systemPrompt = `You are a market analyst writing a weekly competitive brief for ${brandGuidelines ? "an e-commerce brand" : "Agriko"}, a Filipino e-commerce store. Prices are in PHP unless otherwise noted.
Respond in English only.
You will receive structured JSON data about competitor ads, pricing, and market insights from the last 7 days.
Return ONLY valid JSON matching this exact schema (no markdown, no commentary):
{
  "adsActivity": "<narrative paragraph about ad activity this week>",
  "pricingMovements": "<narrative paragraph about price changes>",
  "opportunities": "<observations on gaps or angles competitors are not covering>",
  "recommendedActions": [
    { "priority": "high|medium|low", "action": "<specific action to take>", "reason": "<data-backed reason>" }
  ]
}
Be specific and data-backed. Reference actual competitor names, product names, prices. Keep each section under 150 words. Recommended actions should be concrete (e.g. "Lower price on X from ₱620 to ₱480" not "consider pricing strategy").`;

  try {
    const response = await ai.client.chat.completions.create({
      model: ai.model,
      max_tokens: 2048,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(context) },
      ],
    });
    const raw = response.choices[0]?.message?.content ?? "";
    return parseBriefJson(raw) ?? { ...BRIEF_FALLBACK, generatedAt: new Date().toISOString() };
  } catch {
    return { ...BRIEF_FALLBACK, generatedAt: new Date().toISOString() };
  }
}
