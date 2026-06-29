import { Prisma, type PrismaClient } from "@prisma/client";
import type { MetaAdLibraryAd } from "@/lib/connectors/meta-ad-library";

type AdCaptureClient = Pick<PrismaClient, "competitorAdCapture" | "marketInsight">;

export type TrackedAdFields = {
  adCopy: string | null;
  headline: string | null;
  description: string | null;
  cta: string | null;
  landingPageUrl: string | null;
  activeStatus: string | null;
  creativeType: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
};

export type PreviousAdState = TrackedAdFields & {
  id: string;
  capturedAt?: Date;
};

export type LatestCaptureState = TrackedAdFields & {
  capturedAt: Date;
};

export interface CompetitorAdCaptureInput {
  competitorAdId: string;
  competitorId: string;
  competitorName: string;
  jobRunId: string;
  capturedAt: Date;
  ad: MetaAdLibraryAd;
  savedAd: TrackedAdFields & {
    adArchiveId: string;
    adCopyEn?: string | null;
    headlineEn?: string | null;
    creativeAngle?: string | null;
    rawPayload?: unknown;
  };
  previousAd?: PreviousAdState | null;
}

export interface AdCaptureResult {
  created: boolean;
  captureId?: string;
  reason: "new" | "changed" | "stale" | "unchanged";
  changedFields: string[];
  insightsCreated: number;
}

const TRACKED_FIELDS = [
  "adCopy",
  "headline",
  "description",
  "cta",
  "landingPageUrl",
  "activeStatus",
  "creativeType",
  "imageUrl",
  "videoUrl",
] as const;

