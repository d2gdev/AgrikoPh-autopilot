export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { ContentProposalConflictError } from "@/lib/content-pilot/proposal-transitions";
import { getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDraftSchema } from "@/lib/content-pilot/generate-draft";
import { editProposalDraft } from "@/lib/content-pilot/proposal-transitions";

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

    const body = await req.json().catch(() => ({}));
    const schema = getDraftSchema(proposal.proposalType);
    const parsed = schema.safeParse(body?.draftContent);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid draft content", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { proposal: updated } = await prisma.$transaction((tx) =>
      editProposalDraft(tx, {
        id,
        actor,
        draftContent: parsed.data,
      }),
    );

    return NextResponse.json({ proposal: updated });
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2025") {
      return NextResponse.json({ error: "Draft is no longer editable" }, { status: 409 });
    }
    const message = typeof err === "object" && err !== null ? (err as Error).message : "";
    if (err instanceof ContentProposalConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (message.startsWith("Proposal not found:")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (message.startsWith("Cannot edit")) {
      return NextResponse.json({ error: (err as Error).message }, { status: 409 });
    }
    console.error("[content-pilot/proposals/patch] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
