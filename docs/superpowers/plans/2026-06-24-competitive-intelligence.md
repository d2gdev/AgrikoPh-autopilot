# Competitive Intelligence Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Weekly Competitive Brief (AI-generated market summary, cached 24h in DB) and a "Steal This Ad" button (rewrites competitor ads in Agriko's voice, optionally sends to Content Pilot) to the Market Intelligence module.

**Architecture:** Two independent features sharing the same AI client (`lib/ai/client.ts`), brand guidelines (`lib/content-pilot/brand-guidelines.ts`), and Prisma. The brief is stored in the existing `RawSnapshot` model (`source: "competitive_brief"`) with sentinel dates to form a stable unique key. The ad rewriter is stateless — no DB persistence. Both features are gated by `requireAppAuth` session auth.

**Tech Stack:** Next.js App Router · Prisma · Polaris · `lib/ai/client.ts` (DeepSeek/OpenRouter via OpenAI SDK) · Vitest

## Global Constraints

- All AI calls use `getAiClient()` from `@/lib/ai/client` — never instantiate OpenAI directly
- No new Prisma migrations — use existing `RawSnapshot` model for brief cache
- All new API routes require `requireAppAuth(request)` from `@/lib/auth`
- Polaris components only for UI — `@shopify/polaris`
- TypeScript strict — no implicit `any`
- English-only AI output — include "Respond in English only." in every system prompt
- Run `rtk tsc --noEmit` after each task to catch type errors before committing

---

## File Map

| File | Action |
|---|---|
| `lib/market-intel/generate-brief.ts` | Create — data gathering + AI prompt for weekly brief |
| `lib/market-intel/steal-ad.ts` | Create — AI prompt for ad rewrite |
| `app/api/market-intelligence/brief/route.ts` | Create — GET cached brief |
| `app/api/market-intelligence/brief/refresh/route.ts` | Create — POST force-refresh brief |
| `app/api/market-intelligence/steal-ad/route.ts` | Create — POST rewrite ad |
| `app/api/market-intelligence/steal-ad/send-to-content-pilot/route.ts` | Create — POST create ContentProposal |
| `app/(embedded)/(market-intelligence)/market-intelligence/components.tsx` | Modify — add CompetitiveBrief + StealAdPanel components |
| `app/(embedded)/(market-intelligence)/market-intelligence/page.tsx` | Modify — render CompetitiveBrief above tabs |
| `__tests__/lib/generate-brief.test.ts` | Create — unit tests for brief generator |
| `__tests__/lib/steal-ad.test.ts` | Create — unit tests for ad rewriter |

---

### Task 1: Brief Data Gatherer + AI Prompt (`lib/market-intel/generate-brief.ts`)

**Files:**
- Create: `lib/market-intel/generate-brief.ts`
- Test: `__tests__/lib/generate-brief.test.ts`

**Interfaces:**
- Consumes: `getAiClient()` from `@/lib/ai/client`, `getBrandGuidelines()` from `@/lib/content-pilot/brand-guidelines`, `prisma` from `@/lib/db`, `shopifyFetch` from `@/lib/shopify-admin`
- Produces: `generateBrief(): Promise<BriefSections>` and `export interface BriefSections` (used by Task 2)

```ts
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
```

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/generate-brief.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    competitorAd: { findMany: vi.fn().mockResolvedValue([]) },
    shoppingPriceHistory: { findMany: vi.fn().mockResolvedValue([]) },
    marketInsight: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/lib/content-pilot/brand-guidelines", () => ({
  getBrandGuidelines: vi.fn().mockResolvedValue("Agriko sells organic farm products."),
}));

vi.mock("@/lib/shopify-admin", () => ({
  shopifyFetch: vi.fn().mockResolvedValue({
    products: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } },
  }),
}));

vi.mock("@/lib/ai/client", () => ({
  getAiClient: vi.fn().mockResolvedValue({
    model: "test-model",
    client: {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: JSON.stringify({
                  adsActivity: "No new ads this week.",
                  pricingMovements: "Prices stable.",
                  opportunities: "No competitors running educational content.",
                  recommendedActions: [
                    { priority: "low", action: "Monitor pricing", reason: "Stable market." }
                  ],
                }),
              },
            }],
          }),
        },
      },
    },
  }),
}));

