export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { enqueueJob } from "@/lib/jobs/orchestrator";
import { notifyJobFailure } from "@/lib/alerts";

const JOB_NAME = "fetch-market-intel";

export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  try {
    const queuedRun = await enqueueJob({
      jobName: JOB_NAME,
      triggeredBy: "cron",
      input: { profile: "scheduled" },
    });
      return NextResponse.json(
      {
        ok: true,
        queued: true,
        runId: queuedRun.runId,
        status: queuedRun.status,
        jobName: JOB_NAME,
        alreadyQueued: !queuedRun.created,
      },
      { status: 202 },
    );
  } catch (err) {
    console.error("[cron/fetch-market-intel] error:", err);
    await notifyJobFailure({ jobName: JOB_NAME, route: "/api/cron/fetch-market-intel", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
