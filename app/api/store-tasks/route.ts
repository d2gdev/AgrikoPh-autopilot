export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import {
  getSessionShop,
  PERMISSIONS,
  requireAppAuth,
  requirePermission,
} from "@/lib/auth";
import { prisma } from "@/lib/db";
import { routeOpenStoreTaskOpportunities } from "@/lib/store-tasks/route-opportunities";
import { toStoreTaskListDto } from "@/lib/store-tasks/dto";

const VALID_STATUSES = ["pending", "applying", "reconciliation_needed", "failed", "completed", "dismissed"];
const STORE_TASK_LIST_SELECT = {
  id: true,
  createdAt: true,
  taskType: true,
  targetType: true,
  targetId: true,
  targetUrl: true,
  title: true,
  description: true,
  proposedState: true,
  sourceData: true,
  priority: true,
  status: true,
  completedAt: true,
  completionNote: true,
} as const;

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? "pending";
  const page = Number(searchParams.get("page") ?? "1");
  const pageSize = Number(searchParams.get("pageSize") ?? "50");
  const executionClass = searchParams.get("executionClass") ?? "actionable";
  const q = (searchParams.get("q") ?? "").trim().slice(0, 200);

  if (!Number.isInteger(page) || page < 1
    || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100
    || !["actionable", "advisory"].includes(executionClass)) {
    return NextResponse.json({ error: "Invalid Store Task query." }, { status: 400 });
  }
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  const advisoryWhere: Prisma.StoreTaskWhereInput = {
    AND: [
      { sourceData: { path: ["source"], equals: "topical-map" } },
      { sourceData: { path: ["executable"], equals: false } },
    ],
  };
  const where: Prisma.StoreTaskWhereInput = {
    status,
    ...(executionClass === "advisory" ? advisoryWhere : { NOT: advisoryWhere }),
    ...(q ? {
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { targetUrl: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ],
    } : {}),
  };
  const [total, tasks] = await Promise.all([
    prisma.storeTask.count({ where }),
    prisma.storeTask.findMany({
      where,
      select: STORE_TASK_LIST_SELECT,
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const taskDtos = [];
  for (const task of tasks) {
    try {
      taskDtos.push(toStoreTaskListDto(task));
    } catch {
      console.error("[store-tasks] invalid list DTO:", task.id);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }
  return NextResponse.json({ tasks: taskDtos, total, page, pageSize, hasMore: page * pageSize < total });
}

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  try {
    const result = await routeOpenStoreTaskOpportunities(prisma);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[store-tasks] route opportunities error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  const actor = (await getSessionShop(req)) ?? "operator";
  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  const status = typeof body.status === "string" ? body.status : "";
  const completionNote = typeof body.completionNote === "string" ? body.completionNote : null;

  if (!id) return NextResponse.json({ error: "Task id is required" }, { status: 400 });
  if (!["completed", "dismissed"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  try {
    const task = await prisma.storeTask.findUnique({ where: { id } });
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (task.status !== "pending") {
      return NextResponse.json({ error: `Cannot update a task with status "${task.status}"` }, { status: 409 });
    }
    const rawSource = task.sourceData && typeof task.sourceData === "object" && !Array.isArray(task.sourceData)
      ? task.sourceData as Record<string, unknown>
      : null;
    if (status === "completed" && rawSource?.source === "topical-map" && rawSource.executable === true) {
      return NextResponse.json({ error: "Executable topical-map tasks must use the confirmed apply route." }, { status: 409 });
    }
    if (status === "completed" && !completionNote?.trim()) {
      return NextResponse.json({ error: "Completion evidence is required" }, { status: 400 });
    }

    const updated = await prisma.storeTask.update({
      where: { id },
      data: {
        status,
        reviewedBy: actor,
        reviewedAt: new Date(),
        completedAt: status === "completed" ? new Date() : null,
        completionNote,
      },
    });

    await prisma.opportunity.updateMany({
      where: {
        OR: [
          { routedToType: "StoreTask", routedToId: updated.id },
          ...(updated.opportunityId ? [{ id: updated.opportunityId }] : []),
        ],
      },
        data: {
          status: status === "completed" ? "resolved" : "dismissed",
          resolvedAt: new Date(),
          routedToType: "StoreTask",
          routedToId: updated.id,
        },
    });

    return NextResponse.json({ task: updated });
  } catch (err) {
    console.error("[store-tasks] update error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
