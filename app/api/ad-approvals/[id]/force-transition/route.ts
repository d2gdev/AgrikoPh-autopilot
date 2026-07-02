export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorizePermission, PERMISSIONS } from "@/lib/auth";
import { STATUS } from "@/lib/ad-approval/constants";
import { loadApproval, auditDenied, notFound, conflict, badRequest } from "@/lib/ad-approval/route-helpers";

const ALLOWED_STATUSES = new Set<string>(Object.values(STATUS));

const schema = z.object({
  to: z.string().refine((s) => ALLOWED_STATUSES.has(s), "Unknown target status"),
  reason: z.string().min(1).max(2000),
});

// POST /api/ad-approvals/[id]/force-transition — admin override. Bypasses the
// normal transition table (that's the point of a force), but still requires a
// justification and writes a FORCE_TRANSITION audit row. Version-guarded.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizePermission(req, PERMISSIONS.AD_APPROVAL_ADMIN);
  const { id } = await params;
  if (!auth.allowed) {
    await auditDenied(auth.actor ?? "anonymous", "force_transition", id, "missing_admin_permission");
    return auth.response;
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest("Invalid input", parsed.error.flatten());

  const approval = await loadApproval(id);
  if (!approval) return notFound();

  const locked = await prisma.adApproval.updateMany({
    where: { id, version: approval.version },
    data: { status: parsed.data.to, version: approval.version + 1, updatedAt: new Date() },
  });
  if (locked.count === 0) return conflict("State changed; please retry.");

  await prisma.auditLog.create({
    data: {
      actor: auth.actor,
      action: "FORCE_TRANSITION",
      entityType: "ad_approval",
      entityId: id,
      before: { status: approval.status },
      after: { status: parsed.data.to },
      meta: { reason: parsed.data.reason },
    },
  });
  return NextResponse.json({ ok: true, status: parsed.data.to });
}
