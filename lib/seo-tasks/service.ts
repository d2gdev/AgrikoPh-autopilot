import { Prisma, type SeoFollowUpTask } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeGovernedUrl } from "@/lib/topical-map/url-normalizer";
import type {
  CreateSeoTaskInput,
  SeoTaskBucket,
  SeoTaskListInput,
  SeoTaskMutation,
} from "./contracts";
import {
  buildSeoTaskDedupeKey,
  deriveSeoTaskBucket,
  isSeoTaskOverdue,
} from "./readiness";
import {
  getBlockingMappedContentProposals,
  mappedContentIdentityFromTask,
} from "@/lib/content-pilot/map-candidate-history";

const ENTITY_TYPE = "seo_follow_up_task";
const TERMINAL_AUDIT_ACTIONS = [
  "seo_follow_up_task_completed",
  "seo_follow_up_task_cancelled",
] as const;

function bucketWhere(bucket: SeoTaskBucket, now: Date): Prisma.SeoFollowUpTaskWhereInput {
  const readyEvidence: Prisma.SeoFollowUpTaskWhereInput = {
    OR: [
      {
        requiresEvidence: true,
        evidenceStatus: "sufficient",
        evidenceSnapshot: { not: Prisma.DbNull },
      },
      { requiresEvidence: false, evidenceStatus: "not_required" },
    ],
  };
  if (bucket === "closed") return { status: { in: ["completed", "cancelled"] } };
  if (bucket === "scheduled") return { status: "open", earliestReviewAt: { gt: now } };
  if (bucket === "ready") {
    return { status: "open", earliestReviewAt: { lte: now }, AND: [readyEvidence] };
  }
  return {
    status: "open",
    earliestReviewAt: { lte: now },
    NOT: readyEvidence,
  };
}

function filterWhere(input: SeoTaskListInput): Prisma.SeoFollowUpTaskWhereInput {
  return {
    ...(input.priority === "all" ? {} : { priority: input.priority }),
    ...(input.taskType === "all" ? {} : { taskType: input.taskType }),
    ...(input.q ? {
      OR: [
        { title: { contains: input.q, mode: "insensitive" } },
        { description: { contains: input.q, mode: "insensitive" } },
        { targetUrl: { contains: input.q, mode: "insensitive" } },
        { topicalCluster: { contains: input.q, mode: "insensitive" } },
      ],
    } : {}),
  };
}

function normalizeTargetUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeGovernedUrl(value);
  if (normalized.startsWith("/")) return normalized;
  const url = new URL(normalized);
  return `${url.pathname}${url.search}${url.hash}`;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function nullableJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : json(value);
}

const SEO_TASK_LIST_SELECT = {
  id: true,
  version: true,
  taskType: true,
  title: true,
  targetUrl: true,
  topicalCluster: true,
  pageRole: true,
  priority: true,
  earliestReviewAt: true,
  dueAt: true,
  requiresEvidence: true,
  evidenceStatus: true,
  evidenceSnapshot: true,
  sourceType: true,
  sourceKey: true,
  sourceData: true,
  status: true,
} satisfies Prisma.SeoFollowUpTaskSelect;

const SEO_TASK_DETAIL_SELECT = {
  ...SEO_TASK_LIST_SELECT,
  description: true,
  ownerSurface: true,
  destinationPath: true,
  evidenceRequirement: true,
  evidenceSnapshot: true,
  lastEvaluatedAt: true,
  sourceType: true,
  sourceKey: true,
  completedAt: true,
  completionNote: true,
} satisfies Prisma.SeoFollowUpTaskSelect;

type SeoTaskListRecord = Prisma.SeoFollowUpTaskGetPayload<{ select: typeof SEO_TASK_LIST_SELECT }>;

export type SeoTaskCompletionPreflight = {
  status: "clear" | "already_handled" | "closed";
  basis: "task_and_audit_history";
  checkedAt: string;
};

function sourceIdentity(task: Pick<SeoTaskListRecord, "taskType" | "sourceType" | "sourceKey">): string {
  return `${task.taskType}\u001f${task.sourceType}\u001f${task.sourceKey}`;
}

