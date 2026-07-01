import { getAiClient } from "@/lib/ai/client";
import { prisma } from "@/lib/db";

// Translate Market Intelligence captures (competitor ad copy, shopping titles) to
// English for display. Source text is scraped from real competitor ads and may be
// in Tagalog/Filipino; we keep the original and store an English version alongside.
// See memory: english-only-output.

const BATCH_SIZE = 40;

export type TranslationResult = { text: string; ok: boolean };

/**
 * Translate an ordered list of strings to English in one LLM call per batch.
 * Already-English strings are returned unchanged. Output length and order match
 * the input; on any failure the original string is returned with ok:false so
 * callers can avoid persisting it as if it were a real translation — writing a
 * fallback into the same column the "still needs translation" query filters on
 * would otherwise permanently hide the row from every future retry.
 */
export async function translateToEnglishBatch(texts: string[]): Promise<TranslationResult[]> {
  if (texts.length === 0) return [];
  const ai = await getAiClient();
  const out: TranslationResult[] = [];

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
        out.push(...parsed.map((v, idx) => ({
          text: typeof v === "string" && v.trim() ? v : chunk[idx] ?? "",
          ok: true,
        })));
      } else {
        out.push(...chunk.map((t) => ({ text: t, ok: false }))); // shape mismatch — fall back, but flag as unretranslated
      }
    } catch {
      out.push(...chunk.map((t) => ({ text: t, ok: false }))); // never block capture on translation failure — but flag as unretranslated
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

// Translates `rows` and persists the result only for entries that actually
// translated successfully — a failed entry is left untouched so it stays
// eligible for the next run's `WHERE <column>: null` selection, instead of
// being permanently marked "done" with an untranslated fallback value.
// Returns the count of rows actually written.
async function translateAndPersist<T extends { id: string }>(
  rows: T[],
  getText: (row: T) => string,
  persist: (row: T, translatedText: string) => Promise<unknown>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const translated = await translateToEnglishBatch(rows.map(getText));
  const succeeded = rows
    .map((row, idx) => ({ row, result: translated[idx] }))
    .filter((entry): entry is { row: T; result: TranslationResult } => entry.result?.ok === true);
  await Promise.all(succeeded.map(({ row, result }) => persist(row, result.text)));
  return succeeded.length;
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
  result.shopping = await translateAndPersist(
    shopping,
    (r) => r.title,
    (r, titleEn) => prisma.shoppingResult.update({ where: { id: r.id }, data: { titleEn } }),
  );

  // Ad headlines
  const headlines = await prisma.competitorAd.findMany({
    where: { headlineEn: null, headline: { not: null } },
    select: { id: true, headline: true },
    take: limit,
  });
  result.adHeadlines = await translateAndPersist(
    headlines,
    (r) => r.headline ?? "",
    (r, headlineEn) => prisma.competitorAd.update({ where: { id: r.id }, data: { headlineEn } }),
  );

  const captureHeadlines = await prisma.competitorAdCapture.findMany({
    where: { headlineEn: null, headline: { not: null } },
    select: { id: true, headline: true },
    take: limit,
  });
  result.adCaptureHeadlines = await translateAndPersist(
    captureHeadlines,
    (r) => r.headline ?? "",
    (r, headlineEn) => prisma.competitorAdCapture.update({ where: { id: r.id }, data: { headlineEn } }),
  );

  // Ad copy
  const copies = await prisma.competitorAd.findMany({
    where: { adCopyEn: null, adCopy: { not: null } },
    select: { id: true, adCopy: true },
    take: limit,
  });
  result.adCopies = await translateAndPersist(
    copies,
    (r) => r.adCopy ?? "",
    (r, adCopyEn) => prisma.competitorAd.update({ where: { id: r.id }, data: { adCopyEn } }),
  );

  const captureCopies = await prisma.competitorAdCapture.findMany({
    where: { adCopyEn: null, adCopy: { not: null } },
    select: { id: true, adCopy: true },
    take: limit,
  });
  result.adCaptureCopies = await translateAndPersist(
    captureCopies,
    (r) => r.adCopy ?? "",
    (r, adCopyEn) => prisma.competitorAdCapture.update({ where: { id: r.id }, data: { adCopyEn } }),
  );

  return result;
}
