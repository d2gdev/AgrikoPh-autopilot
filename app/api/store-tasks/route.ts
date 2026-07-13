export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireAppAuth, getSessionShop } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { routeOpenStoreTaskOpportunities } from "@/lib/store-tasks/route-opportunities";
import { TopicalMapStoreTaskProposedSchema, TopicalMapStoreTaskSourceSchema } from "@/lib/store-tasks/topical-map";

const VALID_STATUSES = ["pending", "completed", "dismissed"];

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? "pending";
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  const tasks = await prisma.storeTask.findMany({
    where: { status },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    take: 250,
  });

  return NextResponse.json({ tasks, total: tasks.length });
}

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

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
    const topicalMapSource = TopicalMapStoreTaskSourceSchema.safeParse(task.sourceData);
    const topicalMapProposed = TopicalMapStoreTaskProposedSchema.safeParse(task.proposedState);
    if (status === "completed" && task.taskType === "topical_map" && topicalMapSource.success && topicalMapSource.data.executable && topicalMapProposed.success && topicalMapProposed.data.action !== "advisory") {
      return NextResponse.json({ error: "Executable topical-map tasks must use the confirmed apply route." }, { status: 409 });
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
