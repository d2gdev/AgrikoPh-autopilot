export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { fetchGscDataHandler } from "@/jobs/fetch-gsc-data";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
import { notifyJobFailure } from "@/lib/alerts";
import { jobResponse } from "@/lib/jobs/response";

const JOB_NAME = "fetch-gsc-data";

export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const acquired = await acquireJobLock(JOB_NAME);
  if (!acquired) {
    return Response.json({ skipped: true, reason: "job already running" }, { status: 409 });
  }

  try {
    const result = await fetchGscDataHandler();
    if (result.status === "failed") {
      await notifyJobFailure({ jobName: JOB_NAME, route: "/api/cron/fetch-gsc-data", error: result.errors.join("\n") });
    }
    return jobResponse(result);
  } catch (err) {
    console.error("[cron/fetch-gsc-data] error:", err);
    await notifyJobFailure({ jobName: JOB_NAME, route: "/api/cron/fetch-gsc-data", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    await releaseJobLock(JOB_NAME);
  }
}
