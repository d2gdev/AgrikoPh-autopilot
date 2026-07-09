import { Prisma, type PrismaClient } from "@prisma/client";
import {
  generateProposals,
  type ProposalInput,
} from "@/lib/content-pilot/generate-proposals";
import {
  CONTENT_PROPOSAL_ACTIVE_STATUSES,
  filterBlockedContentProposalInputs,
} from "@/lib/content-pilot/proposal-dedupe";
import {
  classifyOpportunityPriority,
  normalizeOpportunityScore,
} from "@/lib/opportunities/scoring";
import type { OrganicPriority } from "@/lib/organic/prioritization";

type OpportunityClient = Pick<
  PrismaClient,
  | "opportunity"
  | "contentProposal"
  | "articleRecord"
  | "rawSnapshot"
  | "gscQuery"
  | "marketInsight"
  | "shoppingPriceHistory"
  | "skillInsight"
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function organicPriorityFromEvidence(evidence: unknown): OrganicPriority | null {
  const organicPriority = asRecord(evidence).organicPriority;
  if (!organicPriority || typeof organicPriority !== "object" || Array.isArray(organicPriority)) return null;

  const record = organicPriority as Record<string, unknown>;
  const priority = record.priority;
  const impact = record.impact;
  const effort = record.effort;
  const score = Number(record.score);

  if (
    !Number.isFinite(score) ||
    (priority !== "P0" && priority !== "P1" && priority !== "P2" && priority !== "P3") ||
    (impact !== "High" && impact !== "Medium" && impact !== "Low") ||
    (effort !== "High" && effort !== "Medium" && effort !== "Low")
  ) {
    return null;
  }

  return record as unknown as OrganicPriority;
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

type SkillInsightRow = {
  id: string;
  skillId: string;
  skillName: string;
  insightType: string;
  items: unknown;
  snapshotId: string;
  jobRunId: string | null;
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
  const organicPriority = organicPriorityFromEvidence(proposal.sourceData);
  const score = normalizeOpportunityScore(organicPriority?.score ?? proposal.priorityScore);
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
    priority: organicPriority?.priority ?? classifyOpportunityPriority(score),
    confidence: null,
    impact: organicPriority?.impact ?? proposal.impact,
    effort: organicPriority?.effort ?? proposal.effort,
    evidence: {
      ...proposal.sourceData,
      proposalType: proposal.proposalType,
      changeType: proposal.changeType,
      originalPriority: proposal.priority,
      score: proposal.priorityScore,
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

function fatigueSeverityScore(status: unknown): number {
  if (status === "dead") return 90;
  if (status === "urgent") return 80;
  if (status === "warning") return 60;
  return 35;
}

function opportunityFromFatigueItem(item: Record<string, unknown>, insight: SkillInsightRow): OpportunityInput | null {
  const adId = typeof item.adId === "string" && item.adId ? item.adId : null;
  if (!adId) return null;
  const adName = typeof item.adName === "string" && item.adName ? item.adName : adId;
  const score = normalizeOpportunityScore(fatigueSeverityScore(item.status));

  return {
    type: "creative_fatigue",
    targetType: "ad",
    targetId: adId,
    targetName: adName,
    source: "skill-insight",
    sourceRunId: insight.jobRunId,
    dedupeKey: `skill_insight:fatigue-report:${adId}`,
    score,
    priority: classifyOpportunityPriority(score),
    confidence: null,
    impact: typeof item.status === "string" ? item.status : null,
    effort: "review",
    evidence: { insightId: insight.id, insightType: insight.insightType, ...item },
    proposedAction: {
      action: "rotate_creative",
      title: `Creative fatigue: ${adName}`,
      description: typeof item.rationale === "string" && item.rationale
        ? item.rationale
        : `${adName} is showing signs of creative fatigue and may need a new creative.`,
      adId,
      adSetName: item.adSetName ?? null,
    },
  };
}

function opportunityFromSearchTermItem(item: Record<string, unknown>, insight: SkillInsightRow): OpportunityInput | null {
  const searchTerm = typeof item.searchTerm === "string" && item.searchTerm ? item.searchTerm : null;
  if (!searchTerm) return null;
  const isNegative = item.isNegativeKeyword === true;
  const score = normalizeOpportunityScore(isNegative ? 55 : 45);

  return {
    type: "search_term_opportunity",
    targetType: "search_term",
    targetId: searchTerm,
    targetName: searchTerm,
    source: "skill-insight",
    sourceRunId: insight.jobRunId,
    dedupeKey: `skill_insight:search-term-opportunities:${searchTerm}`,
    score,
    priority: classifyOpportunityPriority(score),
    confidence: null,
    impact: isNegative ? "potential-negative-keyword" : "potential-new-keyword",
    effort: "review",
    evidence: { insightId: insight.id, insightType: insight.insightType, ...item },
    proposedAction: {
      action: "review_search_term",
      title: isNegative
        ? `Potential negative keyword: "${searchTerm}"`
        : `Search term opportunity: "${searchTerm}"`,
      description: `Review search term "${searchTerm}" in Google Ads — Google execution is not available in Autopilot, so this requires manual action.`,
      searchTerm,
      recommendedMatchType: item.recommendedMatchType ?? null,
      isNegativeKeyword: isNegative,
    },
  };
}

function opportunityFromCompetitorItem(item: Record<string, unknown>, insight: SkillInsightRow): OpportunityInput | null {
  const competitor = typeof item.competitor === "string" && item.competitor ? item.competitor : null;
  if (!competitor) return null;
  const score = normalizeOpportunityScore(50);

  return {
    type: "competitor_creative_review",
    targetType: "competitor",
    targetId: competitor,
    targetName: competitor,
    source: "skill-insight",
    sourceRunId: insight.jobRunId,
    dedupeKey: `skill_insight:competitor-analysis:${competitor}`,
    score,
    priority: classifyOpportunityPriority(score),
    confidence: null,
    impact: null,
    effort: "review",
    evidence: { insightId: insight.id, insightType: insight.insightType, ...item },
    proposedAction: {
      action: "review_competitor_creative",
      title: `Competitor creative review: ${competitor}`,
      description: `${competitor} shows notable creative activity. Review for gaps and test ideas.`,
      competitor,
      gaps: item.gaps ?? [],
      recommendedTests: item.recommendedTests ?? [],
    },
  };
}

export function opportunitiesFromSkillInsight(insight: SkillInsightRow): OpportunityInput[] {
  const items = Array.isArray(insight.items) ? insight.items : [];
  const opportunities: OpportunityInput[] = [];

  for (const raw of items) {
    if (raw === null || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;

    let opportunity: OpportunityInput | null = null;
    if (insight.insightType === "fatigue-report") {
      opportunity = opportunityFromFatigueItem(item, insight);
    } else if (insight.insightType === "search-term-opportunities") {
      opportunity = opportunityFromSearchTermItem(item, insight);
    } else if (insight.insightType === "competitor-analysis") {
      opportunity = opportunityFromCompetitorItem(item, insight);
    }

    if (opportunity) opportunities.push(opportunity);
  }

  return opportunities;
}

export async function generateSkillInsightOpportunities(
  prismaClient: OpportunityClient,
): Promise<{ generated: number; upserted: number }> {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const insights = await prismaClient.skillInsight.findMany({
    where: {
      createdAt: { gte: twoDaysAgo },
      insightType: { in: ["fatigue-report", "search-term-opportunities", "competitor-analysis"] },
    },
    orderBy: { createdAt: "desc" },
    take: 250,
    select: {
      id: true,
      skillId: true,
      skillName: true,
      insightType: true,
      items: true,
      snapshotId: true,
      jobRunId: true,
      createdAt: true,
    },
  });

  const opportunities = insights.flatMap((insight) => opportunitiesFromSkillInsight(insight));
  const result = await upsertOpportunities(prismaClient, opportunities);
  return { generated: opportunities.length, upserted: result.upserted };
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
  const fresh = await filterBlockedContentProposalInputs(
    prismaClient,
    proposals,
    CONTENT_PROPOSAL_ACTIVE_STATUSES,
  );
  const opportunities = fresh.map(opportunityFromProposal);
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
): Promise<{
  generated: number;
  upserted: number;
  content: { generated: number; upserted: number };
  market: { generated: number; upserted: number };
  skillInsights: { generated: number; upserted: number };
}> {
  const content = await generateContentOpportunities(prismaClient);
  const market = await generateMarketOpportunities(prismaClient);
  const skillInsights = await generateSkillInsightOpportunities(prismaClient);
  return {
    generated: content.generated + market.generated + skillInsights.generated,
    upserted: content.upserted + market.upserted + skillInsights.upserted,
    content,
    market,
    skillInsights,
  };
}
