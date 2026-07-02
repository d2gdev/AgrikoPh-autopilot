// Conflict-of-interest detection at state-transition time (spec §Conflict-of-
// Interest Detection). Two entry points:
//
//   Transition A — In Technical Review → Penultimate: runs in the AI worker, so
//   it returns a JobResult-style outcome and flags on any blocking condition.
//
//   Transition B — Penultimate → Final: runs in an HTTP handler, so it returns
//   an HTTP-style outcome (200 / 409 / 503) for the caller to map to a response.

import { prisma } from "@/lib/db";
import { STATUS, REVIEWER_ROLE } from "./constants";
import { transition, flagForManualIntervention } from "./state-machine";
import { getRole } from "./reviewers";
import { createNotification, ADMIN_RECIPIENT } from "@/lib/notifications";

export type ConflictOutcomeA =
  | { ok: true; escalated: boolean }
  | { ok: false; blocked: string };

/**
 * Transition A: the AI Technical Review worker passed the ad. Advance to the
 * Penultimate Approver, or — if the submitter IS the Penultimate Approver —
 * escalate past that stage straight to the Final Approver.
 */
export async function transitionToPenultimate(approvalId: string): Promise<ConflictOutcomeA> {
  const approval = await prisma.adApproval.findUnique({ where: { id: approvalId } });
  if (!approval) return { ok: false, blocked: "NOT_FOUND" };

  const penultimate = await getRole(REVIEWER_ROLE.PENULTIMATE_APPROVER);
  if (!penultimate) {
    await flagForManualIntervention({ approvalId, reason: "Penultimate Approver role unassigned" });
    await notifyAdmin(approvalId, "Penultimate Approver role is unassigned; approval cannot proceed.");
    return { ok: false, blocked: "CONFIG_ERROR: Penultimate Approver unassigned" };
  }

  // Conflict: submitter is the Penultimate Approver -> escalate to Final.
  if (approval.submitterId === penultimate.assignedUserId) {
    const final = await getRole(REVIEWER_ROLE.FINAL_APPROVER);
    if (!final) {
      await flagForManualIntervention({
        approvalId,
        reason: "Conflict: submitter is Penultimate Approver, and Final Approver is unassigned",
      });
      await notifyAdmin(approvalId, "Conflict escalation blocked: Final Approver unassigned.");
      return { ok: false, blocked: "CONFIG_ERROR: escalation target (Final Approver) unassigned" };
    }

    // Spec: if the submitter is ALSO the Final Approver, the escalation path is
    // exhausted — block and flag rather than handing the ad to its own submitter.
    if (approval.submitterId === final.assignedUserId) {
      await flagForManualIntervention({
        approvalId,
        reason: "Conflict: submitter is both Penultimate and Final Approver. No escalation path available.",
      });
      await notifyAdmin(
        approvalId,
        `🚨 CRITICAL: [${approval.campaignId}] — submitter is both Penultimate and Final Approver. Manual intervention required.`,
      );
      return { ok: false, blocked: "CONFLICT_UNRESOLVABLE: submitter is Penultimate and Final Approver" };
    }

    const res = await transition({
      approvalId,
      from: STATUS.IN_TECHNICAL_REVIEW,
      to: STATUS.WITH_FINAL_APPROVER,
      version: approval.version,
      actor: "system",
      action: "CONFLICT_ESCALATED",
      comment: "Submitter is Penultimate Approver; escalated to Final Approver",
      details: { skipped_stage: "PENULTIMATE_APPROVER", escalated_to: "FINAL_APPROVER" },
      data: {
        stage: "FINAL",
        assignedPenultimateApproverId: null,
        assignedFinalApproverId: final.assignedUserId,
      },
    });
    if (!res.ok) return { ok: false, blocked: res.reason };

    await createNotification({
      recipientId: final.assignedUserId,
      type: "assigned_final_approver",
      title: "Escalated to you (conflict of interest)",
      body: `[${approval.campaignId}] escalated to you from Penultimate Approver (submitter is the Penultimate Approver). Please review.`,
      approvalId,
    });
    return { ok: true, escalated: true };
  }

  // No conflict; proceed to Penultimate Approver.
  const res = await transition({
    approvalId,
    from: STATUS.IN_TECHNICAL_REVIEW,
    to: STATUS.WITH_PENULTIMATE_APPROVER,
    version: approval.version,
    actor: "system",
    action: "STATUS_CHANGED",
    data: { stage: "PENULTIMATE", assignedPenultimateApproverId: penultimate.assignedUserId },
  });
  if (!res.ok) return { ok: false, blocked: res.reason };

  await createNotification({
    recipientId: penultimate.assignedUserId,
    type: "assigned_penultimate_approver",
    title: "Awaiting your penultimate approval",
    body: `[${approval.campaignId}] is now awaiting your penultimate approval.`,
    approvalId,
  });
  return { ok: true, escalated: false };
}

export type ConflictOutcomeB =
  | { ok: true }
  | { ok: false; httpStatus: 409 | 503; error: string };

