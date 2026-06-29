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

/** Classify ad copy into one angle each — JSON array, same length/order. */
export async function classifyAnglesBatch(texts: string[]): Promise<AdAngle[]> {
  if (texts.length === 0) return [];
  const ai = await getAiClient();
  const out: AdAngle[] = [];

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
        out.push(...parsed.map((v) => normalizeAngle(v)));
      } else {
        out.push(...chunk.map(() => "other" as AdAngle));
      }
    } catch {
      out.push(...chunk.map(() => "other" as AdAngle));
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
  if (ads.length > 0) {
    const texts = ads.map((a) =>
      `${a.headlineEn ?? a.headline ?? ""}\n${a.adCopyEn ?? a.adCopy ?? ""}`.trim().slice(0, 1200),
    );
    const angles = await classifyAnglesBatch(texts);
    await Promise.all(
      ads.map((a, idx) =>
        prisma.competitorAd.update({ where: { id: a.id }, data: { creativeAngle: angles[idx] } }),
      ),
    );
  }

  const captures = await prisma.competitorAdCapture.findMany({
    where: { creativeAngle: null, OR: [{ adCopyEn: { not: null } }, { adCopy: { not: null } }] },
    select: { id: true, adCopy: true, adCopyEn: true, headlineEn: true, headline: true },
    take: limit,
  });
  if (captures.length > 0) {
    const captureTexts = captures.map((a) =>
      `${a.headlineEn ?? a.headline ?? ""}\n${a.adCopyEn ?? a.adCopy ?? ""}`.trim().slice(0, 1200),
    );
    const captureAngles = await classifyAnglesBatch(captureTexts);
    await Promise.all(
      captures.map((a, idx) =>
        prisma.competitorAdCapture.update({ where: { id: a.id }, data: { creativeAngle: captureAngles[idx] } }),
      ),
    );
  }

  return { classified: ads.length + captures.length };
}
