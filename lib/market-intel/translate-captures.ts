import { getAiClient } from "@/lib/ai/client";
import { prisma } from "@/lib/db";

// Translate Market Intelligence captures (competitor ad copy, shopping titles) to
// English for display. Source text is scraped from real competitor ads and may be
// in Tagalog/Filipino; we keep the original and store an English version alongside.
// See memory: english-only-output.

const BATCH_SIZE = 40;

/**
 * Translate an ordered list of strings to English in one LLM call per batch.
 * Already-English strings are returned unchanged. Output length and order match
 * the input; on any failure the original strings are returned (never throws).
 */
export async function translateToEnglishBatch(texts: string[]): Promise<string[]> {
  if (texts.length === 0) return [];
  const ai = await getAiClient();
  const out: string[] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const chunk = texts.slice(i, i + BATCH_SIZE);
    try {
      const response = await ai.client.chat.completions.create({
        model: ai.model,
        max_tokens: 4096,
        messages: [
          {
            role: "system",
            content:
              "You translate short marketing/ad snippets to English. " +
              "Return ONLY a JSON array of strings, same length and order as the input. " +
              "Translate each item to natural English. If an item is already English, return it unchanged. " +
              "Preserve meaning and keep it concise. Do not add commentary.",
          },
          { role: "user", content: JSON.stringify(chunk) },
        ],
      });
      const raw = response.choices[0]?.message?.content ?? "";
      const parsed = parseJsonArray(raw);
      if (parsed && parsed.length === chunk.length) {
        out.push(...parsed.map((v, idx) => (typeof v === "string" && v.trim() ? v : chunk[idx] ?? "")));
      } else {
        out.push(...chunk); // shape mismatch — fall back to originals
      }
    } catch {
      out.push(...chunk); // never block capture on translation failure
    }
  }
  return out;
}

function parseJsonArray(raw: string): string[] | null {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const arr = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

/**
 * Fill missing English columns (titleEn / headlineEn / adCopyEn) for captured rows.
 * Used both at the end of a capture run and by the one-time backfill script.
 * `limit` caps how many rows of each type are processed per invocation.
 */
export async function fillCaptureTranslations({ limit = 500 }: { limit?: number } = {}) {
  const result = { shopping: 0, adHeadlines: 0, adCopies: 0, adCaptureHeadlines: 0, adCaptureCopies: 0 };

  // Shopping titles
  const shopping = await prisma.shoppingResult.findMany({
    where: { titleEn: null, title: { not: "" } },
    select: { id: true, title: true },
    take: limit,
  });
  if (shopping.length > 0) {
    const translated = await translateToEnglishBatch(shopping.map((r) => r.title));
    await Promise.all(
      shopping.map((r, idx) =>
        prisma.shoppingResult.update({ where: { id: r.id }, data: { titleEn: translated[idx] } }),
      ),
    );
    result.shopping = shopping.length;
  }

  // Ad headlines
  const headlines = await prisma.competitorAd.findMany({
    where: { headlineEn: null, headline: { not: null } },
    select: { id: true, headline: true },
    take: limit,
  });
  if (headlines.length > 0) {
    const translated = await translateToEnglishBatch(headlines.map((r) => r.headline ?? ""));
    await Promise.all(
      headlines.map((r, idx) =>
        prisma.competitorAd.update({ where: { id: r.id }, data: { headlineEn: translated[idx] } }),
      ),
    );
    result.adHeadlines = headlines.length;
  }

  const captureHeadlines = await prisma.competitorAdCapture.findMany({
    where: { headlineEn: null, headline: { not: null } },
    select: { id: true, headline: true },
    take: limit,
  });
  if (captureHeadlines.length > 0) {
    const translated = await translateToEnglishBatch(captureHeadlines.map((r) => r.headline ?? ""));
    await Promise.all(
      captureHeadlines.map((r, idx) =>
        prisma.competitorAdCapture.update({ where: { id: r.id }, data: { headlineEn: translated[idx] } }),
      ),
    );
    result.adCaptureHeadlines = captureHeadlines.length;
  }

  // Ad copy
  const copies = await prisma.competitorAd.findMany({
    where: { adCopyEn: null, adCopy: { not: null } },
    select: { id: true, adCopy: true },
    take: limit,
  });
  if (copies.length > 0) {
    const translated = await translateToEnglishBatch(copies.map((r) => r.adCopy ?? ""));
    await Promise.all(
      copies.map((r, idx) =>
        prisma.competitorAd.update({ where: { id: r.id }, data: { adCopyEn: translated[idx] } }),
      ),
    );
    result.adCopies = copies.length;
  }

  const captureCopies = await prisma.competitorAdCapture.findMany({
    where: { adCopyEn: null, adCopy: { not: null } },
    select: { id: true, adCopy: true },
    take: limit,
  });
  if (captureCopies.length > 0) {
    const translated = await translateToEnglishBatch(captureCopies.map((r) => r.adCopy ?? ""));
    await Promise.all(
      captureCopies.map((r, idx) =>
        prisma.competitorAdCapture.update({ where: { id: r.id }, data: { adCopyEn: translated[idx] } }),
      ),
    );
    result.adCaptureCopies = captureCopies.length;
  }

  return result;
}
