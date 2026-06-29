import { Prisma, type PrismaClient } from "@prisma/client";
import {
  generateProposals,
  type ProposalInput,
} from "@/lib/content-pilot/generate-proposals";
import {
  classifyOpportunityPriority,
  normalizeOpportunityScore,
} from "@/lib/opportunities/scoring";

type OpportunityClient = Pick<
  PrismaClient,
  | "opportunity"
  | "contentProposal"
  | "articleRecord"
  | "rawSnapshot"
  | "gscQuery"
  | "marketInsight"
  | "shoppingPriceHistory"
>;

export interface OpportunityInput {
  type: string;
  targetType: string;
  targetId?: string | null;
  targetUrl?: string | null;
  targetName?: string | null;
  source: string;
  sourceRunId?: string | null;
  dedupeKey: string;
  score: number;
  priority: string;
  confidence?: number | null;
  impact?: string | null;
  effort?: string | null;
  evidence: Record<string, unknown>;
  proposedAction: Record<string, unknown>;
}

type MarketInsightRow = {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  evidence: unknown;
  competitorId: string | null;
  keywordId: string | null;
  adId: string | null;
  createdAt: Date;
};

type PriceHistoryRow = {
  id: string;
  productKey: string;
  title: string;
  store: string | null;
  price: number;
  previousPrice: number | null;
  priceDelta: number | null;
  priceDeltaPct: number | null;
  currency: string | null;
  capturedAt: Date;
  competitorId: string | null;
  marketKeywordId: string | null;
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function opportunityTypeFromProposal(proposal: ProposalInput): string {
  if (proposal.changeType === "metadata" && proposal.sourceData?.query) return "ctr_gap";
  if (proposal.proposalType === "new-content") return "content_gap";
  if (proposal.proposalType === "internal-link") return "internal_link";
  if (proposal.changeType === "metadata") return "missing_meta";
  if (proposal.title.toLowerCase().includes("thin content")) return "thin_content";
  if (proposal.title.toLowerCase().includes("stale article")) return "stale_content";
  return proposal.changeType || proposal.proposalType;
}

export function opportunityFromProposal(proposal: ProposalInput): OpportunityInput {
  const score = normalizeOpportunityScore(proposal.priorityScore);
  const type = opportunityTypeFromProposal(proposal);
  const targetId = proposal.articleHandle ?? String(proposal.proposedState.targetKeyword ?? proposal.title);
  const targetType = proposal.articleHandle ? "article" : "keyword";

  return {
    type,
    targetType,
    targetId,
    targetUrl: proposal.articleHandle ? `/blogs/news/${proposal.articleHandle}` : null,
    targetName: proposal.articleHandle ?? String(proposal.proposedState.targetKeyword ?? proposal.title),
    source: "content-pilot",
    dedupeKey: `${type}:${targetType}:${targetId}:${proposal.changeType}`,
    score,
    priority: classifyOpportunityPriority(score),
    confidence: null,
    impact: proposal.impact,
    effort: proposal.effort,
    evidence: {
      ...proposal.sourceData,
      proposalType: proposal.proposalType,
      changeType: proposal.changeType,
      originalPriority: proposal.priority,
    },
    proposedAction: {
      title: proposal.title,
      description: proposal.description,
      articleHandle: proposal.articleHandle,
      proposalType: proposal.proposalType,
      changeType: proposal.changeType,
      proposedState: proposal.proposedState,
    },
  };
}

function severityScore(severity: string): number {
  if (severity === "critical") return 90;
  if (severity === "warning") return 70;
  if (severity === "success") return 45;
  return 35;
}

function opportunityTypeFromMarketInsight(type: string): string {
  if (type === "price_change") return "competitor_price_change";
  if (type === "long_running_competitor_ad" || type === "new_competitor_ad" || type === "competitor_ad_changed") return "competitor_ad_change";
  return "market_insight";
}

export function opportunityFromMarketInsight(insight: MarketInsightRow): OpportunityInput {
  const type = opportunityTypeFromMarketInsight(insight.type);
  const score = severityScore(insight.severity);
  const targetType = insight.adId ? "competitor_ad" : insight.competitorId ? "competitor" : insight.keywordId ? "keyword" : "market";
  const targetId = insight.adId ?? insight.competitorId ?? insight.keywordId ?? insight.id;

  return {
    type,
    targetType,
    targetId,
    targetName: insight.title,
    source: "market-intelligence",
    sourceRunId: null,
    dedupeKey: `${type}:${insight.id}`,
    score,
    priority: classifyOpportunityPriority(score),
    confidence: null,
    impact: insight.severity,
    effort: "review",
    evidence: {
      insightId: insight.id,
      insightType: insight.type,
      severity: insight.severity,
      summary: insight.summary,
      evidence: insight.evidence,
      createdAt: insight.createdAt.toISOString(),
    },
    proposedAction: {
      title: insight.title,
      description: insight.summary,
      action: "review_market_insight",
    },
  };
}

export function opportunityFromPriceHistory(row: PriceHistoryRow): OpportunityInput | null {
  if (row.priceDelta == null || row.previousPrice == null) return null;
  const absPct = Math.abs(row.priceDeltaPct ?? 0);
  const absDelta = Math.abs(row.priceDelta);
  if (absPct < 10 && absDelta < 20) return null;

  const score = normalizeOpportunityScore(45 + Math.min(40, absPct * 2));
  return {
    type: "competitor_price_change",
    targetType: row.competitorId ? "competitor_product" : "market_product",
    targetId: row.productKey,
    targetName: row.title,
    source: "shopping-price-history",
    sourceRunId: null,
    dedupeKey: `competitor_price_change:${row.productKey}:${row.capturedAt.toISOString().slice(0, 10)}`,
    score,
    priority: classifyOpportunityPriority(score),
    confidence: null,
    impact: row.priceDelta < 0 ? "competitor-price-drop" : "competitor-price-increase",
    effort: "review",
    evidence: {
      priceHistoryId: row.id,
      productKey: row.productKey,
      store: row.store,
      previousPrice: row.previousPrice,
      currentPrice: row.price,
      priceDelta: row.priceDelta,
      priceDeltaPct: row.priceDeltaPct,
      currency: row.currency,
      capturedAt: row.capturedAt.toISOString(),
    },
    proposedAction: {
      title: `${row.store ?? "Competitor"} price changed`,
      description: `${row.title} changed from ${row.previousPrice} to ${row.price}${row.currency ? ` ${row.currency}` : ""}.`,
      action: "review_competitor_price",
    },
  };
}

export async function upsertOpportunities(
  prismaClient: OpportunityClient,
  opportunities: OpportunityInput[],
): Promise<{ upserted: number }> {
  for (const opportunity of opportunities) {
    await prismaClient.opportunity.upsert({
      where: { dedupeKey: opportunity.dedupeKey },
      create: {
        type: opportunity.type,
        targetType: opportunity.targetType,
        targetId: opportunity.targetId ?? null,
        targetUrl: opportunity.targetUrl ?? null,
        targetName: opportunity.targetName ?? null,
        source: opportunity.source,
        sourceRunId: opportunity.sourceRunId ?? null,
        dedupeKey: opportunity.dedupeKey,
        score: opportunity.score,
        priority: opportunity.priority,
        confidence: opportunity.confidence ?? null,
        impact: opportunity.impact ?? null,
        effort: opportunity.effort ?? null,
        evidence: json(opportunity.evidence),
        proposedAction: json(opportunity.proposedAction),
        status: "open",
      },
      update: {
        type: opportunity.type,
        targetType: opportunity.targetType,
        targetId: opportunity.targetId ?? null,
        targetUrl: opportunity.targetUrl ?? null,
        targetName: opportunity.targetName ?? null,
        source: opportunity.source,
        sourceRunId: opportunity.sourceRunId ?? null,
        score: opportunity.score,
        priority: opportunity.priority,
        confidence: opportunity.confidence ?? null,
        impact: opportunity.impact ?? null,
        effort: opportunity.effort ?? null,
        evidence: json(opportunity.evidence),
        proposedAction: json(opportunity.proposedAction),
      },
    });
  }

  return { upserted: opportunities.length };
}

export async function generateContentOpportunities(
  prismaClient: OpportunityClient,
): Promise<{ generated: number; upserted: number }> {
  const proposals = await generateProposals(prismaClient as PrismaClient);
  const opportunities = proposals.map(opportunityFromProposal);
  const result = await upsertOpportunities(prismaClient, opportunities);
  return { generated: opportunities.length, upserted: result.upserted };
}

export async function generateMarketOpportunities(
  prismaClient: OpportunityClient,
): Promise<{ generated: number; upserted: number }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [insights, priceRows] = await Promise.all([
    prismaClient.marketInsight.findMany({
      where: { status: "open" },
      orderBy: { createdAt: "desc" },
      take: 250,
      select: {
        id: true,
        type: true,
        severity: true,
        title: true,
        summary: true,
        evidence: true,
        competitorId: true,
        keywordId: true,
        adId: true,
        createdAt: true,
      },
    }),
    prismaClient.shoppingPriceHistory.findMany({
      where: {
        capturedAt: { gte: sevenDaysAgo },
        priceDelta: { not: null },
      },
      orderBy: { capturedAt: "desc" },
      take: 250,
      select: {
        id: true,
        productKey: true,
        title: true,
        store: true,
        price: true,
        previousPrice: true,
        priceDelta: true,
        priceDeltaPct: true,
        currency: true,
        capturedAt: true,
        competitorId: true,
        marketKeywordId: true,
      },
    }),
  ]);

  const opportunities = [
    ...insights.map(opportunityFromMarketInsight),
    ...priceRows.map(opportunityFromPriceHistory).filter((row): row is OpportunityInput => row !== null),
  ];
  const result = await upsertOpportunities(prismaClient, opportunities);
  return { generated: opportunities.length, upserted: result.upserted };
}

export async function generateAllOpportunities(
  prismaClient: OpportunityClient,
): Promise<{ generated: number; upserted: number; content: { generated: number; upserted: number }; market: { generated: number; upserted: number } }> {
  const content = await generateContentOpportunities(prismaClient);
  const market = await generateMarketOpportunities(prismaClient);
  return {
    generated: content.generated + market.generated,
    upserted: content.upserted + market.upserted,
    content,
    market,
  };
}
