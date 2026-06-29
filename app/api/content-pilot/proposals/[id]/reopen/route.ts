export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { requireAppAuth, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { markContentProposalOpportunityRouted } from "@/lib/opportunities/content-proposal-outcomes";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const { id } = await params;
  const actor = (await getSessionUser(req)) ?? "operator";
  const proposal = await prisma.contentProposal.findUnique({ where: { id } });
  if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (proposal.status !== "rejected") return NextResponse.json({ error: "Only rejected proposals can be re-opened" }, { status: 400 });

  // Optimistic lock: re-assert status === "rejected" in the WHERE so a concurrent
  // change between read and write surfaces as a conflict (P2025 → 409), mirroring
  // approve/reject.
  let updated;
  try {
    updated = await prisma.contentProposal.update({
      where: { id, status: "rejected" },
      data: { status: "pending", reviewedBy: null, reviewedAt: null, reviewNote: null },
    });
    await markContentProposalOpportunityRouted(prisma, {
      proposalId: id,
      sourceData: proposal.sourceData,
    });
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2025") {
      return NextResponse.json(
        { error: "Proposal was modified by another request — please refresh" },
        { status: 409 }
      );
    }
    throw err;
  }

  // Best-effort audit log, mirroring approve/reject routes. Never fail the
  // reopen if the audit write errors.
  try {
    await prisma.auditLog.create({
      data: {
        entityType: "ContentProposal",
        entityId: id,
        action: "proposal_reopened",
        actor,
        before: { status: "rejected" },
        after: { status: "pending" },
      },
    });
  } catch (err) {
    console.error("[content-pilot/proposals/reopen] audit log failed:", err);
  }

  return NextResponse.json({ proposal: updated });
}
