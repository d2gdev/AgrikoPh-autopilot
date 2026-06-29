export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { authorizePermission, PERMISSIONS } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  DASHBOARD_JOB_NAMES,
  getDashboardJob,
  isQueuedDashboardJobName,
} from "@/lib/dashboard/job-registry";
import { enqueueJob } from "@/lib/jobs/orchestrator";
import { materializeJobsStatusSnapshot } from "@/lib/dashboard/jobs-status";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function auditManualTrigger(input: {
  actor: string;
  action: string;
  jobName: string;
  after: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      actor: input.actor,
      action: input.action,
      entityType: "job",
      entityId: input.jobName,
      after: input.after as Prisma.InputJsonValue,
    },
  }).catch((err) => console.error("[trigger-job] audit failed", err));
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const auth = await authorizePermission(req, PERMISSIONS.JOBS_RUN);
  if (!auth.allowed) {
    const actor = auth.actor ?? "anonymous";
    await auditManualTrigger({
      actor,
      action: "manual_job_trigger_denied",
      jobName: "manual-trigger",
      after: {
        route: "/api/jobs/trigger-job",
        permission: PERMISSIONS.JOBS_RUN,
        reason: auth.actor ? "missing_permission" : "unauthenticated",
      },
    });
    return auth.response;
  }

  let body: { jobName?: unknown };
  try {
    body = (await req.json()) as { jobName?: unknown };
  } catch {
    await auditManualTrigger({
      actor: auth.actor,
      action: "manual_job_trigger_failed_validation",
      jobName: "manual-trigger",
      after: { route: "/api/jobs/trigger-job", code: "invalid_json" },
    });
    return NextResponse.json({ error: "Invalid JSON body", code: "invalid_json" }, { status: 400 });
  }

  const { jobName } = body;
  if (typeof jobName !== "string") {
    await auditManualTrigger({
      actor: auth.actor,
      action: "manual_job_trigger_failed_validation",
      jobName: "manual-trigger",
      after: { route: "/api/jobs/trigger-job", code: "invalid_job_name", receivedType: typeof jobName },
    });
    return NextResponse.json({ error: "jobName must be a string", code: "invalid_job_name" }, { status: 400 });
  }

  const registry = getDashboardJob(jobName);
  if (!registry) {
    await auditManualTrigger({
      actor: auth.actor,
      action: "manual_job_trigger_failed_validation",
      jobName,
      after: {
        route: "/api/jobs/trigger-job",
        code: "unknown_job",
        validJobs: DASHBOARD_JOB_NAMES,
      },
    });
    return NextResponse.json(
      { error: `Unknown job: ${jobName}`, code: "unknown_job", validJobs: DASHBOARD_JOB_NAMES },
      { status: 400 },
    );
  }

  if (!registry.manualTriggerEnabled || registry.triggerStrategy === "disabled") {
    const reason = registry.manualTriggerDisabledReason ?? "Manual trigger is disabled for this job.";
    await auditManualTrigger({
      actor: auth.actor,
      action: "manual_job_trigger_denied",
      jobName,
      after: { route: "/api/jobs/trigger-job", code: "job_not_triggerable", reason },
    });
    return NextResponse.json(
      { error: reason, code: "job_not_triggerable", jobName, label: registry.label },
      { status: 409 },
    );
  }

  try {
    if (registry.triggerStrategy === "queued") {
      if (!isQueuedDashboardJobName(jobName)) {
        throw new Error(`No queue strategy registered for ${jobName}`);
      }
      const queuedRun = await enqueueJob({
        jobName,
        triggeredBy: auth.actor,
        input: registry.queueInput,
      });
      await materializeJobsStatusSnapshot().catch((err) => console.error("[trigger-job] status snapshot failed", err));

      if (!queuedRun.created) {
        await auditManualTrigger({
          actor: auth.actor,
          action: "manual_job_trigger_already_active",
          jobName,
          after: {
            route: "/api/jobs/trigger-job",
            jobName,
            runId: queuedRun.runId,
            status: queuedRun.status,
          },
        });
        console.info("[trigger-job] manual trigger already active", {
          actor: auth.actor,
          jobName,
          runId: queuedRun.runId,
          status: queuedRun.status,
          durationMs: Date.now() - startedAt,
        });
        return NextResponse.json(
          {
            error: `${registry.label} is already ${queuedRun.status}.`,
            code: "job_already_active",
            jobName,
            label: registry.label,
            runId: queuedRun.runId,
            status: queuedRun.status,
          },
          { status: 409 },
        );
      }

      await auditManualTrigger({
        actor: auth.actor,
        action: "manual_job_trigger_queued",
        jobName,
        after: {
          route: "/api/jobs/trigger-job",
          jobName,
          runId: queuedRun.runId,
          status: queuedRun.status,
        },
      });
      console.info("[trigger-job] manual trigger queued", {
        actor: auth.actor,
        jobName,
        runId: queuedRun.runId,
        status: queuedRun.status,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({
        ok: true,
        queued: true,
        jobName,
        label: registry.label,
        runId: queuedRun.runId,
        status: queuedRun.status,
        alreadyQueued: false,
      }, { status: 202 });
    }

    if (!registry.cronPath) {
      throw new Error(`No cron path registered for ${jobName}`);
    }

    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "CRON_SECRET not configured", code: "cron_secret_missing" }, { status: 500 });
    }

    const origin = new URL(req.url).origin;
    const downstream = await fetch(`${origin}${registry.cronPath}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const downstreamBody = await downstream.json().catch(() => ({})) as Record<string, unknown>;
    await materializeJobsStatusSnapshot().catch((err) => console.error("[trigger-job] status snapshot failed", err));

    if (!downstream.ok) {
      const code = downstream.status === 409 ? "job_already_active" : "job_trigger_failed";
      await auditManualTrigger({
        actor: auth.actor,
        action: downstream.status === 409 ? "manual_job_trigger_already_active" : "manual_job_trigger_failed",
        jobName,
        after: {
          route: "/api/jobs/trigger-job",
          jobName,
          code,
          downstreamStatus: downstream.status,
          downstreamBody,
        },
      });
      console.warn("[trigger-job] manual trigger failed", {
        actor: auth.actor,
        jobName,
        status: downstream.status,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        {
          error: typeof downstreamBody.error === "string"
            ? downstreamBody.error
            : typeof downstreamBody.reason === "string"
              ? downstreamBody.reason
              : `Failed to trigger ${registry.label}`,
          code,
          jobName,
          label: registry.label,
          downstreamStatus: downstream.status,
          details: downstreamBody,
        },
        { status: downstream.status === 409 ? 409 : 502 },
      );
    }

    await auditManualTrigger({
      actor: auth.actor,
      action: "manual_job_trigger_started",
      jobName,
      after: {
        route: "/api/jobs/trigger-job",
        jobName,
        downstreamStatus: downstream.status,
        runId: downstreamBody.runId ?? null,
        status: downstreamBody.status ?? null,
      },
    });
    console.info("[trigger-job] manual trigger completed", {
      actor: auth.actor,
      jobName,
      runId: downstreamBody.runId ?? null,
      status: downstreamBody.status ?? null,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      ok: downstreamBody.ok ?? true,
      queued: false,
      jobName,
      label: registry.label,
      runId: downstreamBody.runId ?? null,
      status: downstreamBody.status ?? "success",
      summary: downstreamBody.summary ?? null,
      errors: downstreamBody.errors ?? [],
    }, { status: downstream.status });
  } catch (err) {
    const message = errorMessage(err);
    await auditManualTrigger({
      actor: auth.actor,
      action: "manual_job_trigger_failed",
      jobName,
      after: { route: "/api/jobs/trigger-job", jobName, error: message },
    });
    console.error("[trigger-job] error", {
      actor: auth.actor,
      jobName,
      durationMs: Date.now() - startedAt,
      error: message,
    });
    return NextResponse.json(
      { error: `Failed to trigger ${registry.label}`, code: "job_trigger_failed", jobName, label: registry.label },
      { status: 500 },
    );
  }
}
