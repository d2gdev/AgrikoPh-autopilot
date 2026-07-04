export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { STATUS } from "@/lib/ad-approval/constants";
import { buildApprovalTimeline } from "@/lib/ad-approval/timeline";
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

  const auditRows = await prisma.auditLog.findMany({
    where: { entityType: "ad_approval", entityId: id },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  const userIds = [
    approval.submitterId,
    approval.assignedConversionReviewerId,
    approval.assignedPenultimateApproverId,
    approval.assignedFinalApproverId,
    ...auditRows.map((r) => r.actor),
  ].filter((v): v is string => !!v && v !== "system");
  const uniqueUserIds = [...new Set(userIds)];

  const users = uniqueUserIds.length
    ? await prisma.appUser.findMany({
        where: { shopifyUserId: { in: uniqueUserIds } },
        select: { shopifyUserId: true, displayName: true, email: true },
      })
    : [];
  const names: Record<string, string> = {};
  for (const u of users) {
    names[u.shopifyUserId] = u.displayName ?? u.email ?? u.shopifyUserId;
  }

  const submitterLabel = names[approval.submitterId] ?? approval.submitterId;
  const timeline = buildApprovalTimeline({
    revisions: approval.revisions.map((r) => ({ ...r, submitterLabel })),
    reviews: approval.reviews,
    auditRows,
    names,
  });

  return NextResponse.json({ approval, actor: ctx.actor, isAdmin: admin, names, timeline });
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
  // Bumping version makes any in-flight submit's CAS fail cleanly instead of
  // freezing a revision from the pre-edit copy.
  const updated = await prisma.adApproval.updateMany({
    where: { id, status: STATUS.DRAFT },
    data: {
      ...(parsed.data.copy ? { draftCopy: parsed.data.copy as object } : {}),
      ...(parsed.data.creative ? { draftCreative: parsed.data.creative as object } : {}),
      version: { increment: 1 },
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
