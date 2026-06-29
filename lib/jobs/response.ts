import { NextResponse } from "next/server";
import { jobHttpStatus, jobOk, type JobResult } from "@/lib/jobs/types";

export function jobResponse<TSummary>(result: JobResult<TSummary>): NextResponse {
  return NextResponse.json(
    {
      ok: jobOk(result.status),
      jobName: result.jobName,
      runId: result.runId,
      status: result.status,
      summary: result.summary,
      errors: result.errors,
    },
    { status: jobHttpStatus(result.status) },
  );
}
