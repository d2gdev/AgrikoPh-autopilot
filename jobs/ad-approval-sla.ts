// SLA escalation worker (spec §SLA Escalation Background Job). Runs every 5
// minutes. Escalates ad approvals that have sat too long with a human reviewer:
// Conversion 4h, Penultimate 8h, Final 24h. Cron-driven under a JobLock.

import { prisma } from "@/lib/db";
import type { JobResult, JobStatus } from "@/lib/jobs/types";
import { STATUS, REVIEWER_ROLE, SLA_MS } from "@/lib/ad-approval/constants";
import { transition, flagForManualIntervention } from "@/lib/ad-approval/state-machine";
import { getReviewerAssignments } from "@/lib/ad-approval/reviewers";
import { createNotification, ADMIN_RECIPIENT } from "@/lib/notifications";

const JOB_NAME = "ad-approval-sla";
const BATCH = 50;

type Summary = {
  scanned: number;
  escalatedToBackup: number;
  escalatedToFinal: number;
  flaggedForAdmin: number;
};

export async function adApprovalSlaHandler(): Promise<JobResult<Summary>> {
  const runId = (await prisma.jobRun.create({ data: { jobName: JOB_NAME } })).id;
  const errors: string[] = [];
  const summary: Summary = { scanned: 0, escalatedToBackup: 0, escalatedToFinal: 0, flaggedForAdmin: 0 };

  const now = Date.now();
  const roles = await getReviewerAssignments();

  const groups = [
    { status: STATUS.IN_CONVERSION_REVIEW, thresholdMs: SLA_MS.CONVERSION, kind: "CONVERSION" as const },
    { status: STATUS.WITH_PENULTIMATE_APPROVER, thresholdMs: SLA_MS.PENULTIMATE, kind: "PENULTIMATE" as const },
    { status: STATUS.WITH_FINAL_APPROVER, thresholdMs: SLA_MS.FINAL, kind: "FINAL" as const },
  ];

  for (const group of groups) {
    const cutoff = new Date(now - group.thresholdMs);
    const stuck = await prisma.adApproval.findMany({
      where: { status: group.status, updatedAt: { lt: cutoff } },
      take: BATCH,
    });
    for (const approval of stuck) {
      summary.scanned++;
      try {
        await escalate(group.kind, approval, roles, summary);
      } catch (err) {
        errors.push(`${approval.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const status: JobStatus = errors.length ? (summary.scanned ? "partial" : "failed") : "success";
  await prisma.jobRun.update({
    where: { id: runId },
    data: { completedAt: new Date(), status, summary, errorLog: errors.join("\n") || null },
  });
  return { jobName: JOB_NAME, runId, status, summary, errors };
}

type Approval = {
  id: string;
  campaignId: string;
  version: number;
  assignedConversionReviewerId: string | null;
  assignedPenultimateApproverId: string | null;
  assignedFinalApproverId: string | null;
};

async function reassignToBackup(
  approval: Approval,
  field: "assignedConversionReviewerId" | "assignedPenultimateApproverId",
  backupUserId: string,
  reason: string,
): Promise<boolean> {
  const locked = await prisma.adApproval.updateMany({
    where: { id: approval.id, version: approval.version },
    data: { [field]: backupUserId, version: approval.version + 1, updatedAt: new Date() },
  });
  if (locked.count === 0) return false;
  await prisma.auditLog.create({
    data: {
      actor: "system",
      action: "ESCALATED",
      entityType: "ad_approval",
      entityId: approval.id,
      meta: { reason, new_reviewer: backupUserId },
    },
  });
  await createNotification({
    recipientId: backupUserId,
    type: "escalation",
    title: "Escalated to you (backup reviewer)",
    body: `[${approval.campaignId}] escalated to you — the primary reviewer was unavailable.`,
    approvalId: approval.id,
  });
  return true;
}

async function flagAdmin(approvalId: string, campaignId: string, reason: string, critical = false): Promise<void> {
  await flagForManualIntervention({ approvalId, reason });
  await createNotification({
    recipientId: ADMIN_RECIPIENT,
    type: "escalation_required",
    title: critical ? "🚨 SLA breach — manual intervention required" : "Escalation required",
    body: `[${campaignId}] ${reason}`,
    approvalId,
    severity: "critical",
  });
}

async function escalate(
  kind: "CONVERSION" | "PENULTIMATE" | "FINAL",
  approval: Approval,
  roles: Awaited<ReturnType<typeof getReviewerAssignments>>,
  summary: Summary,
): Promise<void> {
  if (kind === "CONVERSION") {
    const backup = roles[REVIEWER_ROLE.CONVERSION_REVIEWER]?.backupUserId ?? null;
    if (backup && backup !== approval.assignedConversionReviewerId) {
      if (await reassignToBackup(approval, "assignedConversionReviewerId", backup, "Conversion Reviewer unavailable >4h")) {
        summary.escalatedToBackup++;
        return;
      }
    }
    await flagAdmin(approval.id, approval.campaignId, "Conversion Reviewer SLA breach (>4h), no backup available");
    summary.flaggedForAdmin++;
    return;
  }

  if (kind === "PENULTIMATE") {
    const backup = roles[REVIEWER_ROLE.PENULTIMATE_APPROVER]?.backupUserId ?? null;
    if (backup && backup !== approval.assignedPenultimateApproverId) {
      if (await reassignToBackup(approval, "assignedPenultimateApproverId", backup, "Penultimate Approver unavailable >8h")) {
        summary.escalatedToBackup++;
        return;
      }
    }
    // No usable backup — escalate to Final, skipping the Penultimate stage.
    const final = roles[REVIEWER_ROLE.FINAL_APPROVER];
    if (!final) {
      await flagAdmin(approval.id, approval.campaignId, "Penultimate SLA breach (>8h) and Final Approver unassigned");
      summary.flaggedForAdmin++;
      return;
    }
    const res = await transition({
      approvalId: approval.id,
      from: STATUS.WITH_PENULTIMATE_APPROVER,
      to: STATUS.WITH_FINAL_APPROVER,
      version: approval.version,
      actor: "system",
      action: "ESCALATED",
      comment: "Penultimate Approver SLA breach, escalated to Final",
      details: { skipped_stage: "PENULTIMATE_APPROVER", escalated_to: "FINAL_APPROVER" },
      data: { stage: "FINAL", assignedPenultimateApproverId: null, assignedFinalApproverId: final.assignedUserId },
    });
    if (res.ok) {
      summary.escalatedToFinal++;
      await createNotification({
        recipientId: final.assignedUserId,
        type: "escalation",
        title: "Escalated to you (Final Approver)",
        body: `[${approval.campaignId}] escalated from Penultimate (primary unavailable). Please review.`,
        approvalId: approval.id,
      });
    }
    return;
  }

  // FINAL: no auto-escalation possible — critical admin flag.
  await flagAdmin(approval.id, approval.campaignId, "Final Approver unavailable >24h, no auto-escalation possible", true);
  summary.flaggedForAdmin++;
}
