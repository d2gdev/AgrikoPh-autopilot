export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAppAuth, requirePermission, getSessionShop, getSessionUser, PERMISSIONS } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { chatCompletionWithFailover } from "@/lib/ai/client";
import { parseJsonObject } from "@/lib/seo/ai-output";
import { getLatestGscData } from "@/lib/seo/data";
import { buildMapAwareSeoGaps, createMapAnalysisEnvelope, SEO_ANALYSIS_MAX_AGE_HOURS, type SeoAnalysisLimits } from "@/lib/seo/analysis";
import { loadActiveTopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import { hasMissingMeta } from "@/lib/seo/meta";
import { normalizeGovernedUrl } from "@/lib/topical-map/url-normalizer";
import type { Prisma } from "@prisma/client";

const SeoAnalysisSchema = z.object({
  summary: z.string().trim().min(1).max(2_000).optional(),
  quickWins: z.array(z.string().trim().min(1).max(500)).max(8).default([]),
  recommendations: z.array(z.string().trim().min(1).max(500)).max(8).default([]),
});

class AnalysisPersistenceError extends Error {}

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
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;
  const actor = (await getSessionShop(req)) ?? (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`seo-analyze:${actor}`, 5, 60_000)) {
    return NextResponse.json({ error: "Rate limit: max 5 analyses per minute" }, { status: 429 });
  }

  const ARTICLE_LIMIT = 200;
  const commandCenter = await loadActiveTopicalMapCommandCenter(prisma);
  if (!commandCenter) return NextResponse.json({ error: "Active topical-map strategy is unavailable", code: "ACTIVE_STRATEGY_UNAVAILABLE" }, { status: 409 });
  const governedPageHandles = [...new Set(commandCenter.pages.map(page => /^\/blogs\/[^/]+\/([^/]+)$/.exec(page.url)?.[1]).filter((value): value is string => Boolean(value)))];
  const governedBlogHandles = [...new Set([...governedPageHandles, ...commandCenter.work.internalLinks.map(link => /^\/blogs\/[^/]+\/([^/]+)$/.exec(link.fromUrl)?.[1]).filter((value): value is string => Boolean(value))])];
  const [gscData, articleCandidates, governedArticles] = await Promise.all([
    getLatestGscData(),
    prisma.articleRecord.findMany({
      select: { handle: true, title: true, wordCount: true, internalLinkCount: true, seoData: true, indexedAt: true },
      orderBy: [{ indexedAt: "desc" }, { handle: "asc" }],
      take: ARTICLE_LIMIT + 1,
    }),
    prisma.articleRecord.findMany({ where: { handle: { in: governedBlogHandles } }, select: { handle: true, title: true, wordCount: true, internalLinkCount: true, seoData: true, linksData: true, indexedAt: true } }),
  ]);

  const topQueries = gscData.queries.slice(0, 30);
  const articleRecords = articleCandidates.slice(0, ARTICLE_LIMIT);
  const mapArticles = [...new Map([...governedArticles, ...articleRecords].map(article => [article.handle, article])).values()];
  const analysisAsOf = new Date();
  const verifiedAbsentUrls = new Map(governedPageHandles.filter(handle => !governedArticles.some(article => article.handle === handle)).flatMap(handle => commandCenter.pages.filter(page => page.url.endsWith(`/${handle}`)).map(page => [page.url, analysisAsOf] as const)));
  const linkInspections = new Map<string, { capturedAt: Date; targets: Set<string> }>();
  for (const article of governedArticles) {
    const source = commandCenter.work.internalLinks.find(link => link.fromUrl.endsWith(`/${article.handle}`))?.fromUrl;
    if (!source || !(article.indexedAt instanceof Date)) continue;
    const internal = article.linksData && typeof article.linksData === "object" && Array.isArray((article.linksData as { internal?: unknown }).internal) ? (article.linksData as { internal: Array<{ href?: unknown }> }).internal : [];
    linkInspections.set(source, { capturedAt: article.indexedAt, targets: new Set(internal.flatMap(link => typeof link.href === "string" ? [normalizeGovernedUrl(link.href)] : [])) });
  }
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

  const mapAnalysis = buildMapAwareSeoGaps({
    strategy: commandCenter.identity,
    commandCenter,
    queries: gscData.queries,
    queryPagePairs: gscData.queryPagePairs,
    articles: mapArticles,
    verifiedAbsentUrls,
    linkInspections,
    asOf: analysisAsOf,
  });
  const programmaticGaps = mapAnalysis.gaps;

  const deterministicQuickWins = [
    missingMeta.length > 0 ? {
      item: `Fix missing meta on ${missingMeta.length} article${missingMeta.length === 1 ? "" : "s"}, starting with “${missingMeta[0]?.title}”.`,
      evidence: `${missingMeta.length} indexed article${missingMeta.length === 1 ? " is" : "s are"} missing a meta title or description.`,
    } : null,
    thinContent.length > 0 ? {
      item: `Expand thin content on ${thinContent.length} article${thinContent.length === 1 ? "" : "s"}, starting with “${thinContent[0]?.title}”.`,
      evidence: `${thinContent.length} indexed article${thinContent.length === 1 ? " has" : "s have"} fewer than 300 words.`,
    } : null,
    noInternalLinks.length > 0 ? {
      item: `Add internal links to ${noInternalLinks.length} article${noInternalLinks.length === 1 ? "" : "s"}, starting with “${noInternalLinks[0]?.title}”.`,
      evidence: `${noInternalLinks.length} indexed article${noInternalLinks.length === 1 ? " has" : "s have"} no internal links.`,
    } : null,
  ].filter((entry): entry is { item: string; evidence: string } => entry !== null);

  const partialAnalysis = (aiError: string) => ({
    summary: `${articleRecords.length} articles indexed. ${missingMeta.length} missing meta, ${thinContent.length} thin content, ${noInternalLinks.length} with no internal links.`,
    quickWins: deterministicQuickWins.map((entry) => entry.item),
    quickWinEvidence: deterministicQuickWins.map((entry) => entry.evidence),
    recommendations: [], recommendationEvidence: [],
    contentGaps: programmaticGaps, observations: mapAnalysis.observations, suppressedGaps: mapAnalysis.suppressed, limits, aiStatus: "partial" as const, aiError,
  });
  const persistAnalysis = async (presentation: Record<string, unknown>, generatedAt: Date) => {
    const candidateTimes = mapAnalysis.gaps.map(gap => ({ source: gap.observation.source, capturedAt: new Date(gap.observation.capturedAt) }));
    const oldest = (source: "store" | "link_inspection") => candidateTimes.filter(item => item.source === source).reduce<Date | null>((value, item) => !value || item.capturedAt < value ? item.capturedAt : value, null);
    const storeCapturedAt = oldest("store");
    const linkCapturedAt = oldest("link_inspection");
    const payload = createMapAnalysisEnvelope({
      strategy: commandCenter.identity, generatedAt, analysis: mapAnalysis,
      evidence: { gscCapturedAt: gscData.fetchedAt?.toISOString() ?? null, storeCapturedAt: storeCapturedAt?.toISOString() ?? null, linkCapturedAt: linkCapturedAt?.toISOString() ?? null, maxAgeHours: SEO_ANALYSIS_MAX_AGE_HOURS },
      presentation,
    });
    return prisma.rawSnapshot.upsert({
    where: { source_dateRangeStart_dateRangeEnd: { source: "seo_analysis", dateRangeStart: new Date(0), dateRangeEnd: new Date(0) } },
    update: { payload: payload as unknown as Prisma.InputJsonValue, fetchedAt: generatedAt },
    create: { source: "seo_analysis", dateRangeStart: new Date(0), dateRangeEnd: new Date(0), payload: payload as unknown as Prisma.InputJsonValue, fetchedAt: generatedAt },
    });
  };
  const persistAndRespond = async (analysis: Record<string, unknown>) => {
    const generatedAt = analysisAsOf;
    try {
      await persistAnalysis(analysis, generatedAt);
    } catch {
      throw new AnalysisPersistenceError("Analysis snapshot could not be saved");
    }
    return NextResponse.json({ analysis, mapAnalysis, generatedAt: generatedAt.toISOString(), gscFetchedAt: gscData.fetchedAt, gscSource: gscData.source });
  };

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
      observations: mapAnalysis.observations,
      suppressedGaps: mapAnalysis.suppressed,
      recommendations: recommendations.items,
      recommendationEvidence: recommendations.evidence,
      limits,
      aiStatus: parsed.ok ? "complete" : "partial",
      ...(parsed.ok ? {} : { aiError: "AI returned invalid structured output" }),
    };

    return await persistAndRespond(analysis);
  } catch (err) {
    if (err instanceof AnalysisPersistenceError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    if (aiTimeout.aborted) {
      const analysis = partialAnalysis("AI provider timeout");
      try { return await persistAndRespond(analysis); } catch { return NextResponse.json({ error: "Analysis snapshot could not be saved" }, { status: 500 }); }
    }
    const status = (err as { status?: number })?.status;
    if (status === 401 || status === 403 || status === 429 || status === 503 || (err instanceof Error && /(provider|api key|configured|authentication|unauthorized)/i.test(err.message))) {
      console.error("[seo/analyze] AI provider unavailable");
      const analysis = partialAnalysis("AI provider unavailable");
      try { return await persistAndRespond(analysis); } catch { return NextResponse.json({ error: "Analysis snapshot could not be saved" }, { status: 500 }); }
    }
    console.error("[seo/analyze] AI request failed");
    const analysis = partialAnalysis("AI provider unavailable");
    try { return await persistAndRespond(analysis); } catch { return NextResponse.json({ error: "Analysis snapshot could not be saved" }, { status: 500 }); }
  }
}
