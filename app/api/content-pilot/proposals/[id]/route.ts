export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDraftSchema } from "@/lib/content-pilot/generate-draft";
import { canEditContentProposal } from "@/lib/content-pilot/proposal-state";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const { id } = await params;

  try {
    const proposal = await prisma.contentProposal.findUnique({
      where: { id },
    });
    if (!proposal) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ proposal });
  } catch (err) {
    console.error("[content-pilot/proposals/get] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH — save manual edits to a generated draft. Only allowed while the draft
// is "ready" (not generating, publishing, or already published). The edited
// content is validated against the same schema the AI generator must satisfy.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;
  const { id } = await params;
  const actor = (await getSessionUser(req)) ?? "operator";

  try {
    const proposal = await prisma.contentProposal.findUnique({ where: { id } });
    if (!proposal) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canEditContentProposal(proposal)) {
      return NextResponse.json(
        { error: `Cannot edit — draft status is "${proposal.draftStatus ?? "none"}"` },
        { status: 409 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const schema = getDraftSchema(proposal.proposalType);
    const parsed = schema.safeParse(body?.draftContent);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid draft content", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Optimistic guard: repeat the publishable-status plus ready-draft predicate
    // from canEditContentProposal() so a concurrent rejection, approval revocation,
    // or publish transition cannot silently overwrite the draft. P2025 → 409 below.
    const updated = await prisma.contentProposal.update({
      where: {
        id,
        status: { in: ["approved", "override_approved"] },
        draftStatus: "ready",
      },
      data: { draftContent: parsed.data },
    });

    await prisma.auditLog.create({
      data: {
        entityType: "ContentProposal",
        entityId: id,
        action: "draft_edited",
        actor,
        before: { draftContent: proposal.draftContent ?? undefined },
        after: { draftContent: parsed.data },
      },
    });

    await prisma.contentProposalDraftHistory.create({
      data: {
        proposalId: id,
        savedBy: actor,
        draftContent: parsed.data as object,
        reason: "edited",
      },
    });

    return NextResponse.json({ proposal: updated });
  } catch (err) {
    // P2025: the optimistic-locked update matched no row — the draft is no
    // longer "ready" (e.g. a concurrent publish flipped it). Report a conflict.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2025") {
      return NextResponse.json(
        { error: "Draft is no longer editable" },
        { status: 409 }
      );
    }
    console.error("[content-pilot/proposals/patch] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