async function getCompletionPreflights(
  tasks: SeoTaskListRecord[],
  now: Date,
): Promise<Map<string, SeoTaskCompletionPreflight>> {
  const openTasks = tasks.filter((task) => task.status === "open");
  const checkedAt = now.toISOString();
  const result = new Map<string, SeoTaskCompletionPreflight>();
  for (const task of tasks) {
    if (task.status !== "open") {
      result.set(task.id, {
        status: "closed",
        basis: "task_and_audit_history",
        checkedAt,
      });
    }
  }
  if (openTasks.length === 0) return result;

  const identities = [...new Map(openTasks.map((task) => [
    sourceIdentity(task),
    {
      taskType: task.taskType,
      sourceType: task.sourceType,
      sourceKey: task.sourceKey,
    },
  ])).values()];
  const mappedIdentities = openTasks.flatMap((task) => {
    const identity = mappedContentIdentityFromTask(task);
    return identity ? [identity] : [];
  });
  const [terminalReceipts, terminalTasks, blockingProposals] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        entityType: ENTITY_TYPE,
        entityId: { in: openTasks.map((task) => task.id) },
        action: { in: [...TERMINAL_AUDIT_ACTIONS] },
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(openTasks.length * TERMINAL_AUDIT_ACTIONS.length, 200),
      select: { entityId: true, action: true },
    }),
    prisma.seoFollowUpTask.findMany({
      where: {
        status: { in: ["completed", "cancelled"] },
        OR: identities,
      },
      select: {
        id: true,
        taskType: true,
        sourceType: true,
        sourceKey: true,
        status: true,
      },
    }),
    mappedIdentities.length > 0
      ? getBlockingMappedContentProposals(prisma, mappedIdentities)
      : Promise.resolve(new Map<string, string>()),
  ]);
  const receiptIds = new Set(terminalReceipts.map((receipt) => receipt.entityId));
  const terminalIdentities = new Set(terminalTasks.map(sourceIdentity));
  for (const task of openTasks) {
    const mappedIdentity = mappedContentIdentityFromTask(task);
    result.set(task.id, {
      status: receiptIds.has(task.id) || terminalIdentities.has(sourceIdentity(task))
        || (mappedIdentity ? blockingProposals.has(mappedIdentity.candidateId) : false)
        ? "already_handled"
        : "clear",
      basis: "task_and_audit_history",
      checkedAt,
    });
  }
  return result;
}

function toListItem(
  task: SeoTaskListRecord,
  now: Date,
  completionPreflight: SeoTaskCompletionPreflight,
) {
  return {
    id: task.id,
    version: task.version,
    taskType: task.taskType,
    title: task.title,
    targetUrl: task.targetUrl,
    topicalCluster: task.topicalCluster,
    pageRole: task.pageRole,
    priority: task.priority,
    earliestReviewAt: task.earliestReviewAt,
    dueAt: task.dueAt,
    requiresEvidence: task.requiresEvidence,
    evidenceStatus: task.evidenceStatus,
    status: task.status,
    completionPreflight,
    bucket: deriveSeoTaskBucket({
      status: task.status as "open" | "completed" | "cancelled",
      earliestReviewAt: task.earliestReviewAt,
      requiresEvidence: task.requiresEvidence,
      evidenceStatus: task.evidenceStatus as "waiting" | "insufficient" | "sufficient" | "not_required",
      evidenceSnapshot: task.evidenceSnapshot,
    }, now),
    overdue: isSeoTaskOverdue({
      status: task.status as "open" | "completed" | "cancelled",
      dueAt: task.dueAt,
    }, now),
  };
}

