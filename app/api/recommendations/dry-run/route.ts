export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getExecutionQueueSummary } from "@/lib/recommendations/execution-queue";
import { getSessionUser, PERMISSIONS, requirePermission } from "@/lib/auth";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
import { executeApprovedHandler } from "@/jobs/execute-approved";
import { notifyJobFailure } from "@/lib/alerts";

const JOB_NAME = "execute-approved";

export async function POST(req: Request) {
  const authError = await requirePermission(req, PERMISSIONS.JOBS_RUN);
  if (authError) return authError;
  const actor = await getSessionUser(req) ?? "operator";

  const acquired = await acquireJobLock(JOB_NAME);
  if (!acquired) {
    return NextResponse.json({ error: "execute-approved job already running" }, { status: 409 });
  }

  try {
    await executeApprovedHandler({ dryRun: true, triggeredBy: actor });
    const summary = await getExecutionQueueSummary();
    return NextResponse.json({ ok: true, dryRun: true, summary });
  } catch (err) {
    console.error("[recommendations/dry-run] error:", err);
    await notifyJobFailure({ jobName: JOB_NAME, route: "/api/recommendations/dry-run", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    await releaseJobLock(JOB_NAME);
  }
}
