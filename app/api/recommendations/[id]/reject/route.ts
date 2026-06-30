export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizePermission, PERMISSIONS } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
          route: `/api/recommendations/${id}/reject`,
          permission: PERMISSIONS.RECOMMENDATIONS_REVIEW,
          reason: auth.actor ? "missing_permission" : "unauthenticated",
        },
      },
    }).catch((err) => console.error("[reject] denied audit failed:", err));
    return auth.response;
  }
  const rejectedBy = auth.actor;

  const { note } = await req.json().catch(() => ({}));

  try {
    const rec = await prisma.recommendation.findUnique({ where: { id } });
    if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Atomic transition — only succeeds if not already reviewed
    const locked = await prisma.recommendation.updateMany({
      where: { id, status: "pending" },
      data: { status: "rejected", reviewedAt: new Date(), reviewNote: note ?? null, reviewedBy: rejectedBy },
    });

    if (locked.count === 0) {
      return NextResponse.json(
        { error: `Cannot reject a recommendation with status "${rec.status}" — it may have already been reviewed` },
        { status: 409 }
      );
    }

    await prisma.auditLog.create({
      data: {
        actor: rejectedBy,
        action: "recommendation_rejected",
        entityType: "recommendation",
        entityId: id,
        before: { status: rec.status },
        after: { status: "rejected" },
      },
    });

    return NextResponse.json({
      recommendation: {
        ...rec,
        status: "rejected",
        reviewedAt: new Date().toISOString(),
        reviewNote: note ?? null,
        reviewedBy: rejectedBy,
      },
    });
  } catch (err) {
    console.error("[reject] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
