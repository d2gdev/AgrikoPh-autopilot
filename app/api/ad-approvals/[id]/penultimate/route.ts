export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { STATUS, REVIEW_STAGE, DECISION } from "@/lib/ad-approval/constants";
import { transition } from "@/lib/ad-approval/state-machine";
import { transitionToFinal } from "@/lib/ad-approval/conflict";
import { createNotification } from "@/lib/notifications";
import {
  resolveActor,
  isAdmin,
  loadApproval,
  auditDenied,
  forbidden,
  notFound,
  conflict,
  badRequest,
  recordHumanReview,
  getDisplayName,
} from "@/lib/ad-approval/route-helpers";

const schema = z.object({
  decision: z.enum(["approve", "revision", "reject"]),
  comments: z.string().max(5000).optional(),
});

// POST /api/ad-approvals/[id]/penultimate — Penultimate Approver decision.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveActor(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const approval = await loadApproval(id);
  if (!approval) return notFound();
  if (approval.assignedPenultimateApproverId !== ctx.actor && !(await isAdmin(req))) {
    await auditDenied(ctx.actor, "penultimate", id, "not_assigned_approver");
    return forbidden();
  }
  if (approval.status !== STATUS.WITH_PENULTIMATE_APPROVER) {
    return conflict(`Ad is not awaiting penultimate approval (status: ${approval.status}).`);
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest("Invalid input", parsed.error.flatten());
  const { decision, comments } = parsed.data;
  const reviewerName = await getDisplayName(ctx.actor);

  if (decision === "approve") {
    // Conflict-of-interest Transition B (submitter == Final Approver -> 409/503).
    const outcome = await transitionToFinal(approval);
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error, requires_manual_intervention: true }, { status: outcome.httpStatus });
    }
    await recordHumanReview({
      approvalId: id,
      revisionNumber: approval.currentRevision,
      stage: REVIEW_STAGE.PENULTIMATE_APPROVAL,
      reviewerId: ctx.actor,
      reviewerName,
      decision: DECISION.PASS,
      comments: comments ?? null,
    });
    return NextResponse.json({ ok: true, status: STATUS.WITH_FINAL_APPROVER });
  }

  // revision / reject both require comments.
  if (!comments?.trim()) return badRequest("Comments/reason are required.");
  const to = decision === "revision" ? STATUS.NEEDS_REVISION : STATUS.REJECTED;
  const reviewDecision = decision === "revision" ? DECISION.NEEDS_REVISION : DECISION.REJECTED;

  const result = await transition({
    approvalId: id,
    from: STATUS.WITH_PENULTIMATE_APPROVER,
    to,
    version: approval.version,
    actor: ctx.actor,
    action: decision === "revision" ? "REVISION_REQUESTED" : "REJECTED",
    comment: comments,
    data: decision === "reject" ? { rejectedAt: new Date() } : {},
  });
  if (!result.ok) {
    return result.reason === "lost_race" ? conflict("State changed; please retry.") : badRequest("Invalid transition.");
  }

  await recordHumanReview({
    approvalId: id,
    revisionNumber: approval.currentRevision,
    stage: REVIEW_STAGE.PENULTIMATE_APPROVAL,
    reviewerId: ctx.actor,
    reviewerName,
    decision: reviewDecision,
    comments,
  });
  await createNotification({
    recipientId: approval.submitterId,
    type: reviewDecision === DECISION.REJECTED ? "rejected" : "needs_revision",
    title: reviewDecision === DECISION.REJECTED ? "Your ad was rejected" : "Your ad needs revision",
    body:
      reviewDecision === DECISION.REJECTED
        ? `❌ [${approval.campaignId}] was rejected at Penultimate Approval. Reason: ${comments}.`
        : `✏️ [${approval.campaignId}] needs revision (Penultimate Approval). Feedback: ${comments}.`,
    approvalId: id,
  });
  return NextResponse.json({ ok: true, status: to });
}
