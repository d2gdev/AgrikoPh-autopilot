import { Prisma, type PrismaClient } from "@prisma/client";
import {
  shouldRouteOpportunityToStoreTask,
  upsertStoreTasksFromOpportunities,
} from "@/lib/store-tasks/route-opportunities";

type OpportunityRouterClient = Pick<
  PrismaClient,
  "opportunity" | "contentProposal" | "storeTask" | "$transaction"
>;

type OpportunityForRoute = {
  id: string;
  type: string;
  targetType: string;
  targetId: string | null;
  targetUrl: string | null;
  targetName: string | null;
  source: string;
  score: number;
  priority: string;
  impact: string | null;
  effort: string | null;
  evidence: unknown;
  proposedAction: unknown;
  status: string;
  routedToType?: string | null;
  routedToId?: string | null;
};

export interface OpportunityRouteResult {
  opportunityId: string;
  routed: boolean;
  routedToType?: "ContentProposal" | "StoreTask";
  routedToId?: string;
  reason?: string;
}

export interface OpportunityRoutingSummary {
  routed: number;
  contentProposals: number;
  storeTasks: number;
  skipped: number;
}

const CONTENT_OPPORTUNITY_TYPES = new Set([
  "content_gap",
  "ctr_gap",
  "internal_link",
  "missing_meta",
  "thin_content",
  "stale_content",
]);

const ACTIVE_PROPOSAL_STATUSES = ["pending", "approved", "override_approved", "published"];

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function proposalPriority(priority: string): string {
  if (priority === "P0") return "P1";
  if (["P1", "P2", "P3"].includes(priority)) return priority;
  return "P2";
}

function proposalTypeForOpportunity(type: string, action: Record<string, unknown>): string {
  const explicit = text(action.proposalType);
  if (explicit) return explicit;
  if (type === "content_gap") return "new-content";
  if (type === "internal_link") return "internal-link";
  if (type === "thin_content" || type === "stale_content") return "content-refresh";
  return "seo-fix";
}

function changeTypeForOpportunity(type: string, action: Record<string, unknown>): string {
  const explicit = text(action.changeType);
  if (explicit) return explicit;
  if (type === "content_gap") return "new_article";
  if (type === "internal_link") return "internal_link";
  if (type === "thin_content" || type === "stale_content") return "content";
  return "metadata";
}

export function shouldRouteOpportunityToContentProposal(
  opportunity: Pick<OpportunityForRoute, "type" | "targetType">,
): boolean {
  return opportunity.targetType === "article" || CONTENT_OPPORTUNITY_TYPES.has(opportunity.type);
}

export function contentProposalFromOpportunity(
  opportunity: OpportunityForRoute,
): Prisma.ContentProposalUncheckedCreateInput | null {
  if (!shouldRouteOpportunityToContentProposal(opportunity)) return null;

  const action = asRecord(opportunity.proposedAction);
  const evidence = asRecord(opportunity.evidence);
  const proposalType = proposalTypeForOpportunity(opportunity.type, action);
  const changeType = changeTypeForOpportunity(opportunity.type, action);
  const articleHandle =
    text(action.articleHandle) ??
    (opportunity.targetType === "article" ? opportunity.targetId : null);
  const proposedState = asRecord(action.proposedState);
  const targetKeyword = text(proposedState.targetKeyword) ?? text(proposedState.targetQuery) ?? opportunity.targetName ?? opportunity.targetId;

  return {
    articleHandle,
    proposalType,
    changeType,
    priority: proposalPriority(opportunity.priority),
    impact: text(opportunity.impact) ?? "Medium",
    effort: text(opportunity.effort) ?? "Medium",
    title: text(action.title) ?? opportunity.targetName ?? `${proposalType}: ${targetKeyword ?? opportunity.type}`,
    description: text(action.description) ?? `Review ${opportunity.type} opportunity.`,
    proposedState: json({
      targetUrl: opportunity.targetUrl,
      targetName: opportunity.targetName,
      ...proposedState,
    }),
    sourceData: json({
      source: "opportunity-router",
      opportunityId: opportunity.id,
      opportunityType: opportunity.type,
      opportunitySource: opportunity.source,
      score: opportunity.score,
      evidence,
    }),
  };
}

