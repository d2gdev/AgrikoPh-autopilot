import { prisma } from "@/lib/db";
import { chatCompletionWithFailover } from "@/lib/ai/client";
import { getBrandGuidelines } from "@/lib/content-pilot/brand-guidelines";
import { shopifyFetch } from "@/lib/shopify-admin";
import { retrieveContext, formatGroundingBlock } from "@/lib/ai/knowledge";
import { computeAdLongevity } from "@/lib/market-intel/ad-longevity";
import { isMeaningfulPriceChange } from "@/lib/market-intel/price-signal";

// Grounds a market-intel brief's prompt context in the KB corpus. Additive — unchanged when empty.
export async function groundBriefContext(baseContext: string, query: string): Promise<string> {
  const chunks = await retrieveContext({
    query,
    sourceTypes: ["competitor_ad", "market_insight"],
    topK: 6,
  });
  const block = formatGroundingBlock(chunks);
  return block ? `${baseContext}\n\n${block}` : baseContext;
}

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

const UNSUPPORTED_COMMERCE_ACTION = /(?:₱|\bphp\b|\bprice comparison\b|\bcompare (?:our|the) price\b|\b(?:lower|raise|increase|decrease|match|undercut)\b.{0,30}\bprice\b|\bbuy\s*\d+\s*take\s*\d+\b|\bbundle\b|\bfree shipping\b|\b\d+%\s*off\b|\bdiscount\b|\bpromo(?:tion)?\b)/i;

export function sanitizeBrief(brief: BriefSections): BriefSections {
  return {
    ...brief,
    recommendedActions: brief.recommendedActions.filter((item) =>
      !UNSUPPORTED_COMMERCE_ACTION.test(`${item.action}\n${item.reason}`)
    ),
  };
}

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

export async function fetchOurProducts(): Promise<{ title: string; price: number; currency: string }[]> {
  const products: { title: string; price: number; currency: string }[] = [];
  let after: string | null = null;
  for (let page = 0; page < 5; page++) {
    try {
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
    } catch {
      // A later page failing (transient API hiccup) shouldn't discard the
      // pages already fetched successfully — return what we have so far.
      break;
    }
  }
  return products;
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
    return sanitizeBrief({
      adsActivity: parsed.adsActivity,
      pricingMovements: parsed.pricingMovements,
      opportunities: parsed.opportunities,
      recommendedActions: (parsed.recommendedActions as Array<Record<string, unknown>>).map((r) => ({
        priority: (["high", "medium", "low"].includes(r.priority as string) ? r.priority : "low") as "high" | "medium" | "low",
        action: String(r.action ?? ""),
        reason: String(r.reason ?? ""),
      })),
      generatedAt: new Date().toISOString(),
    });
  } catch {
    return null;
  }
}

export async function generateBrief(): Promise<BriefSections> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [recentAds, priceHistory, insights, ourProducts, brandGuidelines, adLongevity] = await Promise.all([
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
    computeAdLongevity(),
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
    // Product names establish portfolio relevance. Prices are intentionally
    // omitted because shopping results are not package-normalized or matched
    // to a specific Shopify product.
    ourProducts: ourProducts.slice(0, 20).map(({ title }) => ({ title })),
    brandGuidelines: brandGuidelines || "No brand guidelines set.",
    newAds: recentAds.length,
    provenAds: provenAds.map((a) => ({
      competitor: a.competitor?.name ?? a.pageName,
      headline: a.headlineEn ?? a.headline,
      angle: a.creativeAngle,
    })),
    angleDistribution: angleCount,
    // Long-running competitor ads (proven winners) — ads that have stayed
    // ACTIVE the longest are the ones a competitor keeps funding, i.e. their
    // proven performers. Top 10 keeps the brief focused on the strongest signal.
    longRunningAds: adLongevity.slice(0, 10).map((a) => ({
      competitor: a.competitor,
      headline: a.headline,
      daysActive: a.daysActive,
      stillActive: a.stillActive,
    })),
    priceMovements: priceHistory
      .filter((p) => p.previousPrice != null && isMeaningfulPriceChange(p.previousPrice, p.price))
      .map((p) => ({
      product: p.title,
      store: p.store,
      keyword: p.marketKeyword?.keyword ?? null,
      from: p.previousPrice,
      to: p.price,
      deltaPct: p.priceDeltaPct != null ? Math.round(p.priceDeltaPct * 10) / 10 : null,
      currency: p.currency,
      })),
    openInsights: insights.map((i) => ({ type: i.type, severity: i.severity, title: i.title, summary: i.summary })),
  };

  const briefQueryTopics = [
    ...new Set(provenAds.map((a) => a.competitor?.name ?? a.pageName).filter((n): n is string => Boolean(n))),
  ].slice(0, 5);
  const briefQuery = briefQueryTopics.length > 0
    ? `competitor activity: ${briefQueryTopics.join(", ")}`
    : "Agriko competitor and market intelligence";

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
Be specific and data-backed. Reference actual competitor names and product names. Keep each section under 150 words. Recommended actions must identify a concrete content, positioning, or research next step.`;
  const pricingSafety = `Competitor price movements are not package-normalized and are not matched to a specific Shopify product. Treat them as competitor observations only. Never compare our price to a competitor price, infer relative value, recommend a price or discount change, invent a bundle price, or recommend a promotion/free-shipping offer.`;

  try {
    const groundedSystemPrompt = await groundBriefContext(`${systemPrompt}\n${pricingSafety}`, briefQuery);
    const { content: raw } = await chatCompletionWithFailover({
      max_tokens: 2048,
      messages: [
        { role: "system", content: groundedSystemPrompt },
        { role: "user", content: JSON.stringify(context) },
      ],
    });
    return parseBriefJson(raw) ?? { ...BRIEF_FALLBACK, generatedAt: new Date().toISOString() };
  } catch {
    return { ...BRIEF_FALLBACK, generatedAt: new Date().toISOString() };
  }
}