describe("generateBrief", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns BriefSections with all required keys", async () => {
    const { generateBrief } = await import("@/lib/market-intel/generate-brief");
    const result = await generateBrief();
    expect(result).toHaveProperty("adsActivity");
    expect(result).toHaveProperty("pricingMovements");
    expect(result).toHaveProperty("opportunities");
    expect(result).toHaveProperty("recommendedActions");
    expect(result).toHaveProperty("generatedAt");
    expect(Array.isArray(result.recommendedActions)).toBe(true);
  });

  it("returns fallback when AI returns malformed JSON", async () => {
    const { getAiClient } = await import("@/lib/ai/client");
    vi.mocked(getAiClient).mockResolvedValueOnce({
      model: "test-model",
      provider: "deepseek",
      client: {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: "not json at all" } }],
            }),
          },
        },
      } as never,
    });
    const { generateBrief } = await import("@/lib/market-intel/generate-brief");
    const result = await generateBrief();
    expect(result.adsActivity).toContain("unavailable");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /mnt/c/Users/Sean/Documents/Agriko/autopilot-app
npx vitest run __tests__/lib/generate-brief.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/market-intel/generate-brief'`

- [ ] **Step 3: Implement `lib/market-intel/generate-brief.ts`**

```ts
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
      const data = await shopifyFetch<ProductsGql>(OUR_PRODUCTS_QUERY, after ? { after } : {});
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
      select: { title: true, store: true, price: true, previousPrice: true, priceDelta: true, priceDeltaPct: true, keyword: true, currency: true },
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
      keyword: p.keyword,
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
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run __tests__/lib/generate-brief.test.ts
```

Expected: 2 tests passing.

- [ ] **Step 5: Type check**

```bash
rtk tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add lib/market-intel/generate-brief.ts __tests__/lib/generate-brief.test.ts
git commit -m "feat(market-intel): add generateBrief AI data gatherer"
```

---

### Task 2: Brief API Routes (GET cached + POST refresh)

**Files:**
- Create: `app/api/market-intelligence/brief/route.ts`
- Create: `app/api/market-intelligence/brief/refresh/route.ts`

**Interfaces:**
- Consumes: `generateBrief()` and `BriefSections` from `@/lib/market-intel/generate-brief` (Task 1), `prisma` from `@/lib/db`, `requireAppAuth` from `@/lib/auth`
- Produces: `GET /api/market-intelligence/brief` → `{ brief: BriefSections; cached: boolean; generatedAt: string }`, `POST /api/market-intelligence/brief/refresh` → same shape

The `RawSnapshot` upsert uses sentinel dates `new Date("2000-01-01T00:00:00.000Z")` for both `dateRangeStart` and `dateRangeEnd` to form a stable unique key for the brief.

- [ ] **Step 1: Create `app/api/market-intelligence/brief/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateBrief, type BriefSections } from "@/lib/market-intel/generate-brief";
import { Prisma } from "@prisma/client";

const BRIEF_SOURCE = "competitive_brief";
const SENTINEL = new Date("2000-01-01T00:00:00.000Z");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const existing = await prisma.rawSnapshot.findFirst({
      where: { source: BRIEF_SOURCE },
      orderBy: { fetchedAt: "desc" },
    });

    if (existing && Date.now() - existing.fetchedAt.getTime() < CACHE_TTL_MS) {
      return NextResponse.json({
        brief: existing.payload as unknown as BriefSections,
        cached: true,
        generatedAt: (existing.payload as Record<string, unknown>).generatedAt ?? existing.fetchedAt.toISOString(),
      });
    }

    const brief = await generateBrief();

    await prisma.rawSnapshot.upsert({
      where: { source_dateRangeStart_dateRangeEnd: { source: BRIEF_SOURCE, dateRangeStart: SENTINEL, dateRangeEnd: SENTINEL } },
      create: { source: BRIEF_SOURCE, dateRangeStart: SENTINEL, dateRangeEnd: SENTINEL, payload: brief as unknown as Prisma.InputJsonValue },
      update: { payload: brief as unknown as Prisma.InputJsonValue, fetchedAt: new Date() },
    });

    return NextResponse.json({ brief, cached: false, generatedAt: brief.generatedAt });
  } catch (err) {
    console.error("[brief] generation failed:", err);
    return NextResponse.json({ error: "Brief generation failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create `app/api/market-intelligence/brief/refresh/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateBrief } from "@/lib/market-intel/generate-brief";
