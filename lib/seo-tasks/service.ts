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

const ENTITY_TYPE = "seo_follow_up_task";

function bucketWhere(bucket: SeoTaskBucket, now: Date): Prisma.SeoFollowUpTaskWhereInput {
  const readyEvidence: Prisma.SeoFollowUpTaskWhereInput = {
    OR: [
      { requiresEvidence: true, evidenceStatus: "sufficient" },
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

function toListItem(task: SeoFollowUpTask, now: Date) {
  return {
    ...task,
    bucket: deriveSeoTaskBucket({
      status: task.status as "open" | "completed" | "cancelled",
      earliestReviewAt: task.earliestReviewAt,
      requiresEvidence: task.requiresEvidence,
      evidenceStatus: task.evidenceStatus as "waiting" | "insufficient" | "sufficient" | "not_required",
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
      orderBy: [{ priority: "asc" }, { earliestReviewAt: "asc" }, { id: "asc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);
  return {
    tasks: tasks.map((task) => toListItem(task, now)),
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
  const task = await prisma.seoFollowUpTask.findUnique({ where: { id } });
  if (!task) return null;
  const history = await prisma.auditLog.findMany({
    where: { entityType: ENTITY_TYPE, entityId: id },
    orderBy: { createdAt: "desc" },
    take: 100,
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
    title: input.title,
    targetUrl,
    sourceType: input.sourceType,
    sourceKey: input.sourceKey,
  });
  const knownDuplicate = await prisma.seoFollowUpTask.findUnique({
    where: { dedupeKey },
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
    const existing = await prisma.seoFollowUpTask.findUnique({
      where: { dedupeKey },
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
): Promise<MutateSeoTaskResult> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.seoFollowUpTask.findUnique({ where: { id } });
    if (!current) return { outcome: "not_found" };
    if (current.status !== "open") {
      return { outcome: "invalid_transition", message: "Closed SEO tasks cannot be changed or reopened." };
    }

    let data: Prisma.SeoFollowUpTaskUpdateManyMutationInput;
    let auditAction: string;

    if (action.action === "complete") {
      if (current.requiresEvidence
        && (current.evidenceStatus !== "sufficient" || current.evidenceSnapshot === null)) {
        return {
          outcome: "invalid_transition",
          message: "Sufficient evidence and an evidence snapshot are required before completion.",
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
          evidenceStatus: fields.requiresEvidence ? "waiting" : "not_required",
          evidenceSnapshot: Prisma.DbNull,
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
