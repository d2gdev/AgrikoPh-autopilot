import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const { id } = await context.params;
  const result = await prisma.marketInsight.updateMany({
    where: { id, status: "open" },
    data: { status: "resolved", resolvedAt: new Date() },
  });
  if (result.count === 0) return NextResponse.json({ error: "Open insight not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
