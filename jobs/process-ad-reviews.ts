// AI review worker (spec §AI Agent Orchestration). Drains queued/retry AI jobs,
// runs the matching agent under a timeout, records the report + review, and
// transitions the approval. Cron-driven (app/api/cron/process-ad-reviews) under
// a JobLock — the codebase's async-job pattern (no external queue).

import { prisma } from "@/lib/db";
import type { JobResult, JobStatus } from "@/lib/jobs/types";
import {
  STATUS,
  REVIEW_STAGE,
  DECISION,
  RETRY_BACKOFF_MS,
} from "@/lib/ad-approval/constants";
import { transition, flagForManualIntervention } from "@/lib/ad-approval/state-machine";
import { enqueueAiJob } from "@/lib/ad-approval/jobs";
import { assignConversionReviewer, transitionToPenultimate } from "@/lib/ad-approval/conflict";
import { createNotification, ADMIN_RECIPIENT } from "@/lib/notifications";
import { runPreReview } from "@/lib/ad-approval/ai-agents/pre-review";
import { runBrandReview } from "@/lib/ad-approval/ai-agents/brand-review";
import { runTechnicalReview } from "@/lib/ad-approval/ai-agents/technical-review";
import type { AgentInput, AgentReport, AdCopy, AdCreative } from "@/lib/ad-approval/ai-agents/shared";

const JOB_NAME = "process-ad-reviews";
const BATCH_SIZE = 10;

interface StageConfig {
  forStatus: string;
  inStatus: string;
  reviewStage: string;
  agentName: string;
  run: (input: AgentInput, signal: AbortSignal) => Promise<AgentReport>;
}

const STAGE_CONFIG: Record<string, StageConfig> = {
  [REVIEW_STAGE.PRE_REVIEW]: {
    forStatus: STATUS.FOR_AI_PRE_REVIEW,
    inStatus: STATUS.IN_AI_PRE_REVIEW,
    reviewStage: REVIEW_STAGE.PRE_REVIEW,
    agentName: "AI Pre-Review Agent",
    run: runPreReview,
  },
  [REVIEW_STAGE.BRAND_REVIEW]: {
    forStatus: STATUS.FOR_BRAND_REVIEW,
    inStatus: STATUS.IN_BRAND_REVIEW,
    reviewStage: REVIEW_STAGE.BRAND_REVIEW,
    agentName: "AI Brand Review Agent",
    run: runBrandReview,
  },
  [REVIEW_STAGE.TECHNICAL_REVIEW]: {
    forStatus: STATUS.FOR_TECHNICAL_REVIEW,
    inStatus: STATUS.IN_TECHNICAL_REVIEW,
    reviewStage: REVIEW_STAGE.TECHNICAL_REVIEW,
    agentName: "AI Technical Review Agent",
    run: runTechnicalReview,
  },
};

type Summary = {
  jobsProcessed: number;
  passed: number;
  needsRevision: number;
  rejected: number;
  retried: number;
  exhausted: number;
};

