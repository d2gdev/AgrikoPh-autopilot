export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { z } from "zod";
import { STATUS, REVIEW_STAGE, DECISION, CONVERSION_QUESTION_COUNT } from "@/lib/ad-approval/constants";
import { evaluateConversion } from "@/lib/ad-approval/scoring";
import { transition } from "@/lib/ad-approval/state-machine";
import { enqueueAiJob } from "@/lib/ad-approval/jobs";
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
  scores: z.array(z.number().int().min(1).max(5)).length(CONVERSION_QUESTION_COUNT),
  comments: z.string().max(5000).optional(),
});

// POST /api/ad-approvals/[id]/conversion-review — assigned Conversion Reviewer
// submits the 6-question rubric. Pass requires total >= 24 AND no question < 3.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const ctx = await resolveActor(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const approval = await loadApproval(id);
  if (!approval) return notFound();
  if (approval.assignedConversionReviewerId !== ctx.actor && !(await isAdmin(req))) {
    await auditDenied(ctx.actor, "conversion_review", id, "not_assigned_reviewer");
    return forbidden();
  }
  if (approval.status !== STATUS.IN_CONVERSION_REVIEW) {
    return conflict(`Ad is not awaiting conversion review (status: ${approval.status}).`);
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest("Invalid input", parsed.error.flatten());
  const { scores, comments } = parsed.data;

  const { total, lowest, passed } = evaluateConversion(scores);

  if (!passed && !comments?.trim()) {
    return badRequest("Comments are required when requesting revision (explain the low-scoring questions).");
  }

  const reviewerName = await getDisplayName(ctx.actor);
  const decision = passed ? DECISION.PASS : DECISION.NEEDS_REVISION;
  const to = passed ? STATUS.FOR_TECHNICAL_REVIEW : STATUS.NEEDS_REVISION;

  const result = await transition({
    approvalId: id,
    from: STATUS.IN_CONVERSION_REVIEW,
    to,
    version: approval.version,
    actor: ctx.actor,
    action: "REVIEW_COMPLETED",
    comment: comments ?? null,
    details: { decision, score: total, lowest, ...(passed ? { stage: "TECHNICAL" } : {}) },
    data: passed ? { stage: "TECHNICAL" } : {},
  });
  if (!result.ok) {
    return result.reason === "lost_race" ? conflict("State changed; please retry.") : badRequest("Invalid transition.");
  }

  await recordHumanReview({
    approvalId: id,
    revisionNumber: approval.currentRevision,
    stage: REVIEW_STAGE.CONVERSION_REVIEW,
    reviewerId: ctx.actor,
    reviewerName,
    decision,
    score: total,
    comments: comments ?? null,
    jsonMetadata: { questionScores: scores },
  });

  if (passed) {
    await enqueueAiJob(id, REVIEW_STAGE.TECHNICAL_REVIEW);
    await createNotification({
      recipientId: approval.submitterId,
      type: "review_passed",
      title: "Conversion Review passed",
      body: `[${approval.campaignId}] passed Conversion Review (score ${total}/30). Next stage: Technical Review.`,
      approvalId: id,
    });
  } else {
    await createNotification({
      recipientId: approval.submitterId,
      type: "needs_revision",
      title: "Your ad needs revision",
      body: `✏️ [${approval.campaignId}] needs revision after Conversion Review. Feedback: ${comments}. Please edit and resubmit.`,
      approvalId: id,
    });
  }

  return NextResponse.json({ ok: true, decision, total, lowest });
}