import { Prisma } from "@prisma/client";

const BRIEF_SOURCE = "competitive_brief";
const SENTINEL = new Date("2000-01-01T00:00:00.000Z");

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const brief = await generateBrief();

    await prisma.rawSnapshot.upsert({
      where: { source_dateRangeStart_dateRangeEnd: { source: BRIEF_SOURCE, dateRangeStart: SENTINEL, dateRangeEnd: SENTINEL } },
      create: { source: BRIEF_SOURCE, dateRangeStart: SENTINEL, dateRangeEnd: SENTINEL, payload: brief as unknown as Prisma.InputJsonValue },
      update: { payload: brief as unknown as Prisma.InputJsonValue, fetchedAt: new Date() },
    });

    return NextResponse.json({ brief, cached: false, generatedAt: brief.generatedAt });
  } catch (err) {
    console.error("[brief/refresh] failed:", err);
    return NextResponse.json({ error: "Brief refresh failed" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Type check**

```bash
rtk tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/market-intelligence/brief/route.ts app/api/market-intelligence/brief/refresh/route.ts
git commit -m "feat(market-intel): add brief API routes with 24h RawSnapshot cache"
```

---

### Task 3: Steal-Ad Library + API Routes

**Files:**
- Create: `lib/market-intel/steal-ad.ts`
- Create: `app/api/market-intelligence/steal-ad/route.ts`
- Create: `app/api/market-intelligence/steal-ad/send-to-content-pilot/route.ts`
- Test: `__tests__/lib/steal-ad.test.ts`

**Interfaces:**
- Consumes: `getAiClient()` from `@/lib/ai/client`, `getBrandGuidelines()` from `@/lib/content-pilot/brand-guidelines`, `prisma` from `@/lib/db`
- Produces:
  - `generateStolenAd(adId: string): Promise<StolenAd>` from `lib/market-intel/steal-ad.ts`
  - `POST /api/market-intelligence/steal-ad` body `{ adId: string }` → `{ result: StolenAd }`
  - `POST /api/market-intelligence/steal-ad/send-to-content-pilot` body `{ headline, adCopy, cta, platform, suggestedContentType, sourceAdId }` → `{ proposalId: string }`

```ts
export interface StolenAd {
  headline: string;
  adCopy: string;
  cta: string;
  platform: string;
  suggestedContentType: string;
}
```

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/steal-ad.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    competitorAd: {
      findUnique: vi.fn().mockResolvedValue({
        id: "ad-1",
        adCopy: "Buy our hair growth product now!",
        headline: "Regrow Your Hair",
        creativeAngle: "problem-solution",
        platforms: ["facebook"],
        pageName: "Minoxiplus",
      }),
    },
  },
}));

vi.mock("@/lib/content-pilot/brand-guidelines", () => ({
  getBrandGuidelines: vi.fn().mockResolvedValue("Agriko: natural farm products, warm Filipino tone."),
}));

vi.mock("@/lib/ai/client", () => ({
  getAiClient: vi.fn().mockResolvedValue({
    model: "test-model",
    client: {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: JSON.stringify({
                  headline: "Grow Naturally with Agriko",
                  adCopy: "Our organic hair care gives you real results.",
                  cta: "Shop Now",
                  platform: "facebook",
                  suggestedContentType: "promotional",
                }),
              },
            }],
          }),
        },
      },
    },
  }),
}));

describe("generateStolenAd", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns StolenAd with all required fields", async () => {
    const { generateStolenAd } = await import("@/lib/market-intel/steal-ad");
    const result = await generateStolenAd("ad-1");
    expect(result).toHaveProperty("headline");
    expect(result).toHaveProperty("adCopy");
    expect(result).toHaveProperty("cta");
    expect(result).toHaveProperty("platform");
    expect(result).toHaveProperty("suggestedContentType");
    expect(typeof result.headline).toBe("string");
    expect(result.headline.length).toBeGreaterThan(0);
  });

  it("throws when ad is not found", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.competitorAd.findUnique).mockResolvedValueOnce(null);
    const { generateStolenAd } = await import("@/lib/market-intel/steal-ad");
    await expect(generateStolenAd("nonexistent")).rejects.toThrow("Ad not found");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run __tests__/lib/steal-ad.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/market-intel/steal-ad'`

