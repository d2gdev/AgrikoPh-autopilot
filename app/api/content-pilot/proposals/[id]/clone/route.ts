export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const source = await prisma.contentProposal.findUnique({ where: { id } });
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const clone = await prisma.contentProposal.create({
    data: {
      articleHandle: source.articleHandle,
      proposalType: source.proposalType,
      changeType: source.changeType,
      priority: source.priority,
      impact: source.impact,
      effort: source.effort,
      title: `${source.title} (copy)`,
      description: source.description,
      proposedState: source.proposedState as object,
      sourceData: source.sourceData as object,
      // Reset to pending — no draft content, no status carry-over
    },
  });

  return NextResponse.json({ proposal: clone });
}