async function findExistingContentProposal(
  prismaClient: OpportunityRouterClient,
  data: Prisma.ContentProposalUncheckedCreateInput,
) {
  if (data.articleHandle) {
    return prismaClient.contentProposal.findFirst({
      where: {
        articleHandle: data.articleHandle,
        proposalType: data.proposalType,
        status: { in: ACTIVE_PROPOSAL_STATUSES },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
  }

  return prismaClient.contentProposal.findFirst({
    where: {
      title: { equals: data.title, mode: "insensitive" },
      proposalType: data.proposalType,
      status: { in: ACTIVE_PROPOSAL_STATUSES },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
}

export async function routeOpportunityToContentProposal(
  prismaClient: OpportunityRouterClient,
  opportunity: OpportunityForRoute,
): Promise<OpportunityRouteResult> {
  const data = contentProposalFromOpportunity(opportunity);
  if (!data) {
    return { opportunityId: opportunity.id, routed: false, reason: "not_content_opportunity" };
  }

  const existing = await findExistingContentProposal(prismaClient, data);
  const proposal = existing ?? await prismaClient.contentProposal.create({ data });

  await prismaClient.opportunity.update({
    where: { id: opportunity.id },
    data: {
      status: "routed",
      routedToType: "ContentProposal",
      routedToId: proposal.id,
    },
  });

  return {
    opportunityId: opportunity.id,
    routed: true,
    routedToType: "ContentProposal",
    routedToId: proposal.id,
  };
}

export async function routeOpportunity(
  prismaClient: OpportunityRouterClient,
  opportunityId: string,
): Promise<OpportunityRouteResult> {
  const opportunity = await prismaClient.opportunity.findUnique({
    where: { id: opportunityId },
    select: {
      id: true,
      type: true,
      targetType: true,
      targetId: true,
      targetUrl: true,
      targetName: true,
      source: true,
      score: true,
      priority: true,
      impact: true,
      effort: true,
      evidence: true,
      proposedAction: true,
      status: true,
      routedToType: true,
      routedToId: true,
    },
  });

  if (!opportunity) {
    return { opportunityId, routed: false, reason: "not_found" };
  }
  if (opportunity.status === "routed" && opportunity.routedToType && opportunity.routedToId) {
    return {
      opportunityId,
      routed: true,
      routedToType: opportunity.routedToType as "ContentProposal" | "StoreTask",
      routedToId: opportunity.routedToId,
      reason: "already_routed",
    };
  }
  if (!["open", "routed"].includes(opportunity.status)) {
    return { opportunityId, routed: false, reason: `status_${opportunity.status}` };
  }

  if (shouldRouteOpportunityToContentProposal(opportunity)) {
    return routeOpportunityToContentProposal(prismaClient, opportunity);
  }

  if (shouldRouteOpportunityToStoreTask(opportunity)) {
    const result = await upsertStoreTasksFromOpportunities(prismaClient, [opportunity]);
    const routed = await prismaClient.opportunity.findUnique({
      where: { id: opportunityId },
      select: { routedToId: true },
    });
    return {
      opportunityId,
      routed: result.routed > 0,
      routedToType: "StoreTask",
      routedToId: routed?.routedToId ?? undefined,
      reason: result.routed > 0 ? undefined : "store_task_not_created",
    };
  }

  return { opportunityId, routed: false, reason: "unsupported_opportunity_type" };
}

export async function routeOpenContentOpportunities(
  prismaClient: OpportunityRouterClient,
): Promise<{ routed: number }> {
  const opportunities = await prismaClient.opportunity.findMany({
    where: {
      status: "open",
      OR: [
        { type: { in: Array.from(CONTENT_OPPORTUNITY_TYPES) } },
        { targetType: "article" },
      ],
    },
    orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
    take: 250,
    select: {
      id: true,
      type: true,
      targetType: true,
      targetId: true,
      targetUrl: true,
      targetName: true,
      source: true,
      score: true,
      priority: true,
      impact: true,
      effort: true,
      evidence: true,
      proposedAction: true,
      status: true,
    },
  });

  let routed = 0;
  for (const opportunity of opportunities) {
    const result = await routeOpportunityToContentProposal(prismaClient, opportunity);
    if (result.routed) routed++;
  }
  return { routed };
}

export async function routeOpenOpportunities(
  prismaClient: OpportunityRouterClient,
): Promise<OpportunityRoutingSummary> {
  const content = await routeOpenContentOpportunities(prismaClient);
  const store = await upsertStoreTasksFromOpportunities(
    prismaClient,
    await prismaClient.opportunity.findMany({
      where: {
        status: "open",
        OR: [
          { type: { in: ["competitor_price_change", "competitor_ad_change", "market_insight", "schema_fix", "collection_fix"] } },
          { targetType: { in: ["product", "collection", "page", "competitor", "competitor_ad", "competitor_product", "market_product", "market"] } },
        ],
      },
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
      take: 250,
      select: {
        id: true,
        type: true,
        targetType: true,
        targetId: true,
        targetUrl: true,
        targetName: true,
        priority: true,
        evidence: true,
        proposedAction: true,
        status: true,
      },
    }),
  );

  return {
    routed: content.routed + store.routed,
    contentProposals: content.routed,
    storeTasks: store.routed,
    skipped: 0,
  };
}