- [ ] **Step 3: Implement `lib/market-intel/steal-ad.ts`**

```ts
import { prisma } from "@/lib/db";
import { getAiClient } from "@/lib/ai/client";
import { getBrandGuidelines } from "@/lib/content-pilot/brand-guidelines";

export interface StolenAd {
  headline: string;
  adCopy: string;
  cta: string;
  platform: string;
  suggestedContentType: string;
}

function parseStolenAd(raw: string): StolenAd | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof parsed.headline !== "string" || typeof parsed.adCopy !== "string") return null;
    return {
      headline: String(parsed.headline),
      adCopy: String(parsed.adCopy),
      cta: String(parsed.cta ?? "Shop Now"),
      platform: String(parsed.platform ?? "facebook"),
      suggestedContentType: String(parsed.suggestedContentType ?? "promotional"),
    };
  } catch {
    return null;
  }
}

export async function generateStolenAd(adId: string): Promise<StolenAd> {
  const ad = await prisma.competitorAd.findUnique({
    where: { id: adId },
    select: { adCopy: true, adCopyEn: true, headline: true, headlineEn: true, creativeAngle: true, platforms: true, pageName: true },
  });

  if (!ad) throw new Error("Ad not found");

  const brandGuidelines = await getBrandGuidelines();
  const competitorCopy = ad.adCopyEn ?? ad.adCopy ?? "";
  const competitorHeadline = ad.headlineEn ?? ad.headline ?? "";
  const platforms = Array.isArray(ad.platforms) ? (ad.platforms as string[]) : [];
  const primaryPlatform = platforms[0] ?? "facebook";

  const ai = await getAiClient();

  const systemPrompt = `You are a copywriter for Agriko, a Filipino e-commerce brand. Your task is to rewrite a competitor ad in Agriko's voice using our brand guidelines.
Brand guidelines: ${brandGuidelines || "Warm, authentic Filipino tone. Focus on natural, quality products."}
Respond in English only.
Keep the same creative angle (${ad.creativeAngle ?? "general"}) but make it about Agriko's products and values.
Return ONLY valid JSON with no markdown or commentary:
{
  "headline": "<rewritten headline, max 10 words>",
  "adCopy": "<rewritten ad copy, 50-120 words>",
  "cta": "<call to action, max 4 words>",
  "platform": "${primaryPlatform}",
  "suggestedContentType": "promotional|educational|social-proof|ugc"
}`;

  const userContent = `Competitor: ${ad.pageName ?? "unknown"}
Original headline: ${competitorHeadline}
Original copy: ${competitorCopy}
Creative angle: ${ad.creativeAngle ?? "unknown"}
Platform: ${primaryPlatform}`;

  const response = await ai.client.chat.completions.create({
    model: ai.model,
    max_tokens: 1024,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "";
  const result = parseStolenAd(raw);
  if (!result) throw new Error("AI returned malformed response");
  return result;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run __tests__/lib/steal-ad.test.ts
```

Expected: 2 tests passing.

- [ ] **Step 5: Create `app/api/market-intelligence/steal-ad/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { generateStolenAd } from "@/lib/market-intel/steal-ad";

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const body = await req.json() as { adId?: string };
    if (!body.adId || typeof body.adId !== "string") {
      return NextResponse.json({ error: "adId is required" }, { status: 400 });
    }
    const result = await generateStolenAd(body.adId);
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[steal-ad]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 6: Create `app/api/market-intelligence/steal-ad/send-to-content-pilot/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