async function runWithTimeout(
  fn: (signal: AbortSignal) => Promise<AgentReport>,
  seconds: number,
): Promise<AgentReport> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`AI job timed out after ${seconds}s`)), seconds * 1000);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function processAdReviewsHandler(): Promise<JobResult<Summary>> {
  const runId = (await prisma.jobRun.create({ data: { jobName: JOB_NAME } })).id;
  const errors: string[] = [];
  const summary: Summary = { jobsProcessed: 0, passed: 0, needsRevision: 0, rejected: 0, retried: 0, exhausted: 0 };

  const now = new Date();
  const jobs = await prisma.adAIJobQueue.findMany({
    where: { OR: [{ status: "QUEUED" }, { status: "RETRY", nextRetryAt: { lte: now } }] },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  for (const job of jobs) {
    try {
      await processOne(job, summary);
    } catch (err) {
      const msg = `job ${job.id} (${job.stage}): ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      console.error(`[${JOB_NAME}] ${msg}`);
    }
  }

  const status: JobStatus = errors.length ? (summary.jobsProcessed ? "partial" : "failed") : "success";
  await prisma.jobRun.update({
    where: { id: runId },
    data: { completedAt: new Date(), status, summary, errorLog: errors.join("\n") || null },
  });
  return { jobName: JOB_NAME, runId, status, summary, errors };
}

async function processOne(
  job: { id: string; approvalId: string; stage: string; attemptNumber: number; timeoutSeconds: number },
  summary: Summary,
): Promise<void> {
  const config = STAGE_CONFIG[job.stage];
  if (!config) {
    await markJob(job.id, "FAILED", `Unknown stage ${job.stage}`);
    return;
  }

  const approval = await prisma.adApproval.findUnique({ where: { id: job.approvalId } });
  if (!approval) {
    await markJob(job.id, "FAILED", "Approval not found");
    return;
  }

  // Stale job: approval already moved past this queue state. Close it out.
  if (approval.status !== config.forStatus) {
    await markJob(job.id, "COMPLETED", null);
    return;
  }

  // Advisory start: for_X_review -> in_X_review (audited AI_JOB_STARTED).
  const started = await transition({
    approvalId: approval.id,
    from: config.forStatus,
    to: config.inStatus,
    version: approval.version,
    actor: `AI-${config.agentName}`,
    action: "AI_JOB_STARTED",
    details: { stage: job.stage, attempt: job.attemptNumber },
  });
  if (!started.ok) {
    // Another worker grabbed it; leave the job for the next cycle.
    return;
  }
  await prisma.adAIJobQueue.update({
    where: { id: job.id },
    data: { status: "PROCESSING", startedAt: new Date() },
  });

  const latest = await prisma.adRevision.findFirst({
    where: { approvalId: approval.id },
    orderBy: { revisionNumber: "desc" },
  });
  if (!latest) {
    await failOrRetry(job, approval.id, config, started.version, "No revision found");
    return;
  }

  const input: AgentInput = {
    campaignId: approval.campaignId,
    revisionNumber: latest.revisionNumber,
    copy: (latest.copy ?? {}) as AdCopy,
    creative: (latest.creative ?? {}) as AdCreative,
  };

  let report: AgentReport;
  try {
    report = await runWithTimeout((signal) => config.run(input, signal), job.timeoutSeconds);
  } catch (err) {
    await failOrRetry(job, approval.id, config, started.version, err instanceof Error ? err.message : String(err));
    return;
  }

  // Persist report + review (immutable records).
  const aiReport = await prisma.adAIReport.create({
    data: {
      agentName: config.agentName,
      approvalId: approval.id,
      revisionNumber: latest.revisionNumber,
      overallResult: report.overallResult,
      executiveSummary: report.executiveSummary,
      validationChecks: report.validationChecks as unknown as object,
      warnings: report.warnings,
      errors: report.errors,
      recommendations: report.recommendations,
      confidenceScore: report.confidenceScore,
      // rawResponse omitted in v1 (agents do not capture raw API bodies).
    },
  });
  await prisma.adReview.create({
    data: {
      approvalId: approval.id,
      revisionNumber: latest.revisionNumber,
      stage: config.reviewStage,
      reviewerType: "AI",
      reviewerName: config.agentName,
      decision: report.overallResult,
      comments: report.overallResult === DECISION.PASS ? null : (report.errors ?? report.recommendations ?? "See report"),
      aiReportId: aiReport.id,
    },
  });
  await markJob(job.id, "COMPLETED", null);

  await applyDecision(approval, config, started.version, report, summary);
  summary.jobsProcessed++;
}

async function applyDecision(
  approval: { id: string; campaignId: string; submitterId: string; version: number },
  config: StageConfig,
  version: number,
  report: AgentReport,
  summary: Summary,
): Promise<void> {
  const auditBase = { actor: `AI-${config.agentName}`, action: "REVIEW_COMPLETED" as const };

  if (report.overallResult === DECISION.NEEDS_REVISION) {
    await transition({
      approvalId: approval.id,
      from: config.inStatus,
      to: STATUS.NEEDS_REVISION,
      version,
      ...auditBase,
      comment: report.errors ?? report.recommendations ?? "Needs revision",
      details: { decision: DECISION.NEEDS_REVISION },
    });
    await createNotification({
      recipientId: approval.submitterId,
      type: "needs_revision",
      title: "Your ad needs revision",
      body: `✏️ [${approval.campaignId}] needs revision. Feedback: ${report.recommendations ?? report.errors ?? "See report"}. Please edit and resubmit.`,
      approvalId: approval.id,
    });
    summary.needsRevision++;
    return;
  }

  if (report.overallResult === DECISION.REJECTED) {
    await transition({
      approvalId: approval.id,
      from: config.inStatus,
      to: STATUS.REJECTED,
      version,
      ...auditBase,
      comment: report.errors ?? "Rejected",
      details: { decision: DECISION.REJECTED },
      data: { rejectedAt: new Date() },
    });
    await createNotification({
      recipientId: approval.submitterId,
      type: "rejected",
      title: "Your ad was rejected",
      body: `❌ [${approval.campaignId}] has been rejected. Reason: ${report.errors ?? "policy violation"}. You may create a new submission.`,
      approvalId: approval.id,
    });
    summary.rejected++;
    return;
  }

  // PASS — advance to the next stage.
  summary.passed++;
  if (config.reviewStage === REVIEW_STAGE.PRE_REVIEW) {
    const res = await transition({
      approvalId: approval.id,
      from: config.inStatus,
      to: STATUS.FOR_BRAND_REVIEW,
      version,
      ...auditBase,
      data: { stage: "BRAND" },
      details: { decision: DECISION.PASS },
    });
    if (res.ok) await enqueueAiJob(approval.id, REVIEW_STAGE.BRAND_REVIEW);
    await notifyPass(approval, "AI Pre-Review", "Brand Review");
    return;
  }

  if (config.reviewStage === REVIEW_STAGE.BRAND_REVIEW) {
    const res = await transition({
      approvalId: approval.id,
      from: config.inStatus,
      to: STATUS.FOR_CONVERSION_REVIEW,
      version,
      ...auditBase,
      data: { stage: "CONVERSION" },
      details: { decision: DECISION.PASS },
    });
    if (res.ok) await assignConversionReviewer(approval.id);
    await notifyPass(approval, "Brand Review", "Conversion Review");
    return;
  }

  // TECHNICAL_REVIEW pass — the conflict resolver performs the
  // IN_TECHNICAL_REVIEW -> Penultimate/Final transition itself (with
  // conflict-of-interest handling), reading the fresh approval row. We do NOT
  // pre-transition out of IN_TECHNICAL_REVIEW here.
  const outcome = await transitionToPenultimate(approval.id);
  if (outcome.ok) {
    await notifyPass(
      approval,
      "Technical Review",
      outcome.escalated ? "Final Approver" : "Penultimate Approver",
    );
  } else {
    await createNotification({
      recipientId: ADMIN_RECIPIENT,
      type: "manual_intervention",
      title: "Technical Review passed but could not advance",
      body: `Approval ${approval.id} blocked after Technical Review: ${outcome.blocked}.`,
      approvalId: approval.id,
      severity: "critical",
    });
  }
}

async function notifyPass(
  approval: { id: string; campaignId: string; submitterId: string },
  passedStage: string,
  nextStage: string,
): Promise<void> {
  await createNotification({
    recipientId: approval.submitterId,
    type: "review_passed",
    title: `${passedStage} passed`,
    body: `[${approval.campaignId}] passed ${passedStage}. Next stage: ${nextStage}.`,
    approvalId: approval.id,
  });
}

async function failOrRetry(
  job: { id: string; attemptNumber: number },
  approvalId: string,
  config: StageConfig,
  version: number,
  message: string,
): Promise<void> {
  // Revert in_X_review -> for_X_review so the retry re-runs from the queue state.
  await transition({
    approvalId,
    from: config.inStatus,
    to: config.forStatus,
    version,
    actor: "system",
    action: "AI_JOB_FAILED",
    comment: message,
  }).catch(() => {});

  const retryIndex = job.attemptNumber - 1;
  if (retryIndex >= RETRY_BACKOFF_MS.length) {
    // Retries exhausted — flag for manual intervention (spec §Failure Handling).
    await markJob(job.id, "FAILED", message);
    await flagForManualIntervention({
      approvalId,
      reason: `AI ${config.reviewStage} job failed after ${job.attemptNumber} attempts: ${message}`,
    });
    await createNotification({
      recipientId: ADMIN_RECIPIENT,
      type: "ai_job_failed",
      title: "AI review job failed after all retries",
      body: `Approval ${approvalId} — ${config.reviewStage} exhausted retries: ${message}`,
      approvalId,
      severity: "critical",
    });
    return;
  }

  const nextRetryAt = new Date(Date.now() + RETRY_BACKOFF_MS[retryIndex]!);
  await prisma.adAIJobQueue.update({
    where: { id: job.id },
    data: { status: "RETRY", attemptNumber: job.attemptNumber + 1, nextRetryAt, errorMessage: message },
  });
}

async function markJob(id: string, status: string, errorMessage: string | null): Promise<void> {
  await prisma.adAIJobQueue.update({
    where: { id },
    data: {
      status,
      errorMessage,
      ...(status === "COMPLETED" || status === "FAILED" ? { completedAt: new Date() } : {}),
    },
  });
}
