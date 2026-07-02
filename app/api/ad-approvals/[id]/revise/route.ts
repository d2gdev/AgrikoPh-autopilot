export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { STATUS } from "@/lib/ad-approval/constants";
import { transition } from "@/lib/ad-approval/state-machine";
import { resolveActor, isAdmin, loadApproval, auditDenied, forbidden, notFound, conflict, badRequest } from "@/lib/ad-approval/route-helpers";

// POST /api/ad-approvals/[id]/revise — submitter moves a Needs-Revision ad back
// to Draft, restoring the latest revision's copy/creative as the working draft.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveActor(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const approval = await loadApproval(id);
  if (!approval) return notFound();
  if (approval.submitterId !== ctx.actor && !(await isAdmin(req))) {
    await auditDenied(ctx.actor, "revise", id, "not_owner");
    return forbidden();
  }
  if (approval.status !== STATUS.NEEDS_REVISION) {
    return conflict(`Only ads in Needs Revision can be reopened (status: ${approval.status}).`);
  }

  const latest = await prisma.adRevision.findFirst({
    where: { approvalId: id },
    orderBy: { revisionNumber: "desc" },
  });

  const result = await transition({
    approvalId: id,
    from: STATUS.NEEDS_REVISION,
    to: STATUS.DRAFT,
    version: approval.version,
    actor: ctx.actor,
    action: "REVISION_EDITED",
    data: {
      stage: "PRE_REVIEW",
      draftCopy: (latest?.copy ?? {}) as object,
      draftCreative: (latest?.creative ?? {}) as object,
    },
  });
  if (!result.ok) {
    return result.reason === "lost_race" ? conflict("State changed; please retry.") : badRequest("Invalid transition.");
  }
  return NextResponse.json({ ok: true, status: STATUS.DRAFT });
}
