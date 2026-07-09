import { prisma } from "@/lib/db";

const CAPTURE_WINDOW_DAYS = 90;
const TOP_N = 30;
const AD_COPY_EXCERPT_LENGTH = 200;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface AdLongevityRow {
  adArchiveId: string;
  competitorId: string | null;
  competitor: string | null;
  headline: string | null;
  adCopyExcerpt: string | null;
  firstCapturedAt: Date;
  lastActiveCapturedAt: Date;
  daysActive: number;
  stillActive: boolean;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * MS_PER_DAY);
}

type CaptureRow = {
  adArchiveId: string;
  competitorId: string | null;
  competitor: { name: string | null } | null;
  headline: string | null;
  headlineEn: string | null;
  adCopy: string | null;
  adCopyEn: string | null;
  activeStatus: string | null;
  capturedAt: Date;
};

/**
 * Computes ad longevity from CompetitorAdCapture history: for each ad
 * (grouped by competitor + adArchiveId, since the same adArchiveId can in
 * principle be reused by a different competitor/page), finds how many days
 * elapsed between the ad's first capture and the last capture where it was
 * observed ACTIVE. Long-running ads are a competitor's proven winners.
 *
 * Ads that were never captured in an ACTIVE state within the window are
 * excluded — there's no "active span" to report for them.
 *
 * `stillActive` reflects whether the *most recent* capture overall for that
 * ad (active or not) shows an ACTIVE status, so an ad that recently stopped
 * running is correctly flagged as ended even though it has a positive
 * daysActive value from its earlier active run.
 */
export async function computeAdLongevity(competitorId?: string): Promise<AdLongevityRow[]> {
  const captures = (await prisma.competitorAdCapture.findMany({
    where: {
      capturedAt: { gte: daysAgo(CAPTURE_WINDOW_DAYS) },
      ...(competitorId ? { competitorId } : {}),
    },
    select: {
      adArchiveId: true,
      competitorId: true,
      competitor: { select: { name: true } },
      headline: true,
      headlineEn: true,
      adCopy: true,
      adCopyEn: true,
      activeStatus: true,
      capturedAt: true,
    },
    orderBy: { capturedAt: "asc" },
  })) as CaptureRow[];

  type Group = {
    competitorId: string | null;
    competitor: string | null;
    headline: string | null;
    adCopyExcerpt: string | null;
    firstCapturedAt: Date;
    lastCapturedAt: Date;
    lastActiveCapturedAt: Date | null;
    lastActiveStatus: string | null;
  };

  const groups = new Map<string, Group>();

  for (const c of captures) {
    const key = `${c.competitorId ?? "unknown"}::${c.adArchiveId}`;
    const isActive = c.activeStatus === "ACTIVE";
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        competitorId: c.competitorId,
        competitor: c.competitor?.name ?? null,
        headline: c.headlineEn ?? c.headline,
        adCopyExcerpt: (c.adCopyEn ?? c.adCopy)?.slice(0, AD_COPY_EXCERPT_LENGTH) ?? null,
        firstCapturedAt: c.capturedAt,
        lastCapturedAt: c.capturedAt,
        lastActiveCapturedAt: isActive ? c.capturedAt : null,
        lastActiveStatus: c.activeStatus,
      });
      continue;
    }

    // Captures are ordered by capturedAt asc, so the last one seen per
    // group is always the most recent — safe to overwrite representative
    // fields (headline/copy) and the "most recent" tracking fields here.
    existing.lastCapturedAt = c.capturedAt;
    existing.lastActiveStatus = c.activeStatus;
    existing.headline = c.headlineEn ?? c.headline ?? existing.headline;
    existing.adCopyExcerpt = (c.adCopyEn ?? c.adCopy)?.slice(0, AD_COPY_EXCERPT_LENGTH) ?? existing.adCopyExcerpt;
    if (isActive) existing.lastActiveCapturedAt = c.capturedAt;
  }

  const rows: AdLongevityRow[] = [];
  for (const [key, g] of groups) {
    if (!g.lastActiveCapturedAt) continue; // never observed ACTIVE — no active span to report

    const [, adArchiveId] = key.split("::");
    const spanMs = g.lastActiveCapturedAt.getTime() - g.firstCapturedAt.getTime();
    // Floor at 1 day: a single capture (or captures on the same day) still
    // represents a real, observed ad — not zero days of proven activity.
    const daysActive = Math.max(1, Math.round(spanMs / MS_PER_DAY));

    rows.push({
      adArchiveId: adArchiveId!,
      competitorId: g.competitorId,
      competitor: g.competitor,
      headline: g.headline,
      adCopyExcerpt: g.adCopyExcerpt,
      firstCapturedAt: g.firstCapturedAt,
      lastActiveCapturedAt: g.lastActiveCapturedAt,
      daysActive,
      stillActive: g.lastActiveStatus === "ACTIVE",
    });
  }

  return rows.sort((a, b) =>
    b.daysActive - a.daysActive
    || String(a.competitor ?? "").localeCompare(String(b.competitor ?? ""))
    || String(a.headline ?? "").localeCompare(String(b.headline ?? ""))
    || a.adArchiveId.localeCompare(b.adArchiveId)
  ).slice(0, TOP_N);
}
