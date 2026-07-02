export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { STATUS } from "@/lib/ad-approval/constants";
import {
  resolveActor,
  isAdmin,
  loadApproval,
  auditDenied,
  forbidden,
  notFound,
  conflict,
  badRequest,
} from "@/lib/ad-approval/route-helpers";

function canView(actor: string, approval: { submitterId: string; assignedConversionReviewerId: string | null; assignedPenultimateApproverId: string | null; assignedFinalApproverId: string | null }): boolean {
  return (
    approval.submitterId === actor ||
    approval.assignedConversionReviewerId === actor ||
    approval.assignedPenultimateApproverId === actor ||
    approval.assignedFinalApproverId === actor
  );
}

// GET /api/ad-approvals/[id] — full detail (revisions + reviews + AI reports).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveActor(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const approval = await prisma.adApproval.findUnique({
    where: { id },
    include: {
      revisions: { orderBy: { revisionNumber: "desc" } },
      reviews: { orderBy: { completedAt: "desc" } },
      aiReports: { orderBy: { generatedAt: "desc" } },
    },
  });
  if (!approval) return notFound();

  const admin = await isAdmin(req);
  if (!canView(ctx.actor, approval) && !admin) {
    await auditDenied(ctx.actor, "view", id, "not_owner_or_assigned");
    return forbidden();
  }
  return NextResponse.json({ approval, actor: ctx.actor, isAdmin: admin });
}

const patchSchema = z.object({
  copy: z.record(z.unknown()).optional(),
  creative: z.record(z.unknown()).optional(),
});

// PATCH /api/ad-approvals/[id] — edit the working draft (only while status=draft).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveActor(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const approval = await loadApproval(id);
  if (!approval) return notFound();
  if (approval.submitterId !== ctx.actor && !(await isAdmin(req))) {
    await auditDenied(ctx.actor, "edit_draft", id, "not_owner");
    return forbidden();
  }
  if (approval.status !== STATUS.DRAFT) {
    return conflict(`Cannot edit ad in active review stage. Current status: ${approval.status}.`);
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest("Invalid input", parsed.error.flatten());

  // Guarded update — status must still be draft (closes the TOCTOU gap).
  const updated = await prisma.adApproval.updateMany({
    where: { id, status: STATUS.DRAFT },
    data: {
      ...(parsed.data.copy ? { draftCopy: parsed.data.copy as object } : {}),
      ...(parsed.data.creative ? { draftCreative: parsed.data.creative as object } : {}),
      updatedAt: new Date(),
    },
  });
  if (updated.count === 0) return conflict("Ad is no longer editable (status changed).");

  await prisma.auditLog.create({
    data: { actor: ctx.actor, action: "DRAFT_EDITED", entityType: "ad_approval", entityId: id },
  });
  return NextResponse.json({ ok: true });
}

// DELETE /api/ad-approvals/[id] — delete a draft only (owner or admin).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveActor(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const approval = await loadApproval(id);
  if (!approval) return notFound();
  const admin = await isAdmin(req);
  if (approval.submitterId !== ctx.actor && !admin) {
    await auditDenied(ctx.actor, "delete", id, "not_owner_or_admin");
    return forbidden();
  }
  if (approval.status !== STATUS.DRAFT) {
    return conflict("Only draft ads can be deleted.");
  }

  const deleted = await prisma.adApproval.deleteMany({ where: { id, status: STATUS.DRAFT } });
  if (deleted.count === 0) return conflict("Ad is no longer a draft.");

  await prisma.auditLog.create({
    data: { actor: ctx.actor, action: "DRAFT_DELETED", entityType: "ad_approval", entityId: id },
  });
  return NextResponse.json({ ok: true });
}