const MEANINGFUL_CHANGE_FIELDS = new Set(["adCopy", "headline", "description", "cta", "landingPageUrl", "activeStatus"]);

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function captureDayRange(capturedAt: Date) {
  const start = new Date(Date.UTC(capturedAt.getUTCFullYear(), capturedAt.getUTCMonth(), capturedAt.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function norm(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function fieldLabel(field: string) {
  if (field === "adCopy") return "ad copy";
  if (field === "landingPageUrl") return "landing page";
  if (field === "activeStatus") return "active status";
  if (field === "creativeType") return "creative type";
  if (field === "imageUrl") return "image";
  if (field === "videoUrl") return "video";
  return field;
}

function trackedFromAd(ad: MetaAdLibraryAd): TrackedAdFields {
  return {
    adCopy: norm(ad.adCopy),
    headline: norm(ad.headline),
    description: norm(ad.description),
    cta: norm(ad.cta),
    landingPageUrl: norm(ad.landingPageUrl),
    activeStatus: norm(ad.activeStatus),
    creativeType: norm(ad.creativeType),
    imageUrl: norm(ad.imageUrl),
    videoUrl: norm(ad.videoUrl),
  };
}

export function changedTrackedAdFields(
  previous: Partial<TrackedAdFields> | null | undefined,
  current: Partial<TrackedAdFields>,
): string[] {
  if (!previous) return [];
  return TRACKED_FIELDS.filter((field) => norm(previous[field]) !== norm(current[field]));
}

export function shouldCreateAdCapture(input: {
  latestCapture?: LatestCaptureState | null;
  current: TrackedAdFields;
  capturedAt: Date;
  staleAfterDays?: number;
}): { create: boolean; reason: AdCaptureResult["reason"]; changedFields: string[] } {
  if (!input.latestCapture) {
    return { create: true, reason: "new", changedFields: [] };
  }

  const changedFields = changedTrackedAdFields(input.latestCapture, input.current);
  if (changedFields.length > 0) {
    return { create: true, reason: "changed", changedFields };
  }

  const staleAfterDays = input.staleAfterDays ?? 7;
  const ageDays = (input.capturedAt.getTime() - input.latestCapture.capturedAt.getTime()) / 86_400_000;
  if (ageDays >= staleAfterDays) {
    return { create: true, reason: "stale", changedFields: [] };
  }

  return { create: false, reason: "unchanged", changedFields: [] };
}

export function adChangeInsightData(input: {
  competitorName: string;
  competitorId: string;
  competitorAdId: string;
  adArchiveId: string;
  adSnapshotUrl?: string | null;
  previousAd?: PreviousAdState | null;
  current: TrackedAdFields;
  changedFields: string[];
}): Prisma.MarketInsightUncheckedCreateInput | null {
  const meaningfulFields = input.changedFields.filter((field) => MEANINGFUL_CHANGE_FIELDS.has(field));
  if (!input.previousAd || meaningfulFields.length === 0) return null;

  const reactivated =
    norm(input.previousAd.activeStatus) !== "ACTIVE" &&
    norm(input.current.activeStatus) === "ACTIVE";

  const labels = meaningfulFields.map(fieldLabel);
  return {
    type: "competitor_ad_changed",
    severity: reactivated || meaningfulFields.includes("landingPageUrl") ? "warning" : "info",
    title: `${input.competitorName} changed a competitor ad`,
    summary: `Changed ${labels.join(", ")} for ad ${input.adArchiveId}.`,
    evidence: json({
      adArchiveId: input.adArchiveId,
      adSnapshotUrl: input.adSnapshotUrl ?? null,
      changedFields: meaningfulFields,
      reactivated,
      previous: Object.fromEntries(meaningfulFields.map((field) => [field, input.previousAd?.[field as keyof TrackedAdFields] ?? null])),
      current: Object.fromEntries(meaningfulFields.map((field) => [field, input.current[field as keyof TrackedAdFields] ?? null])),
    }),
    competitorId: input.competitorId,
    adId: input.competitorAdId,
  };
}

export async function recordCompetitorAdCapture(
  prismaClient: AdCaptureClient,
  input: CompetitorAdCaptureInput,
): Promise<AdCaptureResult> {
  const current = trackedFromAd(input.ad);
  const latestCapture = await prismaClient.competitorAdCapture.findFirst({
    where: { adArchiveId: input.savedAd.adArchiveId },
    orderBy: { capturedAt: "desc" },
    select: {
      adCopy: true,
      headline: true,
      description: true,
      cta: true,
      landingPageUrl: true,
      activeStatus: true,
      creativeType: true,
      imageUrl: true,
      videoUrl: true,
      capturedAt: true,
    },
  });

  const decision = shouldCreateAdCapture({ latestCapture, current, capturedAt: input.capturedAt });
  if (!decision.create) {
    return { created: false, reason: "unchanged", changedFields: [], insightsCreated: 0 };
  }

  const { start: captureDate } = captureDayRange(input.capturedAt);
  const existingCapture = await prismaClient.competitorAdCapture.findUnique({
    where: {
      adArchiveId_captureDate: {
        adArchiveId: input.savedAd.adArchiveId,
        captureDate,
      },
    },
    select: { id: true },
  });

  const capture = await prismaClient.competitorAdCapture.upsert({
    where: {
      adArchiveId_captureDate: {
        adArchiveId: input.savedAd.adArchiveId,
        captureDate,
      },
    },
    create: {
      competitorAdId: input.competitorAdId,
      competitorId: input.competitorId,
      jobRunId: input.jobRunId,
      adArchiveId: input.savedAd.adArchiveId,
      adCopy: input.savedAd.adCopy,
      adCopyEn: input.savedAd.adCopyEn ?? null,
      headline: input.savedAd.headline,
      headlineEn: input.savedAd.headlineEn ?? null,
      description: input.savedAd.description,
      cta: input.savedAd.cta,
      landingPageUrl: input.savedAd.landingPageUrl,
      activeStatus: input.savedAd.activeStatus,
      creativeType: input.savedAd.creativeType,
      creativeAngle: input.savedAd.creativeAngle ?? null,
      imageUrl: input.savedAd.imageUrl,
      videoUrl: input.savedAd.videoUrl,
      capturedAt: input.capturedAt,
      captureDate,
      rawPayload: json(input.savedAd.rawPayload ?? input.ad.rawPayload),
    },
    update: {
      competitorAdId: input.competitorAdId,
      competitorId: input.competitorId,
      jobRunId: input.jobRunId,
      adCopy: input.savedAd.adCopy,
      adCopyEn: input.savedAd.adCopyEn ?? null,
      headline: input.savedAd.headline,
      headlineEn: input.savedAd.headlineEn ?? null,
      description: input.savedAd.description,
      cta: input.savedAd.cta,
      landingPageUrl: input.savedAd.landingPageUrl,
      activeStatus: input.savedAd.activeStatus,
      creativeType: input.savedAd.creativeType,
      creativeAngle: input.savedAd.creativeAngle ?? null,
      imageUrl: input.savedAd.imageUrl,
      videoUrl: input.savedAd.videoUrl,
      capturedAt: input.capturedAt,
      captureDate,
      rawPayload: json(input.savedAd.rawPayload ?? input.ad.rawPayload),
    },
  });

  const previousChangeFields = changedTrackedAdFields(input.previousAd, current);
  const insightData = adChangeInsightData({
    competitorName: input.competitorName,
    competitorId: input.competitorId,
    competitorAdId: input.competitorAdId,
    adArchiveId: input.savedAd.adArchiveId,
    adSnapshotUrl: input.ad.adSnapshotUrl,
    previousAd: input.previousAd,
    current,
    changedFields: previousChangeFields,
  });
  let insightsCreated = 0;
  if (insightData) {
    const { start } = captureDayRange(input.capturedAt);
    const captureDay = start.toISOString().slice(0, 10); // YYYY-MM-DD
    const dedupeKey = [
      String(insightData.type),
      insightData.competitorId == null ? '' : String(insightData.competitorId),
      insightData.keywordId == null ? '' : String(insightData.keywordId),
      insightData.adId == null ? '' : String(insightData.adId),
      captureDay,
    ].join('|');

    const existingInsight = await prismaClient.marketInsight.findUnique({
      where: { dedupeKey },
      select: { id: true },
    });
    await prismaClient.marketInsight.upsert({
      where: { dedupeKey },
      create: { ...insightData, createdAt: input.capturedAt, dedupeKey },
      update: { ...insightData } as Prisma.MarketInsightUncheckedUpdateInput, // dedupeKey not in insightData — excluded from update by design
    });
    if (!existingInsight) insightsCreated = 1;
  }

  return {
    created: existingCapture === null,
    captureId: capture.id,
    reason: decision.reason,
    changedFields: decision.changedFields,
    insightsCreated,
  };
}
