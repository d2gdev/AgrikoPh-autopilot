export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizePermission, PERMISSIONS } from "@/lib/auth";

// Single-step override: hard-blocked recommendation goes directly to override_approved.
// Requires written justification. No second reviewer needed for single-operator setup.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizePermission(req, PERMISSIONS.RECOMMENDATIONS_OVERRIDE);
  const { id } = await params;
  if (!auth.allowed) {
    await prisma.auditLog.create({
      data: {
        actor: auth.actor ?? "anonymous",
        action: "permission_denied",
        entityType: "recommendation",
        entityId: id,
        after: {
          route: `/api/recommendations/${id}/request-override`,
          permission: PERMISSIONS.RECOMMENDATIONS_OVERRIDE,
          reason: auth.actor ? "missing_permission" : "unauthenticated",
        },
      },
    }).catch((err) => console.error("[request-override] denied audit failed:", err));
    return auth.response;
  }
  const actor = auth.actor;

  const { justification } = await req.json().catch(() => ({}));

  if (!justification || String(justification).trim().length < 10) {
    return NextResponse.json(
      { error: "Override requires a written justification (minimum 10 characters)" },
      { status: 400 }
    );
  }
  if (String(justification).trim().length > 5000) {
    return NextResponse.json({ error: "Justification must be under 5000 characters" }, { status: 400 });
  }

  const rec = await prisma.recommendation.findUnique({ where: { id } });
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (rec.guardStatus !== "hard_block") {
    return NextResponse.json(
      { error: "Only hard-blocked recommendations can be overridden" },
      { status: 400 }
    );
  }

  // Atomic transition — only succeeds if status is still "pending" and guardStatus is "hard_block"
  const locked = await prisma.recommendation.updateMany({
    where: { id, status: "pending", guardStatus: "hard_block" },
    data: {
      status: "override_approved",
      overrideJustification: String(justification).trim(),
      overrideApprovedBy: actor,
      reviewedAt: new Date(),
    },
  });

  if (locked.count === 0) {
    return NextResponse.json(
      { error: `Cannot override a recommendation with status "${rec.status}" — it may have already been reviewed` },
      { status: 409 }
    );
  }

  const updated = await prisma.recommendation.findUnique({ where: { id } });

  await prisma.auditLog.create({
    data: {
      actor,
      action: "hard_block_override_approved",
      entityType: "recommendation",
      entityId: id,
      before: { status: rec.status, guardStatus: rec.guardStatus },
      after: { status: "override_approved", justification: String(justification).trim() },
    },
  });

  return NextResponse.json({ recommendation: updated });
}
