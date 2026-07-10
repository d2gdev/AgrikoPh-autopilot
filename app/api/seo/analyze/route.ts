export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAppAuth, getSessionShop, getSessionUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { chatCompletionWithFailover } from "@/lib/ai/client";
import { parseJsonObject } from "@/lib/seo/ai-output";
import { getLatestGscData } from "@/lib/seo/data";
import { buildProgrammaticSeoGaps, type SeoAnalysisLimits } from "@/lib/seo/analysis";
import { hasMissingMeta } from "@/lib/seo/meta";

const SeoAnalysisSchema = z.object({
  summary: z.string().trim().min(1).max(2_000).optional(),
  quickWins: z.array(z.string().trim().min(1).max(500)).max(8).default([]),
  recommendations: z.array(z.string().trim().min(1).max(500)).max(8).default([]),
});

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

  const ARTICLE_LIMIT = 200;
  const [gscData, articleCandidates] = await Promise.all([
    getLatestGscData(),
    prisma.articleRecord.findMany({
      select: { handle: true, title: true, wordCount: true, internalLinkCount: true, seoData: true },
      orderBy: [{ indexedAt: "desc" }, { handle: "asc" }],
      take: ARTICLE_LIMIT + 1,
    }),
  ]);

  const topQueries = gscData.queries.slice(0, 30);
  const articleRecords = articleCandidates.slice(0, ARTICLE_LIMIT);
  const limits: SeoAnalysisLimits = {
    queriesTotal: gscData.queries.length,
    queriesAnalyzed: Math.min(gscData.queries.length, 30),
    articlesTotalLowerBound: articleCandidates.length,
    articlesAnalyzed: articleRecords.length,
    articlesTruncated: articleCandidates.length > ARTICLE_LIMIT,
  };

  const thinContent = articleRecords.filter((a) => (a.wordCount ?? 0) < 300);
  const noInternalLinks = articleRecords.filter((a) => (a.internalLinkCount ?? 0) === 0);
  const missingMeta = articleRecords.filter((a) => hasMissingMeta(a.seoData));
  const existingTitles = articleRecords.map((a) => a.title);

  if (topQueries.length === 0 && articleRecords.length === 0) {
    return NextResponse.json({ error: "No GSC data or articles available — run fetch-seo-data and fetch-blog-content crons first" }, { status: 400 });
  }

  const programmaticGaps = buildProgrammaticSeoGaps({
    queries: gscData.queries,
    queryPagePairs: gscData.queryPagePairs,
    articles: articleRecords,
  });

  const aiTimeout = AbortSignal.timeout(25_000);
  try {
    const response = await chatCompletionWithFailover({
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
    }, { deepseekModel: "deepseek-v4-pro", openRouterModel: "deepseek/deepseek-v4-pro", requestOptions: { signal: aiTimeout } });
    const rawContent = response.content ?? (response as unknown as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonObject(rawContent, SeoAnalysisSchema);
    const parsedAnalysis = parsed.ok ? parsed.data : { quickWins: [], recommendations: [] };
    const evidenceContext = {
      queries: topQueries,
      articles: articleRecords,
      missingMetaCount: missingMeta.length,
      thinContentCount: thinContent.length,
      noInternalLinksCount: noInternalLinks.length,
    };
    const quickWins = groundedStrategyItems(parsedAnalysis.quickWins ?? [], evidenceContext);
    const recommendations = groundedStrategyItems(parsedAnalysis.recommendations ?? [], evidenceContext);

    const analysis = {
      summary: parsedAnalysis.summary ?? `${articleRecords.length} articles indexed. ${missingMeta.length} missing meta, ${thinContent.length} thin content, ${noInternalLinks.length} with no internal links.`,
      quickWins: quickWins.items,
      quickWinEvidence: quickWins.evidence,
      contentGaps: programmaticGaps,
      recommendations: recommendations.items,
      recommendationEvidence: recommendations.evidence,
      limits,
      aiStatus: parsed.ok ? "complete" : "partial",
      ...(parsed.ok ? {} : { aiError: "AI returned invalid structured output" }),
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
    const status = (err as { status?: number })?.status;
    if (status === 401 || status === 403 || status === 429 || status === 503 || (err instanceof Error && /(provider|api key|configured|authentication|unauthorized)/i.test(err.message))) {
      console.error("[seo/analyze] AI provider unavailable");
      return NextResponse.json({
        error: "AI provider unavailable",
        analysis: {
          summary: `${articleRecords.length} articles indexed. ${missingMeta.length} missing meta, ${thinContent.length} thin content, ${noInternalLinks.length} with no internal links.`,
          quickWins: [], recommendations: [], contentGaps: programmaticGaps,
          limits, aiStatus: "partial", aiError: "AI provider unavailable",
        },
      }, { status: 200 });
    }
    console.error("[seo/analyze]", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
