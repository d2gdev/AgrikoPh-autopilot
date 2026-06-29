export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { drainQueuedJobs } from "@/lib/jobs/orchestrator";
import { notifyJobFailure } from "@/lib/alerts";

export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  try {
    const url = new URL(req.url);
    const limit = Math.max(1, Number(url.searchParams.get("limit") ?? process.env.JOB_QUEUE_DRAIN_LIMIT ?? 1));
    const result = await drainQueuedJobs({ limit });
    for (const run of result.drained) {
      if (run.status === "failed") {
        await notifyJobFailure({ jobName: run.jobName, route: "/api/cron/drain-jobs", error: run.errors.join("\n") });
      }
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/drain-jobs] error:", err);
    await notifyJobFailure({ jobName: "drain-jobs", route: "/api/cron/drain-jobs", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
