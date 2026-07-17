import { NextResponse } from "next/server";
import { PERMISSIONS, getSessionUser, requireAppAuth, requirePermission } from "@/lib/auth";
import { syncTopicalMapSeoTasks } from "@/lib/seo-tasks/topical-map-scheduler";
import { rollbackStrategyVersion } from "@/lib/topical-map/activation";
import { optionalReason, safeTopicalMapError } from "@/lib/topical-map/operator-route";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.SETTINGS_ADMIN);
  if (permissionError) return permissionError;

  const body = await optionalReason(req);
  if (body instanceof NextResponse) return body;
  const { id } = await params;
  const actor = (await getSessionUser(req)) ?? "authenticated-operator";
  try {
    const rollback = await rollbackStrategyVersion({
      versionId: id,
      siteHost: "agrikoph.com",
      actor,
      ...body,
    });
    let taskSync: Awaited<ReturnType<typeof syncTopicalMapSeoTasks>> | { status: "error" };
    try {
      taskSync = await syncTopicalMapSeoTasks();
    } catch (error) {
      console.error("[topical-map/rollback] SEO task sync:", error);
      taskSync = { status: "error" };
    }
    return NextResponse.json({ ...rollback, taskSync });
  } catch (error) {
    return safeTopicalMapError(error);
  }
}
