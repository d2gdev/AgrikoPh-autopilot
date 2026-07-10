export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextResponse } from "next/server";
import { ContentProposalConflictError } from "@/lib/content-pilot/proposal-transitions";
import { getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { rejectProposal } from "@/lib/content-pilot/proposal-transitions";

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
    const { proposal } = await prisma.$transaction((tx) =>
      rejectProposal(tx, {
        id,
        reviewedBy,
        reviewNote: reviewNote ?? null,
      }),
    );

    return NextResponse.json({ proposal });
  } catch (err) {
    if (err instanceof ContentProposalConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (typeof err === "object" && err !== null && (err as Error).message.startsWith("Cannot reject")) {
      return NextResponse.json({ error: (err as Error).message }, { status: 409 });
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
    console.error("[content-pilot/proposals/reject] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
