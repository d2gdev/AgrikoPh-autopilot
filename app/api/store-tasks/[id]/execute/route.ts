import { NextResponse } from "next/server";
import { getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TopicalMapStoreTaskSourceSchema } from "@/lib/store-tasks/topical-map";
import { executeApprovedHandler } from "@/jobs/execute-approved";

export const dynamic = "force-dynamic";

const conflict = () => NextResponse.json(
  { error: "The Store Task is not linked to a current approved recommendation." },
  { status: 409 },
);

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_PUBLISH);
  if (permissionError) return permissionError;

  try {
    const { id } = await context.params;
    if (!id) return conflict();
    const task = await prisma.storeTask.findUnique({
      where: { id },
      select: { id: true, sourceData: true },
    });
    if (!task) return conflict();
    const source = TopicalMapStoreTaskSourceSchema.safeParse(task.sourceData);
    if (!source.success || !source.data.executable || !source.data.recommendationId) return conflict();

    const linked = await prisma.recommendation.findFirst({
      where: {
        id: source.data.recommendationId,
        targetEntityId: task.id,
        platform: "shopify",
        actionType: "apply_topical_map_store_task",
        status: { in: ["approved", "override_approved"] },
      },
      select: { id: true },
    });
    if (!linked) return conflict();

    const actor = (await getSessionUser(req)) ?? "authenticated-operator";
    const result = await executeApprovedHandler({
      liveRequested: true,
      triggeredBy: `store-pilot:${actor}`,
      recommendationId: linked.id,
    });
    const summary = result.summary as Record<string, unknown>;
    if (summary.considered === 0) return conflict();

    const refreshed = await prisma.storeTask.findUnique({
      where: { id: task.id },
      select: { id: true, status: true, completionNote: true },
    });
    if (!refreshed) return conflict();
    return NextResponse.json({
      runId: result.runId,
      status: result.status,
      summary: result.summary,
      errors: result.errors,
      task: refreshed,
    });
  } catch {
    return NextResponse.json({ error: "Store task execution failed." }, { status: 500 });
  }
}
