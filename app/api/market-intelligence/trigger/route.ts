export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { VALID_PROFILES, type RunProfile } from "@/lib/market-intel/profiles";
import { enqueueJob } from "@/lib/jobs/orchestrator";
import { notifyJobFailure } from "@/lib/alerts";

const JOB_NAME = "fetch-market-intel";

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  let profile: RunProfile = "smoke";
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const requested = body.profile as string | undefined;
    // Manual UI triggers cannot use the scheduled profile — it has no hard caps.
    if (requested && requested !== "scheduled" && VALID_PROFILES.includes(requested as RunProfile)) {
      profile = requested as RunProfile;
    }
  } catch {
    // keep smoke default
  }

  try {
    const queuedRun = await enqueueJob({
      jobName: JOB_NAME,
      triggeredBy: "user",
      input: { profile },
    });

    return NextResponse.json({
      ok: true,
      queued: true,
      runId: queuedRun.runId,
      status: queuedRun.status,
      jobName: JOB_NAME,
      alreadyQueued: !queuedRun.created,
    }, { status: 202 });
  } catch (err) {
    console.error("[market-intelligence/trigger] error:", err);
    await notifyJobFailure({ jobName: JOB_NAME, route: "/api/market-intelligence/trigger", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
