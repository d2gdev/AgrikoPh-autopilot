export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { ContentProposalConflictError } from "@/lib/content-pilot/proposal-transitions";
import { getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { reopenProposal } from "@/lib/content-pilot/proposal-transitions";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;
  const { id } = await params;
  const actor = (await getSessionUser(req)) ?? "operator";

  try {
    const { proposal: updated } = await prisma.$transaction((tx) =>
      reopenProposal(tx, {
        id,
        actor,
      }),
    );

    return NextResponse.json({ proposal: updated });
  } catch (err) {
    if (err instanceof ContentProposalConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (typeof err === "object" && err !== null && (err as Error).message.startsWith("Cannot reopen")) {
      return NextResponse.json({ error: "Only rejected proposals can be re-opened" }, { status: 400 });
    }
    if (typeof err === "object" && err !== null && (err as Error).message.startsWith("Proposal not found:")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2025") {
      return NextResponse.json(
        { error: "Proposal was modified by another request — please refresh" },
        { status: 409 }
      );
    }
    console.error("[content-pilot/proposals/reopen] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
