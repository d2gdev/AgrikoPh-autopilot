export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextResponse } from "next/server";
import { requireAppAuth, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { markContentProposalOpportunityDismissed } from "@/lib/opportunities/content-proposal-outcomes";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const { id } = await params;

  const { reviewNote } = (await req.json().catch(() => ({}))) as { reviewNote?: string };
  const reviewedBy = (await getSessionUser(req)) ?? "operator";

  try {
    const proposal = await prisma.contentProposal.findUnique({ where: { id } });
    if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (proposal.status !== "pending") {
      return NextResponse.json(
        { error: `Cannot reject a proposal with status "${proposal.status}"` },
        { status: 409 }
      );
    }

    const updated = await prisma.contentProposal.update({
      where: { id, status: "pending" },
      data: { status: "rejected", reviewedBy, reviewedAt: new Date(), reviewNote: reviewNote ?? null },
    });

    await markContentProposalOpportunityDismissed(prisma, {
      proposalId: id,
      sourceData: proposal.sourceData,
    });

    await prisma.auditLog.create({
      data: {
        entityType: "ContentProposal",
        entityId: id,
        action: "rejected",
        actor: reviewedBy,
        before: { status: "pending" },
        after: { status: "rejected", reviewNote: reviewNote ?? null },
      },
    });

    // Standardized shape: all single-proposal routes return { proposal }.
    return NextResponse.json({ proposal: updated });
  } catch (err) {
    // P2025: the optimistic-locked update found no matching row — another request
    // changed the status between our read and write. Report it as a conflict.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2025") {
      return NextResponse.json(
        { error: "Proposal was modified by another request — please refresh" },
        { status: 409 }
      );
    }
    console.error("[content-pilot/proposals/reject] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
