import { NextResponse } from "next/server";
import { getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { applyTopicalMapStoreTask, TopicalMapApplyError, type TopicalMapApplyErrorCode } from "@/lib/store-tasks/apply-topical-map";

export const dynamic = "force-dynamic";
const responses: Record<TopicalMapApplyErrorCode, { status: number; error: string }> = {
  LIVE_DISABLED: { status: 403, error: "Live store task execution is disabled." },
  TASK_NOT_PENDING: { status: 409, error: "The task is no longer pending." },
  TASK_NOT_EXECUTABLE: { status: 409, error: "The task is not executable." },
  STRATEGY_CHANGED: { status: 409, error: "The active strategy has changed." },
  RULE_CHANGED: { status: 409, error: "The governing rules have changed." },
  OBSERVATION_CHANGED: { status: 409, error: "The task no longer matches the current store observation." },
  SHOPIFY_FAILED: { status: 502, error: "Shopify could not verify the requested update." },
};

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_PUBLISH);
  if (permissionError) return permissionError;
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Task id is required." }, { status: 400 });
  }
  const actor = (await getSessionUser(req)) ?? "authenticated-operator";
  try {
    return NextResponse.json(await applyTopicalMapStoreTask(prisma, { id, actor }));
  } catch (error) {
    if (error instanceof TopicalMapApplyError || (error && typeof error === "object" && "code" in error && (error as { code: string }).code in responses)) {
      const code = (error as { code: TopicalMapApplyErrorCode }).code;
      const mapped = responses[code];
      return NextResponse.json({ error: mapped.error, code }, { status: mapped.status });
    }
    return NextResponse.json({ error: "Store task apply failed." }, { status: 500 });
  }
}
