export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { adApprovalSlaHandler } from "@/jobs/ad-approval-sla";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
import { jobResponse } from "@/lib/jobs/response";

const JOB_NAME = "ad-approval-sla";

export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const acquired = await acquireJobLock(JOB_NAME);
  if (!acquired) {
    return Response.json({ skipped: true, reason: "job already running" }, { status: 409 });
  }

  try {
    const result = await adApprovalSlaHandler();
    return jobResponse(result);
  } catch (err) {
    console.error("[cron/ad-approval-sla] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    await releaseJobLock(JOB_NAME);
  }
}
