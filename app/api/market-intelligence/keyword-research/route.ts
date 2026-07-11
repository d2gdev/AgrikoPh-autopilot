export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { notifyJobFailure } from "@/lib/alerts";
import { enqueueJob } from "@/lib/jobs/orchestrator";

const JOB_NAME = "fetch-keyword-research";

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  try {
    const queuedRun = await enqueueJob({
      jobName: JOB_NAME,
      triggeredBy: "user",
    });

    return NextResponse.json({
      ok: true,
      queued: true,
      runId: queuedRun.runId,
      status: queuedRun.status,
      jobName: JOB_NAME,
      alreadyQueued: !queuedRun.created,
    }, { status: 202 });
  } catch (err) {
    console.error("[market-intelligence/keyword-research] error:", err);
    await notifyJobFailure({ jobName: JOB_NAME, route: "/api/market-intelligence/keyword-research", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
