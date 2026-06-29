import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAppAuth, getSessionShop } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAiClient } from "@/lib/ai/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const shop = (await getSessionShop(req)) ?? "api";
  const allowed = await checkRateLimit(`seo-brief:${shop}`, 10, 60_000);
  if (!allowed) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  const [gscSnap, ga4Snap] = await Promise.all([
    prisma.rawSnapshot.findFirst({ where: { source: "gsc" }, orderBy: { fetchedAt: "desc" } }),
    prisma.rawSnapshot.findFirst({ where: { source: "ga4" }, orderBy: { fetchedAt: "desc" } }),
  ]);

  if (!gscSnap && !ga4Snap) {
    return NextResponse.json({ error: "No SEO data available — run the analyzer first" }, { status: 400 });
  }

  const gscPayload = gscSnap?.payload as Record<string, unknown> | null | undefined;
  const ga4Payload = ga4Snap?.payload as Record<string, unknown> | null | undefined;
  const gscQueries = Array.isArray(gscPayload?.topQueries)
    ? (gscPayload!.topQueries as Array<{ query?: string }>).slice(0, 20).map((r) => r.query ?? "").filter(Boolean).join(", ")
    : null;
  const ga4Pages = Array.isArray(ga4Payload?.topPages)
    ? (ga4Payload!.topPages as Array<{ page?: string }>).slice(0, 20).map((r) => r.page ?? "").filter(Boolean).join(", ")
    : null;
  const gscData = gscQueries ? `Top queries: ${gscQueries}` : "No GSC data";
  const ga4Data = ga4Pages ? `Top pages: ${ga4Pages}` : "No GA4 data";

  const ai = await getAiClient({ openRouterModel: "anthropic/claude-sonnet-4-6" });
  const aiTimeout = AbortSignal.timeout(25_000);
  let response: Awaited<ReturnType<typeof ai.client.chat.completions.create>>;
  try {
    response = await ai.client.chat.completions.create({
      model: ai.model,
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content: "You are an SEO strategist for Agriko (agrikoph.com), a Philippine health food brand. Write concise, actionable SEO briefs based on Search Console and GA4 data.",
        },
        {
          role: "user",
          content: `Generate a concise SEO brief (3-5 bullet points) based on this data:\n\nGoogle Search Console:\n${gscData}\n\nGA4:\n${ga4Data}\n\nFocus on: top opportunities, content gaps, quick wins. Keep it under 200 words.`,
        },
      ],
    }, { signal: aiTimeout });
  } catch (err) {
    if (aiTimeout.aborted) {
      console.error("[seo/brief] AI completion timed out after 25s");
      return NextResponse.json({ error: "Brief generation timed out — please try again" }, { status: 504 });
    }
    console.error("[seo/brief]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const brief = response.choices[0]?.message?.content ?? "Unable to generate brief";
  return NextResponse.json({ brief });
}
