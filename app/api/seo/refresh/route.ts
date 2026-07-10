export const dynamic = "force-dynamic";
export const maxDuration = 30;
import { NextRequest, NextResponse } from "next/server";
import { PERMISSIONS, requireAppAuth, requirePermission, getSessionShop, getSessionUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { enqueueJob } from "@/lib/jobs/orchestrator";
import { materializeJobsStatusSnapshot } from "@/lib/dashboard/jobs-status";

export async function POST(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  const actor = (await getSessionShop(req)) ?? (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`seo-refresh:${actor}`, 3, 60_000)) {
    return NextResponse.json({ error: "Rate limit: max 3 refreshes per minute" }, { status: 429 });
  }

  try {
    const queuedRun = await enqueueJob({
      jobName: "dashboard-refresh",
      triggeredBy: actor,
    });
    await materializeJobsStatusSnapshot().catch((err) => console.error("[seo/refresh] status snapshot failed", err));

    if (!queuedRun.created) {
      return NextResponse.json({
        ok: false,
        queued: false,
        alreadyQueued: true,
        runId: queuedRun.runId,
        status: queuedRun.status,
        jobName: "dashboard-refresh",
      }, { status: 409 });
    }

    return NextResponse.json({
      ok: true,
      queued: true,
      alreadyQueued: false,
      runId: queuedRun.runId,
      status: queuedRun.status,
      jobName: "dashboard-refresh",
    }, { status: 202 });
  } catch (err) {
    console.error("[seo/refresh] queue error:", err);
    return NextResponse.json({ error: "Failed to queue SEO refresh", code: "trigger_failed" }, { status: 500 });
  }
}
