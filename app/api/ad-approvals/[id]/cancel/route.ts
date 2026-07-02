export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { STATUS, TERMINAL_STATUSES } from "@/lib/ad-approval/constants";
import { resolveActor, isAdmin, loadApproval, auditDenied, forbidden, notFound, conflict, badRequest } from "@/lib/ad-approval/route-helpers";

const schema = z.object({ reason: z.string().min(1).max(2000) });

// POST /api/ad-approvals/[id]/cancel — submitter or admin cancels a non-terminal
// approval. Records the cancellation reason in the audit log.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveActor(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const approval = await loadApproval(id);
  if (!approval) return notFound();
  if (approval.submitterId !== ctx.actor && !(await isAdmin(req))) {
    await auditDenied(ctx.actor, "cancel", id, "not_owner_or_admin");
    return forbidden();
  }
  if (TERMINAL_STATUSES.has(approval.status)) {
    return conflict(`Approval is already terminal (status: ${approval.status}).`);
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest("A cancellation reason is required.");

  // Cancel is reachable from any non-terminal state, so guard on version only.
  const locked = await prisma.adApproval.updateMany({
    where: { id, version: approval.version },
    data: { status: STATUS.CANCELLED, version: approval.version + 1, updatedAt: new Date() },
  });
  if (locked.count === 0) return conflict("State changed; please retry.");

  await prisma.auditLog.create({
    data: {
      actor: ctx.actor,
      action: "CANCELLED",
      entityType: "ad_approval",
      entityId: id,
      before: { status: approval.status },
      after: { status: STATUS.CANCELLED },
      meta: { reason: parsed.data.reason },
    },
  });
  return NextResponse.json({ ok: true, status: STATUS.CANCELLED });
}
