export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAppAuth, getSessionShop, getSessionUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAiClient } from "@/lib/ai/client";
import { getLatestGscData } from "@/lib/seo/data";
import { hasMissingMeta } from "@/lib/seo/meta";

const SeoAnalysisSchema = z.object({
  summary: z.string().trim().min(1).max(2_000).optional(),
  quickWins: z.array(z.string().trim().min(1).max(500)).max(8).default([]),
  recommendations: z.array(z.string().trim().min(1).max(500)).max(8).default([]),
});

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "are",
  "was",
  "how",
  "why",
  "what",
  "which",
  "where",
  "when",
  "does",
  "can",
  "its",
]);

function articleHandleFromBlogPage(page: string | undefined): string | null {
  if (!page) return null;
  let path = page;
  try {
    path = new URL(page).pathname;
  } catch {
    path = page.split(/[?#]/)[0] ?? page;
  }
  const parts = path.split("/").filter(Boolean);
  const blogIndex = parts.findIndex((part) => part === "blogs");
  const handle = blogIndex >= 0 ? parts[blogIndex + 2] : null;
  return handle && /^[a-z0-9][a-z0-9_-]*$/i.test(handle) ? handle.toLowerCase() : null;
}

function meaningfulTerms(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((term) => term.length > 3 && !STOP_WORDS.has(term));
}

function titleCoversQuery(title: string, query: string): boolean {
  const queryTerms = meaningfulTerms(query);
  if (queryTerms.length === 0) return false;
  const titleTerms = new Set(meaningfulTerms(title));
  const matchCount = queryTerms.filter((term) => titleTerms.has(term)).length;
  return queryTerms.length <= 2
    ? matchCount >= queryTerms.length
    : matchCount >= Math.ceil(queryTerms.length * 0.5) && matchCount >= 2;
}

function textIncludesNormalized(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase().replace(/\s+/g, " ");
  const n = needle.toLowerCase().replace(/\s+/g, " ");
  return n.length > 3 && h.includes(n);
}

function evidenceForStrategyItem(
  item: string,
  context: {
    queries: Array<{ query: string; impressions: number; clicks: number; position: string }>;
    articles: Array<{ handle: string; title: string; wordCount: number | null; internalLinkCount: number | null; seoData: unknown }>;
    missingMetaCount: number;
    thinContentCount: number;
    noInternalLinksCount: number;
  },
): string | null {
  const normalized = item.toLowerCase();

  if (/\b(query|keyword|serp|ranking|position|ctr|impression|click)\b/.test(normalized)) {
    for (const query of context.queries) {
      if (textIncludesNormalized(item, query.query)) {
        return `Grounded in GSC query "${query.query}" (${query.impressions.toLocaleString()} impressions, avg position ${query.position}).`;
      }
    }
  }

  for (const article of context.articles) {
    if (textIncludesNormalized(item, article.title) || textIncludesNormalized(item, article.handle)) {
      return `Grounded in existing article "${article.title}" (${article.handle}).`;
    }
  }

  for (const query of context.queries) {
    if (textIncludesNormalized(item, query.query)) {
      return `Grounded in GSC query "${query.query}" (${query.impressions.toLocaleString()} impressions, avg position ${query.position}).`;
    }
  }

  if (context.missingMetaCount > 0 && /\b(meta|title tag|description|serp snippet)\b/.test(normalized)) {
    return `Grounded in on-page health: ${context.missingMetaCount} article${context.missingMetaCount === 1 ? "" : "s"} missing meta.`;
  }

  if (context.thinContentCount > 0 && /\b(thin|expand|word count|short content|refresh)\b/.test(normalized)) {
    return `Grounded in on-page health: ${context.thinContentCount} thin-content article${context.thinContentCount === 1 ? "" : "s"}.`;
  }

  if (context.noInternalLinksCount > 0 && /\b(internal link|internal links|linking|orphan)\b/.test(normalized)) {
    return `Grounded in on-page health: ${context.noInternalLinksCount} article${context.noInternalLinksCount === 1 ? "" : "s"} with no internal links.`;
  }

  return null;
}

function groundedStrategyItems(
  items: string[],
  context: Parameters<typeof evidenceForStrategyItem>[1],
): { items: string[]; evidence: string[] } {
  const grounded: string[] = [];
  const evidence: string[] = [];

  for (const item of items) {
    const reason = evidenceForStrategyItem(item, context);
    if (!reason) continue;
    grounded.push(item);
    evidence.push(reason);
  }

  return { items: grounded, evidence };
}

export async function POST(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const actor = (await getSessionShop(req)) ?? (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`seo-analyze:${actor}`, 5, 60_000)) {
    return NextResponse.json({ error: "Rate limit: max 5 analyses per minute" }, { status: 429 });
  }

  const [gscData, articleRecords] = await Promise.all([
    getLatestGscData(),
    prisma.articleRecord.findMany({ select: { handle: true, title: true, wordCount: true, internalLinkCount: true, seoData: true }, take: 200 }),
  ]);

  const topQueries = gscData.queries.slice(0, 30);

  const thinContent = articleRecords.filter((a) => (a.wordCount ?? 0) < 300);
  const noInternalLinks = articleRecords.filter((a) => (a.internalLinkCount ?? 0) === 0);
  const missingMeta = articleRecords.filter((a) => hasMissingMeta(a.seoData));
  const existingTitles = articleRecords.map((a) => a.title);
  const articleHandles = new Set(articleRecords.map((a) => a.handle.toLowerCase()));
  const coveredQueries = new Set<string>();

  for (const pair of gscData.queryPagePairs) {
    const handle = articleHandleFromBlogPage(pair.page);
    if (handle && articleHandles.has(handle)) {
      coveredQueries.add(pair.query.toLowerCase());
    }
  }

  if (topQueries.length === 0 && articleRecords.length === 0) {
    return NextResponse.json({ error: "No GSC data or articles available — run fetch-seo-data and fetch-blog-content crons first" }, { status: 400 });
  }

  // Build content gaps programmatically so the AI can't dodge them
  const programmaticGaps: Array<{
    query: string;
    impressions: number;
    position: number;
    suggestedTitle: string;
    issue?: "missing-meta" | "thin-content";
    articleHandle?: string;
    wordCount?: number | null;
  }> = [];

  // 1. Striking-distance GSC queries (pos 5–20)
  for (const q of topQueries) {
    const pos = parseFloat(q.position);
    const queryKey = q.query.toLowerCase();
    const isCovered =
      coveredQueries.has(queryKey) ||
      existingTitles.some((title) => titleCoversQuery(title, q.query));
    if (pos >= 5 && pos <= 20 && !isCovered) {
      const cap = q.query.charAt(0).toUpperCase() + q.query.slice(1);
      programmaticGaps.push({
        query: q.query,
        impressions: q.impressions,
        position: pos,
        suggestedTitle: `${cap}: Benefits, Uses & Complete Guide`,
      });
    }
  }

  // 2. Thin articles (likely need expansion)
  for (const a of thinContent.slice(0, 5)) {
    programmaticGaps.push({
      query: a.title.toLowerCase(),
      impressions: 0,
      position: 0,
      suggestedTitle: a.title,
      issue: "thin-content",
      articleHandle: a.handle,
      wordCount: a.wordCount,
    });
  }

  // 3. Missing-meta articles (highest priority fix)
  for (const a of missingMeta.slice(0, 5)) {
    if (!programmaticGaps.find(g => g.suggestedTitle.startsWith(a.title))) {
      programmaticGaps.push({
        query: a.title.toLowerCase(),
        impressions: 0,
        position: 0,
        suggestedTitle: a.title,
        issue: "missing-meta",
        articleHandle: a.handle,
        wordCount: a.wordCount,
      });
    }
  }

  const aiTimeout = AbortSignal.timeout(25_000);
  try {
    const ai = await getAiClient({ deepseekModel: "deepseek-v4-pro", openRouterModel: "deepseek/deepseek-v4-pro" });
    const response = await ai.client.chat.completions.create({
      model: ai.model,
      max_tokens: 1000,
      messages: [
        {
          role: "system",
          content: `You are an SEO strategist for Agriko (agrikoph.com), a Philippine health food brand with a recipe and health blog.
They sell organic rice, black rice, moringa, ginger, and herbal superfoods.

You will be given pre-identified content gaps and health issues. Your job is to write:
1. An honest 2-3 sentence summary of the SEO situation
2. 3-5 specific quick wins (concrete actions, name the article or query)
3. 3-5 specific recommendations

Respond ONLY with a JSON object — no preamble, no markdown:
{
  "summary": "...",
  "quickWins": ["action 1", "action 2"],
  "recommendations": ["rec 1", "rec 2"]
}`,
        },
        {
          role: "user",
          content: `GSC data: ${topQueries.length} queries tracked.
${topQueries.map(q => `- "${q.query}" pos ${q.position}, ${q.impressions} impressions, ${q.clicks} clicks`).join("\n")}

On-page health (${articleRecords.length} articles total):
- ${missingMeta.length} missing meta title/description
- ${thinContent.length} thin content (<300 words): e.g. ${thinContent.slice(0, 3).map(a => `"${a.title}" (${a.wordCount}w)`).join(", ")}
- ${noInternalLinks.length} articles with no internal links

Pre-identified gaps to act on:
${programmaticGaps.map(g => `- "${g.suggestedTitle}"`).join("\n")}

Sample article titles: ${existingTitles.slice(0, 20).join(", ")}`,
        },
      ],
    }, { signal: aiTimeout });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    let aiResult: Record<string, unknown> = {};
    if (jsonMatch) {
      try { aiResult = JSON.parse(jsonMatch[0]); } catch { /* ignore */ }
    }
    const validated = SeoAnalysisSchema.safeParse(aiResult);
    const parsedAnalysis = validated.success ? validated.data : { quickWins: [], recommendations: [] };
    const evidenceContext = {
      queries: topQueries,
      articles: articleRecords,
      missingMetaCount: missingMeta.length,
      thinContentCount: thinContent.length,
      noInternalLinksCount: noInternalLinks.length,
    };
    const quickWins = groundedStrategyItems(parsedAnalysis.quickWins, evidenceContext);
    const recommendations = groundedStrategyItems(parsedAnalysis.recommendations, evidenceContext);

    const analysis = {
      summary: parsedAnalysis.summary ?? `${articleRecords.length} articles indexed. ${missingMeta.length} missing meta, ${thinContent.length} thin content, ${noInternalLinks.length} with no internal links.`,
      quickWins: quickWins.items,
      quickWinEvidence: quickWins.evidence,
      contentGaps: programmaticGaps,
      recommendations: recommendations.items,
      recommendationEvidence: recommendations.evidence,
    };

    await prisma.rawSnapshot.upsert({
      where: { source_dateRangeStart_dateRangeEnd: { source: "seo_analysis", dateRangeStart: new Date(0), dateRangeEnd: new Date(0) } },
      update: { payload: analysis as object, fetchedAt: new Date() },
      create: { source: "seo_analysis", dateRangeStart: new Date(0), dateRangeEnd: new Date(0), payload: analysis as object },
    });

    return NextResponse.json({ analysis, gscFetchedAt: gscData.fetchedAt, gscSource: gscData.source });
  } catch (err) {
    if (aiTimeout.aborted) {
      console.error("[seo/analyze] AI completion timed out after 25s");
      return NextResponse.json({ error: "Analysis timed out — please try again" }, { status: 504 });
    }
    console.error("[seo/analyze]", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
