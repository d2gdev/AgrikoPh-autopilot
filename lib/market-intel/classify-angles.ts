import { getAiClient } from "@/lib/ai/client";
import { prisma } from "@/lib/db";

// Classifies competitor ad creative into a fixed set of marketing "angles" so
// the Market Intelligence view can show what kind of message each long-running
// ad uses, and aggregate which angles endure. Mirrors translate-captures.ts:
// best-effort, batched, never throws/blocks a capture run.

const BATCH_SIZE = 30;

/** Allowed angle labels. The LLM must pick exactly one of these per ad. */
export const AD_ANGLES = [
  "discount",
  "social-proof",
  "problem-solution",
  "ugc",
  "founder-story",
  "product-feature",
  "urgency",
  "educational",
  "other",
] as const;
export type AdAngle = (typeof AD_ANGLES)[number];

const ANGLE_SET = new Set<string>(AD_ANGLES);

export type AngleResult = { angle: AdAngle; ok: boolean };

/**
 * Classify ad copy into one angle each — JSON array, same length/order.
 * On failure, falls back to "other" with ok:false so callers can avoid
 * persisting it as if it were a real classification — writing "other" into
 * the same column the "still needs classifying" query filters on would
 * otherwise permanently hide the row from every future retry.
 */
export async function classifyAnglesBatch(texts: string[]): Promise<AngleResult[]> {
  if (texts.length === 0) return [];
  const ai = await getAiClient();
  const out: AngleResult[] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const chunk = texts.slice(i, i + BATCH_SIZE);
    try {
      const response = await ai.client.chat.completions.create({
        model: ai.model,
        // deepseek does internal reasoning that consumes the token budget before
        // emitting content; too low a cap returns empty. Match translate-captures.
        max_tokens: 4096,
        messages: [
          {
            role: "system",
            content:
              "You label advertising creative by its primary marketing angle. " +
              `Allowed labels (choose EXACTLY one per ad): ${AD_ANGLES.join(", ")}. ` +
              "Definitions: discount=price/promo/sale; social-proof=reviews/ratings/testimonials/popularity; " +
              "problem-solution=names a pain then offers the product as the fix; ugc=casual user/creator-style or personal story selling a product; " +
              "founder-story=brand/founder origin or mission; product-feature=ingredients/specs/benefits-led; " +
              "urgency=scarcity/limited-time/act-now; educational=tips/how-to/teaching with soft sell; other=none clearly fit. " +
              "Return ONLY a JSON array of label strings, same length and order as the input. No commentary.",
          },
          { role: "user", content: JSON.stringify(chunk) },
        ],
      });
      const raw = response.choices[0]?.message?.content ?? "";
      const parsed = parseJsonArray(raw);
      if (parsed && parsed.length === chunk.length) {
        out.push(...parsed.map((v) => ({ angle: normalizeAngle(v), ok: true })));
      } else {
        out.push(...chunk.map(() => ({ angle: "other" as AdAngle, ok: false })));
      }
    } catch {
      out.push(...chunk.map(() => ({ angle: "other" as AdAngle, ok: false })));
    }
  }
  return out;
}

function normalizeAngle(v: unknown): AdAngle {
  const s = typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, "-") : "";
  return (ANGLE_SET.has(s) ? s : "other") as AdAngle;
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

function creativeText(row: { adCopy: string | null; adCopyEn: string | null; headline: string | null; headlineEn: string | null }): string {
  return `${row.headlineEn ?? row.headline ?? ""}\n${row.adCopyEn ?? row.adCopy ?? ""}`.trim().slice(0, 1200);
}

// Classifies `rows` and persists creativeAngle only for entries that actually
// classified successfully — a failed entry is left untouched so it stays
// eligible for the next run's `creativeAngle: null` selection, instead of
// being permanently marked "done" with the "other" fallback.
async function classifyAndPersist<T extends { id: string }>(
  rows: T[],
  persist: (row: T, angle: AdAngle) => Promise<unknown>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const texts = rows.map((r) => creativeText(r as unknown as Parameters<typeof creativeText>[0]));
  const results = await classifyAnglesBatch(texts);
  const succeeded = rows
    .map((row, idx) => ({ row, result: results[idx] }))
    .filter((entry): entry is { row: T; result: AngleResult } => entry.result?.ok === true);
  await Promise.all(succeeded.map(({ row, result }) => persist(row, result.angle)));
  return succeeded.length;
}

/**
 * Fill missing creativeAngle for captured ads. Prefers the English copy.
 * Used at the end of a capture run and by a one-time backfill. `limit` caps
 * rows processed per invocation.
 */
export async function fillCreativeAngles({ limit = 300 }: { limit?: number } = {}) {
  const ads = await prisma.competitorAd.findMany({
    where: { creativeAngle: null, OR: [{ adCopyEn: { not: null } }, { adCopy: { not: null } }] },
    select: { id: true, adCopy: true, adCopyEn: true, headlineEn: true, headline: true },
    take: limit,
  });
  const adsClassified = await classifyAndPersist(
    ads,
    (a, creativeAngle) => prisma.competitorAd.update({ where: { id: a.id }, data: { creativeAngle } }),
  );

  const captures = await prisma.competitorAdCapture.findMany({
    where: { creativeAngle: null, OR: [{ adCopyEn: { not: null } }, { adCopy: { not: null } }] },
    select: { id: true, adCopy: true, adCopyEn: true, headlineEn: true, headline: true },
    take: limit,
  });
  const capturesClassified = await classifyAndPersist(
    captures,
    (a, creativeAngle) => prisma.competitorAdCapture.update({ where: { id: a.id }, data: { creativeAngle } }),
  );

  return { classified: adsClassified + capturesClassified };
}
