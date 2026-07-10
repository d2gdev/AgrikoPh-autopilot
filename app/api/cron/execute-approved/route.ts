export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { executeApprovedHandler } from "@/jobs/execute-approved";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
import { jobResponse } from "@/lib/jobs/response";

const JOB_NAME = "execute-approved";

export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const url = new URL(req.url);
  const liveRequested = url.searchParams.get("live") === "true";
  const liveEnabled = process.env.EXECUTE_APPROVED_LIVE_ENABLED === "true";
  const dryRun = !(liveRequested && liveEnabled);

  const acquired = await acquireJobLock(JOB_NAME);
  if (!acquired) {
    return Response.json({ skipped: true, reason: "job already running" }, { status: 409 });
  }

  try {
    const result = await executeApprovedHandler({
      liveRequested,
      triggeredBy: dryRun ? "cron-dry-run" : "cron-live",
    });
    const response = jobResponse(result);
    response.headers.set("X-Execute-Approved-Mode", dryRun ? "dry-run" : "live");
    if (liveRequested && !liveEnabled) {
      response.headers.set("X-Execute-Approved-Live-Blocked", "EXECUTE_APPROVED_LIVE_ENABLED is not true");
    }
    return response;
  } catch (err) {
    console.error("[cron/execute-approved] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    await releaseJobLock(JOB_NAME);
  }
}
