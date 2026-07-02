export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { processAdReviewsHandler } from "@/jobs/process-ad-reviews";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
import { jobResponse } from "@/lib/jobs/response";

const JOB_NAME = "process-ad-reviews";

export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const acquired = await acquireJobLock(JOB_NAME);
  if (!acquired) {
    return Response.json({ skipped: true, reason: "job already running" }, { status: 409 });
  }

  try {
    const result = await processAdReviewsHandler();
    return jobResponse(result);
  } catch (err) {
    console.error("[cron/process-ad-reviews] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    await releaseJobLock(JOB_NAME);
  }
}