interface SendBody {
  headline: string;
  adCopy: string;
  cta: string;
  platform: string;
  suggestedContentType: string;
  sourceAdId: string;
}

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const body = await req.json() as SendBody;
    if (!body.headline || !body.adCopy || !body.sourceAdId) {
      return NextResponse.json({ error: "headline, adCopy, and sourceAdId are required" }, { status: 400 });
    }

    const proposal = await prisma.contentProposal.create({
      data: {
        proposalType: "social_ad",
        changeType: "create",
        priority: "medium",
        impact: "medium",
        effort: "low",
        title: body.headline,
        description: body.adCopy,
        status: "pending",
        proposedState: {
          headline: body.headline,
          adCopy: body.adCopy,
          cta: body.cta,
          platform: body.platform,
          suggestedContentType: body.suggestedContentType,
        },
        sourceData: {
          source: "steal_ad",
          sourceAdId: body.sourceAdId,
          platform: body.platform,
        },
      },
    });

    return NextResponse.json({ proposalId: proposal.id });
  } catch (err) {
    console.error("[steal-ad/send-to-content-pilot]", err);
    return NextResponse.json({ error: "Failed to create proposal" }, { status: 500 });
  }
}
```

- [ ] **Step 7: Type check**

```bash
rtk tsc --noEmit
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add lib/market-intel/steal-ad.ts __tests__/lib/steal-ad.test.ts app/api/market-intelligence/steal-ad/route.ts app/api/market-intelligence/steal-ad/send-to-content-pilot/route.ts
git commit -m "feat(market-intel): add steal-ad generator and API routes"
```

---

### Task 4: CompetitiveBrief UI Component

**Files:**
- Modify: `app/(embedded)/(market-intelligence)/market-intelligence/components.tsx` — add `CompetitiveBrief` component
- Modify: `app/(embedded)/(market-intelligence)/market-intelligence/page.tsx` — render `CompetitiveBrief` above tabs

**Interfaces:**
- Consumes: `BriefSections` interface (copy the type inline in the component file — no cross-import needed)
- `CompetitiveBrief` has no props — fetches its own data via `useAuthFetch` (existing hook: `hooks/use-auth-fetch.ts`)

Check the existing auth fetch pattern first:

```bash
rtk grep -n "useAuthFetch\|authFetch" /mnt/c/Users/Sean/Documents/Agriko/autopilot-app/hooks/use-auth-fetch.ts | head -10
```

- [ ] **Step 1: Add `CompetitiveBrief` component to `components.tsx`**

Add the following imports at the top of `components.tsx` (after existing imports):

```ts
import { useCallback, useEffect, useRef } from "react";
import { Banner, Box, Button, Divider, Icon, SkeletonBodyText, Spinner } from "@shopify/polaris";
import { RefreshIcon } from "@shopify/polaris-icons";
```

Then add the `CompetitiveBrief` component at the **end** of `components.tsx`:

```tsx
interface BriefSections {
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

interface BriefResponse {
  brief?: BriefSections;
  cached?: boolean;
  generatedAt?: string;
  error?: string;
}

const PRIORITY_TONE: Record<string, "critical" | "attention" | "info"> = {
  high: "critical",
  medium: "attention",
  low: "info",
};

export function CompetitiveBrief() {
  const [brief, setBrief] = useState<BriefSections | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const hasFetched = useRef(false);

  const fetchBrief = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const url = forceRefresh ? "/api/market-intelligence/brief/refresh" : "/api/market-intelligence/brief";
      const res = await fetch(url, { method: forceRefresh ? "POST" : "GET" });
      const data = await res.json() as BriefResponse;
      if (data.error) { setError(data.error); return; }
      if (data.brief) {
        setBrief(data.brief);
        setGeneratedAt(data.generatedAt ?? null);
      }
    } catch {
      setError("Failed to load brief. Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    void fetchBrief(false);
  }, [fetchBrief]);

  const age = generatedAt
    ? Math.round((Date.now() - new Date(generatedAt).getTime()) / 3_600_000)
    : null;
  const ageLabel = age === null ? "" : age < 1 ? "just now" : `${age}h ago`;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingMd" as="h2">Competitive Brief</Text>
          <InlineStack gap="200" blockAlign="center">
            {ageLabel && <Text as="span" variant="bodySm" tone="subdued">Generated {ageLabel}</Text>}
            <Button
              variant="plain"
              size="slim"
              icon={RefreshIcon}
              loading={refreshing}
              disabled={loading}
              onClick={() => void fetchBrief(true)}
            >
              Refresh
            </Button>
          </InlineStack>
        </InlineStack>

        {loading && (
          <BlockStack gap="400">
            <SkeletonBodyText lines={3} />
            <SkeletonBodyText lines={3} />
            <SkeletonBodyText lines={2} />
          </BlockStack>
        )}

        {error && !loading && (
          <Banner tone="warning" onDismiss={() => setError(null)}>
            <BlockStack gap="200">
              <Text as="p">{error}</Text>
              <Button variant="plain" onClick={() => void fetchBrief(true)}>Try again</Button>
            </BlockStack>
          </Banner>
        )}