export type SeoTaskListResponse = {
  tasks: ReturnType<typeof toListItem>[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  counts: Record<SeoTaskBucket, number>;
  asOf: string;
};

export async function listSeoTasks(
  input: SeoTaskListInput,
  now: Date,
): Promise<SeoTaskListResponse> {
  const filters = filterWhere(input);
  const where = { AND: [filters, bucketWhere(input.bucket, now)] };
  const [total, ready, waiting, scheduled, closed, tasks] = await Promise.all([
    prisma.seoFollowUpTask.count({ where }),
    prisma.seoFollowUpTask.count({ where: { AND: [filters, bucketWhere("ready", now)] } }),
    prisma.seoFollowUpTask.count({ where: { AND: [filters, bucketWhere("waiting", now)] } }),
    prisma.seoFollowUpTask.count({ where: { AND: [filters, bucketWhere("scheduled", now)] } }),
    prisma.seoFollowUpTask.count({ where: { AND: [filters, bucketWhere("closed", now)] } }),
    prisma.seoFollowUpTask.findMany({
      where,
      select: SEO_TASK_LIST_SELECT,
      orderBy: [{ priority: "asc" }, { earliestReviewAt: "asc" }, { id: "asc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);
  const completionPreflights = await getCompletionPreflights(tasks, now);
  return {
    tasks: tasks.map((task) => toListItem(
      task,
      now,
      completionPreflights.get(task.id) ?? {
        status: "clear",
        basis: "task_and_audit_history",
        checkedAt: now.toISOString(),
      },
    )),
    total,
    page: input.page,
    pageSize: input.pageSize,
    hasMore: input.page * input.pageSize < total,
    counts: { ready, waiting, scheduled, closed },
    asOf: now.toISOString(),
  };
}

export async function getSeoTaskSummary(now: Date) {
  const [ready, waiting, nextScheduled] = await Promise.all([
    prisma.seoFollowUpTask.count({ where: bucketWhere("ready", now) }),
    prisma.seoFollowUpTask.count({ where: bucketWhere("waiting", now) }),
    prisma.seoFollowUpTask.findFirst({
      where: bucketWhere("scheduled", now),
      orderBy: [{ earliestReviewAt: "asc" }, { id: "asc" }],
      select: { earliestReviewAt: true },
    }),
  ]);
  return {
    ready,
    waiting,
    nextScheduledReviewAt: nextScheduled?.earliestReviewAt.toISOString() ?? null,
  };
}

export async function getSeoTaskDetail(id: string) {
  const task = await prisma.seoFollowUpTask.findUnique({
    where: { id },
    select: SEO_TASK_DETAIL_SELECT,
  });
  if (!task) return null;
  const history = await prisma.auditLog.findMany({
    where: { entityType: ENTITY_TYPE, entityId: id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, action: true, actor: true, createdAt: true },
  });
  return { task, history };
}

export type CreateSeoTaskResult =
  | { outcome: "created"; task: SeoFollowUpTask }
  | { outcome: "duplicate"; existingId: string };

export async function createSeoTask(
  input: CreateSeoTaskInput,
  actor: string,
): Promise<CreateSeoTaskResult> {
  const targetUrl = normalizeTargetUrl(input.targetUrl);
  const dedupeKey = buildSeoTaskDedupeKey({
    taskType: input.taskType,
    sourceType: input.sourceType,
    sourceKey: input.sourceKey,
  });
  const duplicateWhere: Prisma.SeoFollowUpTaskWhereInput = {
    OR: [
      { dedupeKey },
      {
        taskType: input.taskType,
        sourceType: input.sourceType,
        sourceKey: input.sourceKey,
      },
    ],
  };
  const knownDuplicate = await prisma.seoFollowUpTask.findFirst({
    where: duplicateWhere,
    select: { id: true },
  });
  if (knownDuplicate) {
    return { outcome: "duplicate", existingId: knownDuplicate.id };
  }
  try {
    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.seoFollowUpTask.create({
        data: {
          ...input,
          targetUrl,
          dueAt: input.dueAt ?? null,
          topicalCluster: input.topicalCluster ?? null,
          pageRole: input.pageRole ?? null,
          destinationPath: input.destinationPath ?? null,
          evidenceRequirement: json(input.evidenceRequirement),
          evidenceSnapshot: nullableJson(input.evidenceSnapshot),
          lastEvaluatedAt: input.lastEvaluatedAt ?? null,
          sourceData: json(input.sourceData),
          createdBy: actor,
          updatedBy: actor,
          dedupeKey,
        },
      });
      await tx.auditLog.create({
        data: {
          actor,
          action: "seo_follow_up_task_created",
          entityType: ENTITY_TYPE,
          entityId: created.id,
          after: json(created),
          meta: { version: created.version },
        },
      });
      return created;
    });
    return { outcome: "created", task };
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const existing = await prisma.seoFollowUpTask.findFirst({
      where: duplicateWhere,
      select: { id: true },
    });
    if (!existing) throw error;
    return { outcome: "duplicate", existingId: existing.id };
  }
}

export type MutateSeoTaskResult =
  | { outcome: "updated"; task: SeoFollowUpTask }
  | { outcome: "not_found" }
  | { outcome: "conflict" }
  | { outcome: "invalid_transition"; message: string };

export async function mutateSeoTask(
  id: string,
  action: SeoTaskMutation,
  actor: string,
  now: Date,
  options: { skipMappedProposalPreflight?: boolean } = {},
): Promise<MutateSeoTaskResult> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.seoFollowUpTask.findUnique({ where: { id } });
    if (!current) return { outcome: "not_found" };
    if (current.status !== "open") {
      return { outcome: "invalid_transition", message: "Closed SEO tasks cannot be changed or reopened." };
    }
    const mappedIdentity = mappedContentIdentityFromTask(current);
    if (mappedIdentity && !options.skipMappedProposalPreflight) {
      const blocked = await getBlockingMappedContentProposals(tx, [mappedIdentity]);
      if (blocked.has(mappedIdentity.candidateId)) {
        return {
          outcome: "invalid_transition",
          message: "Corresponding content work is already queued or completed.",
        };
      }
    }
    const [terminalReceipt, terminalTask] = await Promise.all([
      tx.auditLog.findFirst({
        where: {
          entityType: ENTITY_TYPE,
          entityId: id,
          action: { in: [...TERMINAL_AUDIT_ACTIONS] },
        },
        select: { id: true },
      }),
      tx.seoFollowUpTask.findFirst({
        where: {
          id: { not: id },
          taskType: current.taskType,
          sourceType: current.sourceType,
          sourceKey: current.sourceKey,
          status: { in: ["completed", "cancelled"] },
        },
        select: { id: true },
      }),
    ]);
    if (terminalReceipt || terminalTask) {
      return {
        outcome: "invalid_transition",
        message: "A prior completion was recorded for this task identity. Refresh and reconcile the task record.",
      };
    }

    let data: Prisma.SeoFollowUpTaskUpdateManyMutationInput;
    let auditAction: string;

    if (action.action === "complete") {
      if (current.earliestReviewAt.getTime() > now.getTime()) {
        return {
          outcome: "invalid_transition",
          message: "This task cannot be completed before its review date.",
        };
      }
      if (current.requiresEvidence
        && (current.evidenceStatus !== "sufficient" || current.evidenceSnapshot === null)) {
        return {
          outcome: "invalid_transition",
          message: "Sufficient evidence and an evidence snapshot are required before completion.",
        };
      }
      if (!current.requiresEvidence && current.evidenceStatus !== "not_required") {
        return {
          outcome: "invalid_transition",
          message: "This task is not in the Ready state.",
        };
      }
      data = {
        status: "completed",
        completedAt: now,
        completionNote: action.note,
        decisionData: nullableJson(action.decisionData),
        updatedBy: actor,
        version: { increment: 1 },
      };
      auditAction = "seo_follow_up_task_completed";
    } else if (action.action === "cancel") {
      data = {
        status: "cancelled",
        completedAt: now,
        completionNote: action.note,
        decisionData: nullableJson(action.decisionData),
        updatedBy: actor,
        version: { increment: 1 },
      };
      auditAction = "seo_follow_up_task_cancelled";
    } else if (action.action === "update_evidence") {
      if (current.requiresEvidence && action.evidenceStatus === "not_required") {
        return { outcome: "invalid_transition", message: "Evidence is required for this task." };
      }
      if (!current.requiresEvidence && action.evidenceStatus !== "not_required") {
        return { outcome: "invalid_transition", message: "This task does not require evidence." };
      }
      if (action.evidenceStatus === "sufficient" && action.evidenceSnapshot === null) {
        return {
          outcome: "invalid_transition",
          message: "Sufficient evidence requires an evidence snapshot.",
        };
      }
      data = {
        evidenceStatus: action.evidenceStatus,
        evidenceSnapshot: nullableJson(action.evidenceSnapshot),
        lastEvaluatedAt: action.lastEvaluatedAt ?? now,
        updatedBy: actor,
        version: { increment: 1 },
      };
      auditAction = "seo_follow_up_task_evidence_updated";
    } else {
      const fields = action.fields;
      data = {
        ...(fields.title === undefined ? {} : { title: fields.title }),
        ...(fields.description === undefined ? {} : { description: fields.description }),
        ...(fields.targetUrl === undefined ? {} : { targetUrl: normalizeTargetUrl(fields.targetUrl) }),
        ...(fields.topicalCluster === undefined ? {} : { topicalCluster: fields.topicalCluster }),
        ...(fields.pageRole === undefined ? {} : { pageRole: fields.pageRole }),
        ...(fields.ownerSurface === undefined ? {} : { ownerSurface: fields.ownerSurface }),
        ...(fields.destinationPath === undefined ? {} : { destinationPath: fields.destinationPath }),
        ...(fields.priority === undefined ? {} : { priority: fields.priority }),
        ...(fields.earliestReviewAt === undefined ? {} : { earliestReviewAt: fields.earliestReviewAt }),
        ...(fields.dueAt === undefined ? {} : { dueAt: fields.dueAt }),
        ...(fields.evidenceRequirement === undefined
          ? {}
          : { evidenceRequirement: json(fields.evidenceRequirement) }),
        ...(fields.requiresEvidence === undefined ? {} : {
          requiresEvidence: fields.requiresEvidence,
          ...(fields.requiresEvidence === current.requiresEvidence ? {} : {
            evidenceStatus: fields.requiresEvidence ? "waiting" : "not_required",
            evidenceSnapshot: Prisma.DbNull,
          }),
        }),
        updatedBy: actor,
        version: { increment: 1 },
      };
      auditAction = "seo_follow_up_task_edited";
    }

    const updatedCount = await tx.seoFollowUpTask.updateMany({
      where: { id, version: action.expectedVersion },
      data,
    });
    if (updatedCount.count === 0) return { outcome: "conflict" };

    const updated = await tx.seoFollowUpTask.findUnique({ where: { id } });
    if (!updated) return { outcome: "not_found" };
    await tx.auditLog.create({
      data: {
        actor,
        action: auditAction,
        entityType: ENTITY_TYPE,
        entityId: id,
        before: json(current),
        after: json(updated),
        meta: { expectedVersion: action.expectedVersion, version: updated.version },
      },
    });
    return { outcome: "updated", task: updated };
  });
}
