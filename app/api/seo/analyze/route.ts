export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAppAuth, getSessionShop } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAiClient } from "@/lib/ai/client";

export async function POST(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const shop = (await getSessionShop(req)) ?? "api";
  if (!checkRateLimit(`seo-analyze:${shop}`, 5, 60_000)) {
    return NextResponse.json({ error: "Rate limit: max 5 analyses per minute" }, { status: 429 });
  }

  const [gscSnap, articleRecords] = await Promise.all([
    prisma.rawSnapshot.findFirst({ where: { source: "gsc" }, orderBy: { fetchedAt: "desc" } }),
    prisma.articleRecord.findMany({ select: { handle: true, title: true, wordCount: true, internalLinkCount: true, seoData: true }, take: 200 }),
  ]);

  const topQueries = ((gscSnap?.payload as Record<string, unknown>)?.topQueries as Array<{
    query: string; clicks: number; impressions: number; ctr: string; position: string;
  }> ?? []).slice(0, 30);

  const thinContent = articleRecords.filter((a) => (a.wordCount ?? 0) < 300);
  const noInternalLinks = articleRecords.filter((a) => (a.internalLinkCount ?? 0) === 0);
  const missingMeta = articleRecords.filter((a) => {
    const seo = a.seoData as Record<string, unknown> | null;
    return !seo?.metaTitle && !seo?.metaDescription;
  });
  const existingTitles = articleRecords.map((a) => a.title);

  if (topQueries.length === 0 && articleRecords.length === 0) {
    return NextResponse.json({ error: "No GSC data or articles available — run fetch-seo-data and fetch-blog-content crons first" }, { status: 400 });
  }

  // Build content gaps programmatically so the AI can't dodge them
  const programmaticGaps: Array<{ query: string; impressions: number; position: number; suggestedTitle: string }> = [];

  // 1. Striking-distance GSC queries (pos 5–20)
  for (const q of topQueries) {
    const pos = parseFloat(q.position);
    if (pos >= 5 && pos <= 20) {
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
      suggestedTitle: `${a.title} (expand — currently ${a.wordCount} words)`,
    });
  }

  // 3. Missing-meta articles (highest priority fix)
  for (const a of missingMeta.slice(0, 5)) {
    if (!programmaticGaps.find(g => g.suggestedTitle.startsWith(a.title))) {
      programmaticGaps.push({
        query: a.title.toLowerCase(),
        impressions: 0,
        position: 0,
        suggestedTitle: `${a.title} (add meta title + description)`,
      });
    }
  }

  const aiTimeout = AbortSignal.timeout(25_000);
  try {
    const ai = await getAiClient({ openRouterModel: "anthropic/claude-sonnet-4-6" });
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

    const analysis = {
      summary: aiResult.summary ?? `${articleRecords.length} articles indexed. ${missingMeta.length} missing meta, ${thinContent.length} thin content, ${noInternalLinks.length} with no internal links.`,
      quickWins: aiResult.quickWins ?? [],
      contentGaps: programmaticGaps,
      recommendations: aiResult.recommendations ?? [],
    };

    await prisma.rawSnapshot.upsert({
      where: { source_dateRangeStart_dateRangeEnd: { source: "seo_analysis", dateRangeStart: new Date(0), dateRangeEnd: new Date(0) } },
      update: { payload: analysis as object, fetchedAt: new Date() },
      create: { source: "seo_analysis", dateRangeStart: new Date(0), dateRangeEnd: new Date(0), payload: analysis as object },
    });

    return NextResponse.json({ analysis, gscFetchedAt: gscSnap?.fetchedAt ?? null });
  } catch (err) {
    if (aiTimeout.aborted) {
      console.error("[seo/analyze] AI completion timed out after 25s");
      return NextResponse.json({ error: "Analysis timed out — please try again" }, { status: 504 });
    }
    console.error("[seo/analyze]", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
