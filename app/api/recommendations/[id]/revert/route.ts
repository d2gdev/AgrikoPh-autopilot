export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizePermission, PERMISSIONS } from "@/lib/auth";

// Undo a review decision: approved/rejected → pending.
// Safe against the execute-approved cron because the executor claims recommendations
// atomically (status must still be approved/override_approved at claim time) — this
// revert either wins before the claim or fails with a 409.
// override_approved is deliberately excluded: it carries a written justification trail
// and should be re-reviewed rather than silently reverted.
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
          route: `/api/recommendations/${id}/revert`,
          permission: PERMISSIONS.RECOMMENDATIONS_REVIEW,
          reason: auth.actor ? "missing_permission" : "unauthenticated",
        },
      },
    }).catch((err) => console.error("[revert] denied audit failed:", err));
    return auth.response;
  }
  const actor = auth.actor;

  try {
    const rec = await prisma.recommendation.findUnique({ where: { id } });
    if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Atomic transition — only succeeds if the decision hasn't been executed/claimed yet
    const locked = await prisma.recommendation.updateMany({
      where: { id, status: { in: ["approved", "rejected"] } },
      data: {
        status: "pending",
        reviewedAt: null,
        reviewedBy: null,
        reviewNote: null,
      },
    });

    if (locked.count === 0) {
      return NextResponse.json(
        { error: rec.status === "executing" || rec.status === "executed"
            ? "Too late to undo — this recommendation has already been picked up for execution"
            : `Cannot undo a recommendation with status "${rec.status}"` },
        { status: 409 }
      );
    }

    await prisma.auditLog.create({
      data: {
        actor,
        action: "recommendation_review_reverted",
        entityType: "recommendation",
        entityId: id,
        before: { status: rec.status, reviewedBy: rec.reviewedBy, reviewNote: rec.reviewNote },
        after: { status: "pending" },
      },
    });

    return NextResponse.json({ recommendation: { ...rec, status: "pending", reviewedAt: null, reviewedBy: null, reviewNote: null } });
  } catch (err) {
    console.error("[revert] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
