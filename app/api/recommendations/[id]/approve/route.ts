export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizePermission, PERMISSIONS, requireAppAuth } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const auth = await authorizePermission(req, PERMISSIONS.RECOMMENDATIONS_REVIEW);
  const { id } = await params;
  if (!auth.allowed) {
    await prisma.auditLog.create({
      data: {
        actor: auth.actor ?? "anonymous",
        action: "permission_denied",
        entityType: "recommendation",
        entityId: id,
        after: {
          route: `/api/recommendations/${id}/approve`,
          permission: PERMISSIONS.RECOMMENDATIONS_REVIEW,
          reason: auth.actor ? "missing_permission" : "unauthenticated",
        },
      },
    }).catch((err) => console.error("[approve] denied audit failed:", err));
    return auth.response;
  }
  const approvedBy = auth.actor;

  const { note } = await req.json().catch(() => ({}));

  try {
    // Read before-state for audit log
    const rec = await prisma.recommendation.findUnique({ where: { id } });
    if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // M-5: Atomic transition — guard check is inside the WHERE clause to eliminate TOCTOU gap.
    // Only succeeds if status is still "pending" AND guardStatus is not "hard_block".
    const locked = await prisma.recommendation.updateMany({
      where: { id, status: "pending", guardStatus: { not: "hard_block" } },
      data: { status: "approved", reviewedAt: new Date(), reviewNote: note ?? null, reviewedBy: approvedBy },
    });

    if (locked.count === 0) {
      return NextResponse.json(
        { error: rec.guardStatus === "hard_block"
            ? "Hard-blocked recommendations require an override — use Override Hard Block in the Recommendations tab"
            : `Cannot approve a recommendation with status "${rec.status}" — it may have already been reviewed` },
        { status: 409 }
      );
    }

    await prisma.auditLog.create({
      data: {
        actor: approvedBy,
        action: "recommendation_approved",
        entityType: "recommendation",
        entityId: id,
        before: { status: rec.status },
        after: { status: "approved" },
      },
    });

    return NextResponse.json({
      recommendation: {
        ...rec,
        status: "approved",
        reviewedAt: new Date().toISOString(),
        reviewNote: note ?? null,
        reviewedBy: approvedBy,
      },
    });
  } catch (err) {
    console.error("[approve] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
