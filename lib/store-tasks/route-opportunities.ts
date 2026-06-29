import { Prisma, type PrismaClient } from "@prisma/client";

type StoreTaskClient = Pick<PrismaClient, "opportunity" | "storeTask" | "$transaction">;

type OpportunityForTask = {
  id: string;
  type: string;
  targetType: string;
  targetId: string | null;
  targetUrl: string | null;
  targetName: string | null;
  priority: string;
  evidence: unknown;
  proposedAction: unknown;
  status: string;
};

export interface StoreTaskInput {
  taskType: string;
  targetType: string;
  targetId: string | null;
  targetUrl: string | null;
  title: string;
  description: string;
  proposedState: Record<string, unknown>;
  sourceData: Record<string, unknown>;
  priority: string;
  opportunityId: string;
  dedupeKey: string;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function titleFromAction(action: Record<string, unknown>, fallback: string): string {
  return typeof action.title === "string" && action.title.trim() ? action.title : fallback;
}

function descriptionFromAction(action: Record<string, unknown>, fallback: string): string {
  return typeof action.description === "string" && action.description.trim() ? action.description : fallback;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function competitorAdTaskLabel(insightType: string): string {
  if (insightType === "long_running_competitor_ad") return "long-running Meta ads";
  if (insightType === "new_competitor_ad") return "new Meta ads";
  if (insightType === "competitor_ad_changed") return "changed Meta ads";
  return "Meta ad changes";
}

export function shouldRouteOpportunityToStoreTask(opportunity: Pick<OpportunityForTask, "type" | "targetType">): boolean {
  if (opportunity.targetType === "article" || opportunity.type === "content_gap" || opportunity.type === "ctr_gap") {
    return false;
  }
  return [
    "competitor_price_change",
    "competitor_ad_change",
    "market_insight",
    "schema_fix",
    "collection_fix",
  ].includes(opportunity.type);
}

export function storeTaskFromOpportunity(opportunity: OpportunityForTask): StoreTaskInput | null {
  if (!shouldRouteOpportunityToStoreTask(opportunity)) return null;

  const proposedAction = asRecord(opportunity.proposedAction);
  const evidence = asRecord(opportunity.evidence);
  const action = typeof proposedAction.action === "string" ? proposedAction.action : "review_store_opportunity";

  if (opportunity.type === "competitor_ad_change") {
    const nestedEvidence = asRecord(evidence.evidence);
    const pageName = stringValue(nestedEvidence.pageName) ?? stringValue(opportunity.targetName) ?? "competitor";
    const insightType = stringValue(evidence.insightType) ?? "competitor_ad_change";
    const label = competitorAdTaskLabel(insightType);

    return {
      taskType: opportunity.type,
      targetType: "competitor_ad_group",
      targetId: `${insightType}:${pageName}`,
      targetUrl: null,
      title: `Review ${label} from ${pageName}`,
      description: `Grouped competitor-ad signal. Review the latest ${label} from ${pageName} and decide whether Agriko needs a product, content, or positioning response.`,
      proposedState: {
        action: "review_competitor_ads",
        pageName,
        insightType,
        latestTargetName: opportunity.targetName,
      },
      sourceData: {
        opportunityType: opportunity.type,
        grouped: true,
        latestEvidence: evidence,
      },
      priority: opportunity.priority,
      opportunityId: opportunity.id,
      dedupeKey: `store-task:${opportunity.type}:${insightType}:${pageName}`,
    };
  }

  return {
    taskType: opportunity.type,
    targetType: opportunity.targetType,
    targetId: opportunity.targetId,
    targetUrl: opportunity.targetUrl,
    title: titleFromAction(proposedAction, opportunity.targetName ?? opportunity.type),
    description: descriptionFromAction(proposedAction, `Review ${opportunity.type} opportunity.`),
    proposedState: {
      action,
      targetName: opportunity.targetName,
      ...("proposedState" in proposedAction && typeof proposedAction.proposedState === "object"
        ? (proposedAction.proposedState as Record<string, unknown>)
        : {}),
    },
    sourceData: {
      opportunityType: opportunity.type,
      evidence,
    },
    priority: opportunity.priority,
    opportunityId: opportunity.id,
    dedupeKey: `store-task:${opportunity.id}`,
  };
}

export async function upsertStoreTasksFromOpportunities(
  prismaClient: StoreTaskClient,
  opportunities: OpportunityForTask[],
): Promise<{ routed: number }> {
  let routed = 0;

  for (const opportunity of opportunities) {
    const task = storeTaskFromOpportunity(opportunity);
    if (!task) continue;

    const [storeTask] = await prismaClient.$transaction([
      prismaClient.storeTask.upsert({
        where: { dedupeKey: task.dedupeKey },
        create: {
          taskType: task.taskType,
          targetType: task.targetType,
          targetId: task.targetId,
          targetUrl: task.targetUrl,
          title: task.title,
          description: task.description,
          proposedState: json(task.proposedState),
          sourceData: json(task.sourceData),
          priority: task.priority,
          opportunityId: task.opportunityId,
          dedupeKey: task.dedupeKey,
        },
        update: {
          taskType: task.taskType,
          targetType: task.targetType,
          targetId: task.targetId,
          targetUrl: task.targetUrl,
          title: task.title,
          description: task.description,
          proposedState: json(task.proposedState),
          sourceData: json(task.sourceData),
          priority: task.priority,
          opportunityId: task.opportunityId,
        },
      }),
      prismaClient.opportunity.update({
        where: { id: opportunity.id },
        data: {
          status: "routed",
          routedToType: "StoreTask",
        },
      }),
    ]);

    await prismaClient.opportunity.update({
      where: { id: opportunity.id },
      data: {
        routedToId: storeTask.id,
      },
    });
    routed++;
  }

  return { routed };
}

export async function routeOpenStoreTaskOpportunities(
  prismaClient: StoreTaskClient,
): Promise<{ routed: number }> {
  const opportunities = await prismaClient.opportunity.findMany({
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
  });

  return upsertStoreTasksFromOpportunities(prismaClient, opportunities);
}
