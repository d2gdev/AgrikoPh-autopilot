import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type {
  BacklogItemMutation,
  BacklogListQuery,
  CreateBacklogItem,
} from "@/lib/backlog/contracts";

type Db = typeof prisma;

const BACKLOG_ITEM_SELECT = {
  id: true,
  createdAt: true,
  updatedAt: true,
  version: true,
  title: true,
  description: true,
  dueAt: true,
  status: true,
  createdBy: true,
  updatedBy: true,
  completedAt: true,
} satisfies Prisma.BacklogItemSelect;

function serializeItem(
  item: Prisma.BacklogItemGetPayload<{
    select: typeof BACKLOG_ITEM_SELECT;
  }>,
  now: Date,
) {
  return {
    ...item,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    dueAt: item.dueAt.toISOString(),
    completedAt: item.completedAt?.toISOString() ?? null,
    overdue: item.status === "open" && item.dueAt.getTime() < now.getTime(),
  };
}

export async function listBacklogItems(
  input: BacklogListQuery,
  now: Date,
  db: Db = prisma,
) {
  const where = input.status === "all" ? {} : { status: input.status };
  const [items, open, completed] = await Promise.all([
    db.backlogItem.findMany({
      where,
      orderBy: input.status === "completed"
        ? [{ updatedAt: "desc" }, { id: "asc" }]
        : [{ dueAt: "asc" }, { id: "asc" }],
      take: 100,
      select: BACKLOG_ITEM_SELECT,
    }),
    db.backlogItem.count({ where: { status: "open" } }),
    db.backlogItem.count({ where: { status: "completed" } }),
  ]);
  return {
    items: items.map((item) => serializeItem(item, now)),
    counts: { open, completed },
    asOf: now.toISOString(),
  };
}

export async function createBacklogItem(
  input: CreateBacklogItem,
  actor: string,
  db: Db = prisma,
) {
  return db.$transaction(async (tx) => {
    const item = await tx.backlogItem.create({
      data: {
        title: input.title,
        description: input.description,
        dueAt: input.dueAt,
        createdBy: actor,
        updatedBy: actor,
      },
      select: BACKLOG_ITEM_SELECT,
    });
    await tx.auditLog.create({
      data: {
        actor,
        action: "backlog_item_created",
        entityType: "BacklogItem",
        entityId: item.id,
        after: {
          title: item.title,
          description: item.description,
          dueAt: item.dueAt.toISOString(),
          status: item.status,
        },
      },
    });
    return serializeItem(item, new Date());
  });
}

type MutationResult =
  | { outcome: "updated"; item: ReturnType<typeof serializeItem> }
  | { outcome: "not_found" }
  | { outcome: "conflict" }
  | { outcome: "invalid_transition"; message: string };

export async function mutateBacklogItem(
  id: string,
  mutation: BacklogItemMutation,
  actor: string,
  now: Date,
  db: Db = prisma,
): Promise<MutationResult> {
  return db.$transaction(async (tx) => {
    const current = await tx.backlogItem.findUnique({
      where: { id },
      select: BACKLOG_ITEM_SELECT,
    });
    if (!current) return { outcome: "not_found" };
    if (current.version !== mutation.expectedVersion) {
      return { outcome: "conflict" };
    }

    let data: Prisma.BacklogItemUpdateManyMutationInput;
    let action: string;
    let requiredStatus: string | undefined;
    if (mutation.action === "edit") {
      data = {
        ...mutation.fields,
        updatedBy: actor,
        version: { increment: 1 },
      };
      action = "backlog_item_edited";
    } else if (mutation.action === "complete") {
      if (current.status !== "open") {
        return {
          outcome: "invalid_transition",
          message: "Only open backlog items can be completed.",
        };
      }
      requiredStatus = "open";
      data = {
        status: "completed",
        completedAt: now,
        updatedBy: actor,
        version: { increment: 1 },
      };
      action = "backlog_item_completed";
    } else {
      if (current.status !== "completed") {
        return {
          outcome: "invalid_transition",
          message: "Only completed backlog items can be reopened.",
        };
      }
      requiredStatus = "completed";
      data = {
        status: "open",
        completedAt: null,
        updatedBy: actor,
        version: { increment: 1 },
      };
      action = "backlog_item_reopened";
    }

    const updated = await tx.backlogItem.updateMany({
      where: {
        id,
        version: mutation.expectedVersion,
        ...(requiredStatus ? { status: requiredStatus } : {}),
      },
      data,
    });
    if (updated.count !== 1) return { outcome: "conflict" };

    const item = await tx.backlogItem.findUnique({
      where: { id },
      select: BACKLOG_ITEM_SELECT,
    });
    if (!item) return { outcome: "not_found" };
    await tx.auditLog.create({
      data: {
        actor,
        action,
        entityType: "BacklogItem",
        entityId: id,
        before: {
          version: current.version,
          title: current.title,
          description: current.description,
          dueAt: current.dueAt.toISOString(),
          status: current.status,
        },
        after: {
          version: item.version,
          title: item.title,
          description: item.description,
          dueAt: item.dueAt.toISOString(),
          status: item.status,
        },
      },
    });
    return { outcome: "updated", item: serializeItem(item, now) };
  });
}

export async function deleteBacklogItem(
  id: string,
  expectedVersion: number,
  actor: string,
  db: Db = prisma,
): Promise<
  { outcome: "deleted" | "not_found" | "conflict" }
> {
  return db.$transaction(async (tx) => {
    const current = await tx.backlogItem.findUnique({
      where: { id },
      select: BACKLOG_ITEM_SELECT,
    });
    if (!current) return { outcome: "not_found" };
    if (current.version !== expectedVersion) return { outcome: "conflict" };

    const deleted = await tx.backlogItem.deleteMany({
      where: { id, version: expectedVersion },
    });
    if (deleted.count !== 1) return { outcome: "conflict" };
    await tx.auditLog.create({
      data: {
        actor,
        action: "backlog_item_deleted",
        entityType: "BacklogItem",
        entityId: id,
        before: {
          version: current.version,
          title: current.title,
          description: current.description,
          dueAt: current.dueAt.toISOString(),
          status: current.status,
        },
      },
    });
    return { outcome: "deleted" };
  });
}
