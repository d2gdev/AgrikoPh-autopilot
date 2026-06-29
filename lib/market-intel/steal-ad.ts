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
