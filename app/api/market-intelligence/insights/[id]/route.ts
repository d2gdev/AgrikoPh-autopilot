import { NextResponse } from "next/server";
import { getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;
  const body = await req.json().catch(() => null) as { reason?: unknown } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!reason) return NextResponse.json({ error: "A resolution reason is required" }, { status: 400 });

  const { id } = await context.params;
  const actor = (await getSessionUser(req)) ?? "operator";
  const resolved = await prisma.$transaction(async (tx) => {
    const result = await tx.marketInsight.updateMany({
      where: { id, status: "open" },
      data: { status: "resolved", resolvedAt: new Date() },
    });
    if (result.count === 0) return false;
    await tx.auditLog.create({
      data: {
        actor,
        action: "market_insight_resolved",
        entityType: "MarketInsight",
        entityId: id,
        before: { status: "open" },
        after: { status: "resolved" },
        meta: { reason },
      },
    });
    return true;
  });
  if (!resolved) return NextResponse.json({ error: "Open insight not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
