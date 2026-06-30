import { NextResponse } from "next/server";
import { authorizePermission, PERMISSIONS } from "@/lib/auth";
import { enqueueJob } from "@/lib/jobs/orchestrator";
import { materializeJobsStatusSnapshot } from "@/lib/dashboard/jobs-status";
import { prisma } from "@/lib/db";
import { getDashboardJob } from "@/lib/dashboard/job-registry";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await authorizePermission(req, PERMISSIONS.JOBS_RUN);
  const startedAt = Date.now();
  const jobName = "dashboard-refresh";
  if (!auth.allowed) {
    await prisma.auditLog.create({
      data: {
        actor: auth.actor ?? "anonymous",
        action: "manual_job_trigger_denied",
        entityType: "job",
        entityId: jobName,
        after: {
          route: "/api/jobs/trigger",
          permission: PERMISSIONS.JOBS_RUN,
          jobName,
          reason: auth.actor ? "missing_permission" : "unauthenticated",
        },
      },
    }).catch((err) => console.error("[jobs/trigger] denied audit failed", err));
    return auth.response;
  }

  const registry = getDashboardJob(jobName);
  try {
    const queuedRun = await enqueueJob({
      jobName,
      triggeredBy: auth.actor,
    });
    await materializeJobsStatusSnapshot().catch((err) => console.error("[jobs/trigger] status snapshot failed", err));
    await prisma.auditLog.create({
      data: {
        actor: auth.actor,
        action: queuedRun.created ? "manual_job_trigger_queued" : "manual_job_trigger_already_active",
        entityType: "job",
        entityId: jobName,
        after: {
          route: "/api/jobs/trigger",
          jobName,
          runId: queuedRun.runId,
          status: queuedRun.status,
          alreadyQueued: !queuedRun.created,
        },
      },
    }).catch((err) => console.error("[jobs/trigger] audit failed", err));

    console.info("[jobs/trigger] manual trigger", {
      actor: auth.actor,
      jobName,
      runId: queuedRun.runId,
      status: queuedRun.status,
      alreadyQueued: !queuedRun.created,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      ok: true,
      queued: true,
      alreadyQueued: !queuedRun.created,
      runId: queuedRun.runId,
      status: queuedRun.status,
      jobName,
      label: registry?.label ?? jobName,
      newRecs: 0,
    }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[jobs/trigger] error", {
      actor: auth.actor,
      jobName,
      durationMs: Date.now() - startedAt,
      error: message,
    });
    await prisma.auditLog.create({
      data: {
        actor: auth.actor,
        action: "manual_job_trigger_failed",
        entityType: "job",
        entityId: jobName,
        after: { route: "/api/jobs/trigger", jobName, error: message },
      },
    }).catch((auditErr) => console.error("[jobs/trigger] audit failed", auditErr));
    return NextResponse.json({ error: "Failed to queue dashboard refresh", code: "trigger_failed" }, { status: 500 });
  }
}
