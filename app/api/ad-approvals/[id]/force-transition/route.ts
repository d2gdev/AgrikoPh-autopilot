export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizePermission, PERMISSIONS, requireAppAuth } from "@/lib/auth";
import { STATUS, STAGE, REVIEW_STAGE, REVIEWER_ROLE } from "@/lib/ad-approval/constants";
import { enqueueAiJob, type AiStage } from "@/lib/ad-approval/jobs";
import { getRole } from "@/lib/ad-approval/reviewers";
import { loadApproval, auditDenied, notFound, conflict, badRequest } from "@/lib/ad-approval/route-helpers";

const ALLOWED_STATUSES = new Set<string>(Object.values(STATUS));

const schema = z.object({
  to: z.string().refine((s) => ALLOWED_STATUSES.has(s), "Unknown target status"),
  reason: z.string().min(1).max(2000),
});

// Which stage each status belongs to (null = keep the current stage).
const STATUS_STAGE: Record<string, string | null> = {
  [STATUS.DRAFT]: STAGE.PRE_REVIEW,
  [STATUS.FOR_AI_PRE_REVIEW]: STAGE.PRE_REVIEW,
  [STATUS.IN_AI_PRE_REVIEW]: STAGE.PRE_REVIEW,
  [STATUS.FOR_BRAND_REVIEW]: STAGE.BRAND,
  [STATUS.IN_BRAND_REVIEW]: STAGE.BRAND,
  [STATUS.FOR_CONVERSION_REVIEW]: STAGE.CONVERSION,
  [STATUS.IN_CONVERSION_REVIEW]: STAGE.CONVERSION,
  [STATUS.FOR_TECHNICAL_REVIEW]: STAGE.TECHNICAL,
  [STATUS.IN_TECHNICAL_REVIEW]: STAGE.TECHNICAL,
  [STATUS.WITH_PENULTIMATE_APPROVER]: STAGE.PENULTIMATE,
  [STATUS.WITH_FINAL_APPROVER]: STAGE.FINAL,
  [STATUS.APPROVED]: null,
  [STATUS.NEEDS_REVISION]: null,
  [STATUS.REJECTED]: null,
  [STATUS.CANCELLED]: null,
};

// Queue statuses that need an AI job enqueued or the worker will never pick
// the approval up.
const STATUS_AI_JOB: Record<string, AiStage> = {
  [STATUS.FOR_AI_PRE_REVIEW]: REVIEW_STAGE.PRE_REVIEW,
  [STATUS.FOR_BRAND_REVIEW]: REVIEW_STAGE.BRAND_REVIEW,
  [STATUS.FOR_TECHNICAL_REVIEW]: REVIEW_STAGE.TECHNICAL_REVIEW,
};

// POST /api/ad-approvals/[id]/force-transition — admin override. Bypasses the
// normal transition table (that's the point of a force), but keeps the rest of
// the workflow machinery in sync: stage, reviewer assignment, terminal
// timestamps, AI job enqueue, and the manual-intervention flag are all updated
// to match the target status. Requires a justification; writes a
// FORCE_TRANSITION audit row. Version-guarded.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const auth = await authorizePermission(req, PERMISSIONS.AD_APPROVAL_ADMIN);
  const { id } = await params;
  if (!auth.allowed) {
    await auditDenied(auth.actor ?? "anonymous", "force_transition", id, "missing_admin_permission");
    return auth.response;
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest("Invalid input", parsed.error.flatten());
  const to = parsed.data.to;

  const approval = await loadApproval(id);
  if (!approval) return notFound();

  // Sync the workflow machinery with the forced status.
  const data: Prisma.AdApprovalUpdateManyMutationInput = {
    status: to,
    version: approval.version + 1,
    stageEnteredAt: new Date(),
    updatedAt: new Date(),
    // A force is the admin resolving whatever was stuck — clear the flag.
    flags: Prisma.DbNull,
  };
  const stage = STATUS_STAGE[to];
  if (stage) data.stage = stage;
  if (to === STATUS.APPROVED) data.approvedAt = new Date();
  if (to === STATUS.REJECTED) data.rejectedAt = new Date();

  // Human-review statuses need the assignee set or nobody (but admins) can act.
  if (to === STATUS.IN_CONVERSION_REVIEW) {
    const role = await getRole(REVIEWER_ROLE.CONVERSION_REVIEWER);
    if (role) data.assignedConversionReviewerId = role.assignedUserId;
  } else if (to === STATUS.WITH_PENULTIMATE_APPROVER) {
    const role = await getRole(REVIEWER_ROLE.PENULTIMATE_APPROVER);
    if (role) data.assignedPenultimateApproverId = role.assignedUserId;
  } else if (to === STATUS.WITH_FINAL_APPROVER) {
    const role = await getRole(REVIEWER_ROLE.FINAL_APPROVER);
    if (role) data.assignedFinalApproverId = role.assignedUserId;
  }

  const locked = await prisma.adApproval.updateMany({
    where: { id, version: approval.version },
    data,
  });
  if (locked.count === 0) return conflict("State changed; please retry.");

  // Queue statuses need a job row or the worker never picks the approval up.
  const aiStage = STATUS_AI_JOB[to];
  if (aiStage) await enqueueAiJob(id, aiStage);

  await prisma.auditLog.create({
    data: {
      actor: auth.actor,
      action: "FORCE_TRANSITION",
      entityType: "ad_approval",
      entityId: id,
      before: { status: approval.status },
      after: { status: to },
      meta: { reason: parsed.data.reason, enqueuedAiJob: aiStage ?? null },
    },
  });
  return NextResponse.json({ ok: true, status: to });
}
