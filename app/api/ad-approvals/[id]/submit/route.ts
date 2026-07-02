export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { STATUS, REVIEW_STAGE } from "@/lib/ad-approval/constants";
import { transition } from "@/lib/ad-approval/state-machine";
import { enqueueAiJob } from "@/lib/ad-approval/jobs";
import { getRole } from "@/lib/ad-approval/reviewers";
import { REVIEWER_ROLE } from "@/lib/ad-approval/constants";
import { createNotification } from "@/lib/notifications";
import { resolveActor, isAdmin, loadApproval, auditDenied, forbidden, notFound, conflict, badRequest } from "@/lib/ad-approval/route-helpers";

const REQUIRED_COPY_FIELDS = ["primary_text", "headline", "cta"] as const;

// POST /api/ad-approvals/[id]/submit — freeze the draft into a new immutable
// revision and start the workflow. Handles both first submit and resubmit.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveActor(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const approval = await loadApproval(id);
  if (!approval) return notFound();
  if (approval.submitterId !== ctx.actor && !(await isAdmin(req))) {
    await auditDenied(ctx.actor, "submit", id, "not_owner");
    return forbidden();
  }
  // Duplicate submission / not a draft.
  if (approval.status !== STATUS.DRAFT) {
    return conflict("Approval already submitted or not in draft.");
  }

  const copy = (approval.draftCopy ?? {}) as Record<string, unknown>;
  const missing = REQUIRED_COPY_FIELDS.filter((f) => !copy[f] || String(copy[f]).trim() === "");
  if (missing.length) return badRequest(`Missing required fields: ${missing.join(", ")}`);

  // Revision number = count of existing revisions + 1 (1 on first submit).
  const existing = await prisma.adRevision.count({ where: { approvalId: id } });
  const revisionNumber = existing + 1;

  await prisma.adRevision.create({
    data: {
      approvalId: id,
      revisionNumber,
      copy: approval.draftCopy as object,
      creative: (approval.draftCreative ?? {}) as object,
      statusAtSubmission: STATUS.DRAFT,
    },
  });

  const result = await transition({
    approvalId: id,
    from: STATUS.DRAFT,
    to: STATUS.FOR_AI_PRE_REVIEW,
    version: approval.version,
    actor: ctx.actor,
    action: revisionNumber === 1 ? "SUBMITTED" : "RE_SUBMITTED",
    details: { revision_number: revisionNumber },
    data: { currentRevision: revisionNumber, stage: "PRE_REVIEW" },
  });
  if (!result.ok) {
    return result.reason === "lost_race"
      ? conflict("Approval state changed; please retry.")
      : badRequest("Invalid transition.");
  }

  await enqueueAiJob(id, REVIEW_STAGE.PRE_REVIEW);

  // Notify submitter + pre-notify the assigned Conversion Reviewer.
  await createNotification({
    recipientId: ctx.actor,
    type: "submitted",
    title: "Ad submitted for review",
    body: `Your ad [${approval.campaignId}] has been submitted for review. Current stage: For AI Pre-Review.`,
    approvalId: id,
  });
  const conv = await getRole(REVIEWER_ROLE.CONVERSION_REVIEWER);
  if (conv && conv.assignedUserId !== ctx.actor) {
    await createNotification({
      recipientId: conv.assignedUserId,
      type: "submitted_prenotify",
      title: "Ad submitted (heads up)",
      body: `[${approval.campaignId}] was submitted and will reach your Conversion Review queue after AI checks.`,
      approvalId: id,
    });
  }

  return NextResponse.json({ ok: true, revisionNumber, status: STATUS.FOR_AI_PRE_REVIEW });
}