        {brief && !loading && (
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text variant="headingSm" as="h3">Ads Activity</Text>
              <Text as="p" tone="subdued">{brief.adsActivity}</Text>
            </BlockStack>
            <Divider />
            <BlockStack gap="100">
              <Text variant="headingSm" as="h3">Pricing Movements</Text>
              <Text as="p" tone="subdued">{brief.pricingMovements}</Text>
            </BlockStack>
            <Divider />
            <BlockStack gap="100">
              <Text variant="headingSm" as="h3">Opportunities</Text>
              <Text as="p" tone="subdued">{brief.opportunities}</Text>
            </BlockStack>
            {brief.recommendedActions.length > 0 && (
              <>
                <Divider />
                <BlockStack gap="200">
                  <Text variant="headingSm" as="h3">Recommended Actions</Text>
                  <BlockStack gap="150">
                    {brief.recommendedActions.map((item, i) => (
                      <InlineStack key={i} gap="200" blockAlign="start" wrap={false}>
                        <Box minWidth="60px">
                          <Badge tone={PRIORITY_TONE[item.priority] ?? "info"}>{item.priority.toUpperCase()}</Badge>
                        </Box>
                        <BlockStack gap="0">
                          <Text as="p" fontWeight="semibold">{item.action}</Text>
                          <Text as="p" tone="subdued" variant="bodySm">{item.reason}</Text>
                        </BlockStack>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </BlockStack>
              </>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
```

- [ ] **Step 2: Add missing imports to `components.tsx`**

Check which Polaris imports are already present at the top of the file:

```bash
rtk grep -n "^import" /mnt/c/Users/Sean/Documents/Agriko/autopilot-app/app/\(embedded\)/\(market-intelligence\)/market-intelligence/components.tsx | head -10
```

Add any missing Polaris components (`Banner`, `Box`, `Button`, `Divider`, `Icon`, `SkeletonBodyText`) to the existing `@shopify/polaris` import line. Add `useCallback`, `useEffect`, `useRef` to the existing `react` import. Add `{ RefreshIcon }` from `@shopify/polaris-icons`.

- [ ] **Step 3: Wire `CompetitiveBrief` into `page.tsx`**

In `app/(embedded)/(market-intelligence)/market-intelligence/page.tsx`, find where the tabs are rendered (the `<Tabs ...>` component). Add `<CompetitiveBrief />` **above** it:

```tsx
// Add to imports at top:
import { CompetitiveBrief } from "./components";

// In the JSX, above <Tabs ...>:
<BlockStack gap="400">
  <CompetitiveBrief />
  <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
    {/* existing tab content */}
  </Tabs>
</BlockStack>
```

- [ ] **Step 4: Type check**

```bash
rtk tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/\(embedded\)/\(market-intelligence\)/market-intelligence/components.tsx app/\(embedded\)/\(market-intelligence\)/market-intelligence/page.tsx
git commit -m "feat(market-intel): add CompetitiveBrief UI card above tabs"
```

---

### Task 5: Steal This Ad — Inline UI on AdCreativeCard

**Files:**
- Modify: `app/(embedded)/(market-intelligence)/market-intelligence/components.tsx` — add `StealAdPanel` inline state to `AdCreativeCard`

**Interfaces:**
- Consumes: `StolenAd` interface (define inline in components.tsx)
- No new props on `AdCreativeCard` — all state is internal

- [ ] **Step 1: Add `StealAdPanel` state and UI inside `AdCreativeCard`**

In `components.tsx`, find `AdCreativeCard` and add the following:

After the existing state declarations (`const [expanded, setExpanded] = useState(false);`), add:

```tsx
const [stealing, setStealing] = useState(false);
const [stolen, setStolen] = useState<{ headline: string; adCopy: string; cta: string; platform: string; suggestedContentType: string } | null>(null);
const [stealError, setStealError] = useState<string | null>(null);
const [sendingToCP, setSendingToCP] = useState(false);
const [sentToCP, setSentToCP] = useState(false);
```

Add the `handleSteal` function after state declarations:

```tsx
const handleSteal = async () => {
  setStealing(true);
  setStealError(null);
  setStolen(null);
  setSentToCP(false);
  try {
    const res = await fetch("/api/market-intelligence/steal-ad", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adId: ad.id }),
    });
    const data = await res.json() as { result?: typeof stolen; error?: string };
    if (data.error) { setStealError(data.error); return; }
    if (data.result) setStolen(data.result);
  } catch {
    setStealError("Failed to rewrite ad. Please try again.");
  } finally {
    setStealing(false);
  }
};

const handleSendToCP = async () => {
  if (!stolen) return;
  setSendingToCP(true);
  try {
    const res = await fetch("/api/market-intelligence/steal-ad/send-to-content-pilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...stolen, sourceAdId: ad.id }),
    });
    const data = await res.json() as { proposalId?: string; error?: string };
    if (data.error) { setStealError(data.error); return; }
    setSentToCP(true);
  } catch {
    setStealError("Failed to send to Content Pilot.");
  } finally {
    setSendingToCP(false);
  }
};

const handleCopy = () => {
  if (!stolen) return;
  void navigator.clipboard.writeText(`${stolen.headline}\n\n${stolen.adCopy}`);
};
```

At the **bottom** of the `AdCreativeCard` JSX, just before the closing `</BlockStack>` of the card content (after the existing metadata row with "Started" / "Captured" / "View on Meta"), add:

```tsx
{/* Steal This Ad */}
{(ad.adCopy || ad.headline) && (
  <BlockStack gap="200">
    {!stolen && (
      <Button
        variant="plain"
        size="slim"
        loading={stealing}
        onClick={() => void handleSteal()}
      >
        Steal This Ad
      </Button>
    )}

    {stealError && (
      <Banner tone="warning" onDismiss={() => setStealError(null)}>
        <InlineStack gap="200" blockAlign="center">
          <Text as="span" variant="bodySm">{stealError}</Text>
          <Button variant="plain" size="slim" onClick={() => void handleSteal()}>Try again</Button>
        </InlineStack>
      </Banner>
    )}

    {stolen && (
      <Box background="bg-surface-secondary" padding="300" borderRadius="200">
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="headingSm" as="h4">Rewritten for Agriko</Text>
            <Button variant="plain" size="slim" onClick={() => { setStolen(null); setSentToCP(false); }}>Dismiss</Button>
          </InlineStack>
          <Text variant="headingSm" as="p">{stolen.headline}</Text>
          <Text as="p" tone="subdued">{stolen.adCopy}</Text>
          {sentToCP ? (
            <Text as="p" tone="success" variant="bodySm">Sent to Content Pilot</Text>
          ) : (
            <InlineStack gap="200">
              <Button size="slim" onClick={handleCopy}>Copy to clipboard</Button>
              <Button size="slim" tone="success" loading={sendingToCP} onClick={() => void handleSendToCP()}>
                Send to Content Pilot
              </Button>
            </InlineStack>
          )}
        </BlockStack>
      </Box>
    )}
  </BlockStack>
)}
```

- [ ] **Step 2: Add missing Polaris imports if needed**

`Box` and `Banner` should already be imported from Task 4. Verify:

```bash
rtk grep -n "from \"@shopify/polaris\"" /mnt/c/Users/Sean/Documents/Agriko/autopilot-app/app/\(embedded\)/\(market-intelligence\)/market-intelligence/components.tsx
```

Add any missing: `Box`, `Banner`, `Button`, `Divider`, `SkeletonBodyText` to the existing import.

- [ ] **Step 3: Type check**

```bash
rtk tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add app/\(embedded\)/\(market-intelligence\)/market-intelligence/components.tsx
git commit -m "feat(market-intel): add Steal This Ad inline UI on AdCreativeCard"
```

---

### Task 6: Deploy

- [ ] **Step 1: Final type check**

```bash
rtk tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

Expected: All tests passing.

- [ ] **Step 3: Deploy**

```bash
node scripts/linode-deploy.mjs
```

Expected: `✓ Deploy complete`

- [ ] **Step 4: Smoke test**
  - Open Market Intelligence page — brief card should appear above tabs with a loading skeleton, then populate within ~15 seconds
  - Click "Refresh" — brief regenerates
  - Find an ad card with copy — "Steal This Ad" button should appear at the bottom
  - Click "Steal This Ad" — loading state, then rewritten ad appears inline
  - Click "Copy to clipboard" — check clipboard
  - Click "Send to Content Pilot" — navigate to `/content-pilot` and confirm proposal appears
