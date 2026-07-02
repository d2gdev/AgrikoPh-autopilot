export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { requireAppAuth, getSessionShop, getSessionUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { chatCompletionWithFailover } from "@/lib/ai/client";
import { getLatestGscData, getLatestGa4Data } from "@/lib/seo/data";
import { groundSeoBriefContext } from "@/lib/seo/brief-grounding";

// Generous ceiling for display; over-length responses are truncated at a line
// boundary, NOT rejected. (A 2,000-char hard cap used to reject verbose-but-
// valid briefs with a misleading "empty brief" error — retrying never helped.)
const MAX_BRIEF_CHARS = 6_000;

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

  let aiTimeout: AbortSignal | undefined;
  try {
    const baseUserContent = `Generate a concise SEO brief (3-5 bullet points) based on this data:\n\nGoogle Search Console:\n${gscData}\n\nGA4:\n${ga4Data}\n\nFocus on: top opportunities, content gaps, quick wins. Keep it under 200 words.`;
    const groundedUserContent = await groundSeoBriefContext(baseUserContent, targetKeyword);
    // Started only now, not before grounding — retrieveContext bounds itself
    // independently, but starting this timer any earlier would still let
    // however long grounding took eat into the AI completion's own budget.
    aiTimeout = AbortSignal.timeout(25_000);
    // Fails over to OpenRouter if DeepSeek resets the connection (a recurring
    // ECONNRESET from this host on long responses) — the whole reason this brief
    // was surfacing "temporarily unavailable".
    const { content } = await chatCompletionWithFailover({
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
    }, { requestOptions: { signal: aiTimeout } });

    let brief = (content ?? "").trim();
    if (!brief) {
      console.error("[seo/brief] AI returned empty content");
      return NextResponse.json({ error: "AI returned an empty brief - please retry" }, { status: 502 });
    }
    if (brief.length > MAX_BRIEF_CHARS) {
      console.warn(`[seo/brief] brief over ${MAX_BRIEF_CHARS} chars (${brief.length}); truncating at line boundary`);
      const cut = brief.slice(0, MAX_BRIEF_CHARS);
      const lastBreak = cut.lastIndexOf("\n");
      brief = (lastBreak > MAX_BRIEF_CHARS - 500 ? cut.slice(0, lastBreak) : cut).trimEnd() + "\n…";
    }

    return NextResponse.json({ brief });
  } catch (err) {
    if (aiTimeout?.aborted) {
      console.error("[seo/brief] AI completion timed out after 25s");
      return NextResponse.json({ error: "Brief generation timed out — please try again" }, { status: 504 });
    }
    console.error("[seo/brief]", err);
    const classified = classifyBriefError(err);
    return NextResponse.json(classified, { status: classified.status });
  }
}
