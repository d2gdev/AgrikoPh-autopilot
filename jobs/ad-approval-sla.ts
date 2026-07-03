// SLA escalation worker (spec §SLA Escalation Background Job). Runs every 5
// minutes. Escalates ad approvals that have sat too long with a human reviewer:
// Conversion 4h, Penultimate 8h, Final 24h. Cron-driven under a JobLock.
//
// Correctness notes:
// - Stage age is measured from stageEnteredAt (set by every transition), not
//   updatedAt — unrelated row writes must not reset the SLA clock.
// - Escalation enforces the same conflict-of-interest rule as conflict.ts:
//   the submitter is never assigned as a reviewer/approver of their own ad.
// - Approvals already flagged requires_manual_intervention are skipped
//   (dedupe — the admin has already been alerted).
// - A lost CAS race (the reviewer acted concurrently) is a no-op, not a
//   critical alert.

import { prisma } from "@/lib/db";
import type { JobResult, JobStatus } from "@/lib/jobs/types";
import { STATUS, REVIEWER_ROLE, SLA_MS } from "@/lib/ad-approval/constants";
import { transition, flagForManualIntervention } from "@/lib/ad-approval/state-machine";
import { getReviewerAssignments } from "@/lib/ad-approval/reviewers";
import { createNotification, ADMIN_RECIPIENT } from "@/lib/notifications";
import { sendOperatorAlert } from "@/lib/alerts";

const JOB_NAME = "ad-approval-sla";
const BATCH = 50;

type Summary = {
  scanned: number;
  escalatedToBackup: number;
  escalatedToFinal: number;
  flaggedForAdmin: number;
  skippedLostRace: number;
};

export async function adApprovalSlaHandler(): Promise<JobResult<Summary>> {
  const runId = (await prisma.jobRun.create({ data: { jobName: JOB_NAME } })).id;
  const errors: string[] = [];
  const summary: Summary = {
    scanned: 0,
    escalatedToBackup: 0,
    escalatedToFinal: 0,
    flaggedForAdmin: 0,
    skippedLostRace: 0,
  };

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
      where: {
        status: group.status,
        // stageEnteredAt is the SLA clock; rows migrated before the column
        // existed fall back to updatedAt.
        OR: [
          { stageEnteredAt: { lt: cutoff } },
          { stageEnteredAt: null, updatedAt: { lt: cutoff } },
        ],
      },
      take: BATCH,
    });
    for (const approval of stuck) {
      // Already flagged — admin has been alerted; don't re-fire every cycle.
      const flags = approval.flags as { requires_manual_intervention?: boolean } | null;
      if (flags?.requires_manual_intervention) continue;

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
  submitterId: string;
  version: number;
  assignedConversionReviewerId: string | null;
  assignedPenultimateApproverId: string | null;
  assignedFinalApproverId: string | null;
};

type ReassignResult = "ok" | "lost_race";

async function reassignToBackup(
  approval: Approval,
  field: "assignedConversionReviewerId" | "assignedPenultimateApproverId",
  backupUserId: string,
  reason: string,
): Promise<ReassignResult> {
  const locked = await prisma.adApproval.updateMany({
    where: { id: approval.id, version: approval.version },
    data: { [field]: backupUserId, version: approval.version + 1, updatedAt: new Date() },
  });
  if (locked.count === 0) return "lost_race";
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
  return "ok";
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
  await sendOperatorAlert("sla_escalation", {
    approvalId,
    campaignId,
    reason,
    critical,
  });
}

/** A backup is usable only if it exists, differs from the current assignee,
 *  and is NOT the ad's own submitter (conflict of interest). */
function usableBackup(backup: string | null, currentAssignee: string | null, submitterId: string): string | null {
  if (!backup) return null;
  if (backup === currentAssignee) return null;
  if (backup === submitterId) return null;
  return backup;
}

async function escalate(
  kind: "CONVERSION" | "PENULTIMATE" | "FINAL",
  approval: Approval,
  roles: Awaited<ReturnType<typeof getReviewerAssignments>>,
  summary: Summary,
): Promise<void> {
  if (kind === "CONVERSION") {
    const backup = usableBackup(
      roles[REVIEWER_ROLE.CONVERSION_REVIEWER]?.backupUserId ?? null,
      approval.assignedConversionReviewerId,
      approval.submitterId,
    );
    if (backup) {
      const res = await reassignToBackup(approval, "assignedConversionReviewerId", backup, "Conversion Reviewer unavailable >4h");
      if (res === "ok") summary.escalatedToBackup++;
      else summary.skippedLostRace++; // reviewer acted concurrently — nothing to do
      return;
    }
    await flagAdmin(approval.id, approval.campaignId, "Conversion Reviewer SLA breach (>4h), no usable backup (unset, same as assignee, or is the submitter)");
    summary.flaggedForAdmin++;
    return;
  }

  if (kind === "PENULTIMATE") {
    const backup = usableBackup(
      roles[REVIEWER_ROLE.PENULTIMATE_APPROVER]?.backupUserId ?? null,
      approval.assignedPenultimateApproverId,
      approval.submitterId,
    );
    if (backup) {
      const res = await reassignToBackup(approval, "assignedPenultimateApproverId", backup, "Penultimate Approver unavailable >8h");
      if (res === "ok") summary.escalatedToBackup++;
      else summary.skippedLostRace++;
      return;
    }
    // No usable backup — escalate to Final, skipping the Penultimate stage.
    const final = roles[REVIEWER_ROLE.FINAL_APPROVER];
    if (!final) {
      await flagAdmin(approval.id, approval.campaignId, "Penultimate SLA breach (>8h) and Final Approver unassigned");
      summary.flaggedForAdmin++;
      return;
    }
    // Conflict of interest: never escalate the ad to its own submitter.
    if (final.assignedUserId === approval.submitterId) {
      await flagAdmin(
        approval.id,
        approval.campaignId,
        "Penultimate SLA breach (>8h); cannot escalate to Final Approver — Final Approver is the submitter (conflict of interest)",
      );
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
    } else {
      summary.skippedLostRace++; // approver acted concurrently — nothing to do
    }
    return;
  }

  // FINAL: no auto-escalation possible — critical admin flag.
  await flagAdmin(approval.id, approval.campaignId, "Final Approver unavailable >24h, no auto-escalation possible", true);
  summary.flaggedForAdmin++;
}
