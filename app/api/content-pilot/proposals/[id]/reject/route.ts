export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextResponse } from "next/server";
import { getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { markContentProposalOpportunityDismissed } from "@/lib/opportunities/content-proposal-outcomes";
import { canRejectContentProposal, CONTENT_PROPOSAL_NON_REJECTABLE_DRAFT_STATUSES } from "@/lib/content-pilot/proposal-state";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;
  const { id } = await params;

  const { reviewNote } = (await req.json().catch(() => ({}))) as { reviewNote?: string };
  const reviewedBy = (await getSessionUser(req)) ?? "operator";

  try {
    const proposal = await prisma.contentProposal.findUnique({ where: { id } });
    if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canRejectContentProposal(proposal)) {
      return NextResponse.json(
        { error: `Cannot reject a proposal with status "${proposal.status}" and draft status "${proposal.draftStatus ?? "none"}"` },
        { status: 409 }
      );
    }

    const updatedCount = await prisma.contentProposal.updateMany({
      where: {
        id,
        status: { not: "rejected" },
        OR: [
          { draftStatus: null },
          { draftStatus: { notIn: [...CONTENT_PROPOSAL_NON_REJECTABLE_DRAFT_STATUSES] } },
        ],
      },
      data: {
        status: "rejected",
        draftStatus: "rejected",
        scheduledPublishAt: null,
        reviewedBy,
        reviewedAt: new Date(),
        reviewNote: reviewNote ?? null,
      },
    });
    if (updatedCount.count === 0) {
      return NextResponse.json(
        { error: "Proposal was modified by another request — please refresh" },
        { status: 409 }
      );
    }

    const updated = await prisma.contentProposal.findUnique({ where: { id } });
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
        before: { status: proposal.status, draftStatus: proposal.draftStatus },
        after: {
          status: "rejected",
          draftStatus: "rejected",
          scheduledPublishAt: null,
          reviewNote: reviewNote ?? null,
        },
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
