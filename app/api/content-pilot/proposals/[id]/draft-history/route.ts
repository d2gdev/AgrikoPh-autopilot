export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const { id } = await params;

  try {
    const history = await prisma.contentProposalDraftHistory.findMany({
      where: { proposalId: id },
      orderBy: { savedAt: "desc" },
      take: 20,
    });
    return NextResponse.json({ history });
  } catch (err) {
    console.error("[content-pilot/proposals/draft-history] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