/**
 * Transition B: the Penultimate Approver clicked Approve. Advance to the Final
 * Approver, unless the submitter IS the Final Approver (escalation exhausted).
 * `approval` must be the current row (its version drives the CAS).
 */
export async function transitionToFinal(approval: {
  id: string;
  campaignId: string;
  submitterId: string;
  version: number;
}): Promise<ConflictOutcomeB> {
  const final = await getRole(REVIEWER_ROLE.FINAL_APPROVER);
  if (!final) {
    await flagForManualIntervention({ approvalId: approval.id, reason: "Final Approver role unassigned" });
    return {
      ok: false,
      httpStatus: 503,
      error: "Final Approver role is not configured. Approval cannot proceed until an admin assigns it.",
    };
  }

  // Unresolvable conflict: submitter is both Penultimate and Final Approver.
  if (approval.submitterId === final.assignedUserId) {
    await flagForManualIntervention({
      approvalId: approval.id,
      reason: "Conflict of interest: submitter is both Penultimate and Final Approver. No escalation path available.",
    });
    await prisma.auditLog.create({
      data: {
        actor: "system",
        action: "CONFLICT_UNRESOLVABLE",
        entityType: "ad_approval",
        entityId: approval.id,
        before: { status: STATUS.WITH_PENULTIMATE_APPROVER },
        after: {},
        meta: { comment: "Submitter is Final Approver; cannot proceed. Admin must reassign or approve manually." },
      },
    });
    await notifyAdmin(
      approval.id,
      `🚨 CRITICAL: [${approval.campaignId}] by ${approval.submitterId} has unresolvable conflict of interest. Submitter is both Penultimate and Final Approver.`,
    );
    return {
      ok: false,
      httpStatus: 409,
      error: "Submitter cannot be Final Approver for own ad. Escalation path exhausted. Admin intervention required.",
    };
  }

  const res = await transition({
    approvalId: approval.id,
    from: STATUS.WITH_PENULTIMATE_APPROVER,
    to: STATUS.WITH_FINAL_APPROVER,
    version: approval.version,
    actor: "system",
    action: "STATUS_CHANGED",
    data: { stage: "FINAL", assignedFinalApproverId: final.assignedUserId },
  });
  if (!res.ok) {
    return { ok: false, httpStatus: 409, error: "Approval state changed concurrently; please retry." };
  }

  await createNotification({
    recipientId: final.assignedUserId,
    type: "assigned_final_approver",
    title: "Awaiting your final approval",
    body: `[${approval.campaignId}] is now awaiting your final approval.`,
    approvalId: approval.id,
  });
  return { ok: true };
}

export type ConversionAssignOutcome =
  | { ok: true }
  | { ok: false; blocked: string };

/**
 * After Brand Review passes, assign the Conversion Reviewer and move the ad
 * into In Conversion Review. If the submitter IS the Conversion Reviewer,
 * prevent assignment and escalate to admin (spec §Conflict — Any stage →
 * In Conversion Review); the ad stays in For Conversion Review, flagged.
 */
export async function assignConversionReviewer(approvalId: string): Promise<ConversionAssignOutcome> {
  const approval = await prisma.adApproval.findUnique({ where: { id: approvalId } });
  if (!approval) return { ok: false, blocked: "NOT_FOUND" };

  const conv = await getRole(REVIEWER_ROLE.CONVERSION_REVIEWER);
  if (!conv) {
    await flagForManualIntervention({ approvalId, reason: "Conversion Reviewer role unassigned" });
    await notifyAdmin(approvalId, "Conversion Reviewer role is unassigned; approval cannot proceed.");
    return { ok: false, blocked: "CONFIG_ERROR: Conversion Reviewer unassigned" };
  }

  if (approval.submitterId === conv.assignedUserId) {
    await flagForManualIntervention({
      approvalId,
      reason: "Conflict: submitter is the Conversion Reviewer. Manual reassignment required.",
    });
    await notifyAdmin(
      approvalId,
      `Escalation required: [${approval.campaignId}] — submitter is the Conversion Reviewer. Assign an alternate reviewer.`,
    );
    return { ok: false, blocked: "CONFLICT_CONVERSION" };
  }

  const res = await transition({
    approvalId,
    from: STATUS.FOR_CONVERSION_REVIEW,
    to: STATUS.IN_CONVERSION_REVIEW,
    version: approval.version,
    actor: "system",
    action: "REVIEW_ASSIGNED",
    data: { stage: "CONVERSION", assignedConversionReviewerId: conv.assignedUserId },
  });
  if (!res.ok) return { ok: false, blocked: res.reason };

  await createNotification({
    recipientId: conv.assignedUserId,
    type: "assigned_conversion_reviewer",
    title: "Awaiting your conversion review",
    body: `[${approval.campaignId}] by ${approval.submitterId} is now awaiting your conversion review. Please review within 4 hours.`,
    approvalId,
  });
  return { ok: true };
}

async function notifyAdmin(approvalId: string, body: string): Promise<void> {
  await createNotification({
    recipientId: ADMIN_RECIPIENT,
    type: "conflict",
    title: "Approval requires manual intervention",
    body,
    approvalId,
    severity: "critical",
  });
}
