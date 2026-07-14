import { Prisma, type PrismaClient } from "@prisma/client";

export const ARTICLE_SNAPSHOT_STALE_DAYS = 7;

type ArticleSnapshotClient = Pick<PrismaClient, "articleSnapshot">;

export interface ArticleSnapshotState {
  articleRecordId?: string | null;
  shopifyId?: string | null;
  handle: string;
  title: string;
  contentHash: string;
  wordCount: number;
  imageCount: number;
  headingCount: number;
  ctaCount: number;
  internalLinkCount: number;
  inboundCount: number;
  seoData: unknown;
  linksData: unknown;
  topicsData: unknown;
}

export interface LatestArticleSnapshot {
  contentHash: string;
  capturedAt: Date;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function extractSeoScore(seoData: unknown): number | null {
  if (!seoData || typeof seoData !== "object" || !("score" in seoData)) return null;
  const score = Number((seoData as { score?: unknown }).score);
  return Number.isFinite(score) ? Math.round(score) : null;
}

export function shouldCreateArticleSnapshot(
  latest: LatestArticleSnapshot | null,
  contentHash: string,
  now = new Date(),
): boolean {
  if (!latest) return true;
  if (latest.contentHash !== contentHash) return true;

  const staleMs = ARTICLE_SNAPSHOT_STALE_DAYS * 24 * 60 * 60 * 1000;
  return now.getTime() - latest.capturedAt.getTime() >= staleMs;
}

export async function maybeCreateArticleSnapshot(
  prismaClient: ArticleSnapshotClient,
  state: ArticleSnapshotState,
  now = new Date(),
): Promise<boolean> {
  const identity = state.articleRecordId
    ? { articleRecordId: state.articleRecordId }
    : state.shopifyId
      ? { shopifyId: state.shopifyId }
      : { handle: state.handle };
  const latest = await prismaClient.articleSnapshot.findFirst({
    where: identity,
    select: { contentHash: true, capturedAt: true },
    orderBy: { capturedAt: "desc" },
  });

  if (!shouldCreateArticleSnapshot(latest, state.contentHash, now)) return false;

  await prismaClient.articleSnapshot.create({
    data: {
      articleRecordId: state.articleRecordId ?? null,
      shopifyId: state.shopifyId ?? null,
      handle: state.handle,
      title: state.title,
      contentHash: state.contentHash,
      wordCount: state.wordCount,
      imageCount: state.imageCount,
      headingCount: state.headingCount,
      ctaCount: state.ctaCount,
      internalLinkCount: state.internalLinkCount,
      inboundCount: state.inboundCount,
      seoScore: extractSeoScore(state.seoData),
      seoData: json(state.seoData),
      linksData: json(state.linksData),
      topicsData: json(state.topicsData),
      capturedAt: now,
    },
  });

  return true;
}
