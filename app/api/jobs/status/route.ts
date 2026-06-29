export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import {
  getJobsStatusPayload,
  getJobRunStatusById,
} from "@/lib/dashboard/jobs-status";

export async function GET(req: Request) {
  const startedAt = Date.now();
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const runId = new URL(req.url).searchParams.get("runId");
    if (runId) {
      const runStatus = await getJobRunStatusById(runId);
      if (!runStatus) {
        console.info("[jobs/status] run lookup miss", { runId, durationMs: Date.now() - startedAt });
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      console.info("[jobs/status] run lookup", {
        runId,
        jobName: runStatus.jobName,
        status: runStatus.status,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(runStatus);
    }

    const payload = await getJobsStatusPayload();
    console.info("[jobs/status] payload", {
      fromSnapshot: payload.fromSnapshot,
      snapshotAgeMs: payload.snapshotAgeMs,
      buildDurationMs: payload.buildDurationMs,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[jobs/status] error:", { durationMs: Date.now() - startedAt, error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
