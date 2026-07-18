export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { z } from "zod";
import { STATUS, REVIEW_STAGE, DECISION } from "@/lib/ad-approval/constants";
import { transition } from "@/lib/ad-approval/state-machine";
import { createNotification, notifyMany } from "@/lib/notifications";
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

// POST /api/ad-approvals/[id]/final — Final Approver decision (terminal approve).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const ctx = await resolveActor(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const approval = await loadApproval(id);
  if (!approval) return notFound();
  if (approval.assignedFinalApproverId !== ctx.actor && !(await isAdmin(req))) {
    await auditDenied(ctx.actor, "final", id, "not_assigned_approver");
    return forbidden();
  }
  if (approval.status !== STATUS.WITH_FINAL_APPROVER) {
    return conflict(`Ad is not awaiting final approval (status: ${approval.status}).`);
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest("Invalid input", parsed.error.flatten());
  const { decision, comments } = parsed.data;
  const reviewerName = await getDisplayName(ctx.actor);

  if (decision !== "approve" && !comments?.trim()) {
    return badRequest("Comments/reason are required.");
  }

  const to =
    decision === "approve" ? STATUS.APPROVED : decision === "revision" ? STATUS.NEEDS_REVISION : STATUS.REJECTED;
  const reviewDecision =
    decision === "approve" ? DECISION.PASS : decision === "revision" ? DECISION.NEEDS_REVISION : DECISION.REJECTED;

  const result = await transition({
    approvalId: id,
    from: STATUS.WITH_FINAL_APPROVER,
    to,
    version: approval.version,
    actor: ctx.actor,
    action: decision === "approve" ? "APPROVED" : decision === "revision" ? "REVISION_REQUESTED" : "REJECTED",
    comment: comments ?? null,
    data:
      decision === "approve"
        ? { approvedAt: new Date() }
        : decision === "reject"
          ? { rejectedAt: new Date() }
          : {},
  });
  if (!result.ok) {
    return result.reason === "lost_race" ? conflict("State changed; please retry.") : badRequest("Invalid transition.");
  }

  await recordHumanReview({
    approvalId: id,
    revisionNumber: approval.currentRevision,
    stage: REVIEW_STAGE.FINAL_APPROVAL,
    reviewerId: ctx.actor,
    reviewerName,
    decision: reviewDecision,
    comments: comments ?? null,
  });

  if (decision === "approve") {
    await notifyMany(
      [approval.submitterId, approval.assignedConversionReviewerId, approval.assignedPenultimateApproverId, approval.assignedFinalApproverId],
      {
        type: "approved",
        title: "Ad approved 🎉",
        body: `🎉 [${approval.campaignId}] has been approved and is ready to launch!`,
        approvalId: id,
      },
    );
  } else {
    await createNotification({
      recipientId: approval.submitterId,
      type: reviewDecision === DECISION.REJECTED ? "rejected" : "needs_revision",
      title: reviewDecision === DECISION.REJECTED ? "Your ad was rejected" : "Your ad needs revision",
      body:
        reviewDecision === DECISION.REJECTED
          ? `❌ [${approval.campaignId}] was rejected at Final Approval. Reason: ${comments}.`
          : `✏️ [${approval.campaignId}] needs revision (Final Approval). Feedback: ${comments}.`,
      approvalId: id,
    });
  }
  return NextResponse.json({ ok: true, status: to });
}
