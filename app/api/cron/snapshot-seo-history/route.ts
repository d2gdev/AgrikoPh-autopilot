export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { snapshotSeoHistoryHandler } from "@/jobs/snapshot-seo-history";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
import { notifyJobFailure } from "@/lib/alerts";

const JOB_NAME = "snapshot-seo-history";

export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const acquired = await acquireJobLock(JOB_NAME);
  if (!acquired) {
    return Response.json({ skipped: true, reason: "job already running" }, { status: 409 });
  }

  try {
    const result = await snapshotSeoHistoryHandler();
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[cron/snapshot-seo-history] error:", err);
    await notifyJobFailure({ jobName: JOB_NAME, route: "/api/cron/snapshot-seo-history", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    await releaseJobLock(JOB_NAME);
  }
}
