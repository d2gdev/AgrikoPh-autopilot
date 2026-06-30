export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppAuth, getSessionShop, getSessionUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAiClient } from "@/lib/ai/client";
import { getLatestGscData, getLatestGa4Data } from "@/lib/seo/data";
import { groundSeoBriefContext } from "@/lib/seo/brief-grounding";

const SeoBriefSchema = z.string().trim().min(1).max(2_000);

function classifyBriefError(err: unknown): { status: number; error: string; detail?: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("authentication fails") || lower.includes("api key") || lower.includes("401")) {
    return {
      status: 503,
      error: "AI provider authentication failed",
      detail: "The configured AI API key is invalid or expired. Update the DeepSeek/OpenRouter credential, then retry SEO brief generation.",
    };
  }
  if (lower.includes("no ai provider configured") || lower.includes("provider not configured")) {
    return { status: 503, error: "AI provider is not configured", detail: "Set a valid DeepSeek or OpenRouter API key, then retry SEO brief generation." };
  }
  return { status: 503, error: "Brief generation temporarily unavailable", detail: raw.slice(0, 500) };
}

export async function POST(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const actor = (await getSessionShop(req)) ?? (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`seo-brief:${actor}`, 10, 60_000)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }
  const [gscLatest, ga4Latest] = await Promise.all([
    getLatestGscData(),
    getLatestGa4Data(),
  ]);

  if (gscLatest.queries.length === 0 && ga4Latest.pages.length === 0) {
    return NextResponse.json({ error: "No SEO data available — run the analyzer first" }, { status: 400 });
  }

  const gscQueries = gscLatest.queries.slice(0, 20).map((r) => r.query).filter(Boolean).join(", ");
  const ga4Pages = ga4Latest.pages.slice(0, 20).map((r) => r.page).filter(Boolean).join(", ");
  const gscData = gscQueries ? `Top queries: ${gscQueries}` : "No GSC data";
  const ga4Data = ga4Pages ? `Top pages: ${ga4Pages}` : "No GA4 data";
  const targetKeyword = gscLatest.queries[0]?.query || ga4Latest.pages[0]?.page || "Agriko SEO";

  const aiTimeout = AbortSignal.timeout(25_000);
  try {
    const ai = await getAiClient();
    const baseUserContent = `Generate a concise SEO brief (3-5 bullet points) based on this data:\n\nGoogle Search Console:\n${gscData}\n\nGA4:\n${ga4Data}\n\nFocus on: top opportunities, content gaps, quick wins. Keep it under 200 words.`;
    const groundedUserContent = await groundSeoBriefContext(baseUserContent, targetKeyword);
    const response = await ai.client.chat.completions.create({
      model: ai.model,
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content: "You are an SEO strategist for Agriko (agrikoph.com), a Philippine health food brand. Write concise, actionable SEO briefs based on Search Console and GA4 data.",
        },
        {
          role: "user",
          content: groundedUserContent,
        },
      ],
    }, { signal: aiTimeout });

    const msg = response.choices[0]?.message as Record<string, unknown> | undefined;
    const content = ((msg?.content as string) || (msg?.reasoning_content as string) || "").trim();
    const parsedBrief = SeoBriefSchema.safeParse(content);
    if (!parsedBrief.success) {
      console.error("[seo/brief] invalid AI output", parsedBrief.error.flatten());
      return NextResponse.json({ error: "AI returned an empty brief - please retry" }, { status: 502 });
    }

    return NextResponse.json({ brief: parsedBrief.data });
  } catch (err) {
    if (aiTimeout.aborted) {
      console.error("[seo/brief] AI completion timed out after 25s");
      return NextResponse.json({ error: "Brief generation timed out — please try again" }, { status: 504 });
    }
    console.error("[seo/brief]", err);
    const classified = classifyBriefError(err);
    return NextResponse.json(classified, { status: classified.status });
  }
}
