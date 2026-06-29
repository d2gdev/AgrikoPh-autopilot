export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSessionUser, PERMISSIONS, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requirePermission(req, PERMISSIONS.CONTENT_PUBLISH);
  if (authError) return authError;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  // scheduledPublishAt: a date string (datetime-local "YYYY-MM-DDTHH:MM" or ISO),
  // or null to clear the schedule. Validate before hitting the DB.
  const raw: unknown = body.scheduledPublishAt ?? null;
  let scheduledDate: Date | null = null;
  if (raw !== null) {
    if (typeof raw !== "string") {
      return NextResponse.json({ error: "scheduledPublishAt must be a date string or null" }, { status: 400 });
    }
    const parsed = new Date(raw);
    if (isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "scheduledPublishAt is not a valid date" }, { status: 400 });
    }
    if (parsed.getTime() < Date.now()) {
      return NextResponse.json({ error: "scheduledPublishAt must be in the future" }, { status: 400 });
    }
    scheduledDate = parsed;
  }

  const reviewedBy = (await getSessionUser(req)) ?? "operator";

  try {
    const proposal = await prisma.contentProposal.findUnique({ where: { id } });
    if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (proposal.draftStatus !== "ready") {
      return NextResponse.json(
        { error: `Cannot schedule — draft status is "${proposal.draftStatus ?? "none"}"` },
        { status: 409 }
      );
    }

    // Optimistic lock on draftStatus: if another request changed the draft state
    // between our read and write, the update matches no row (P2025 → 409).
    const updated = await prisma.contentProposal.update({
      where: { id, draftStatus: "ready" },
      data: { scheduledPublishAt: scheduledDate },
    });

    await prisma.auditLog.create({
      data: {
        entityType: "ContentProposal",
        entityId: id,
        action: "scheduled",
        actor: reviewedBy,
        before: { scheduledPublishAt: proposal.scheduledPublishAt?.toISOString() ?? null },
        after: { scheduledPublishAt: scheduledDate?.toISOString() ?? null },
      },
    });

    return NextResponse.json({ proposal: updated });
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2025") {
      return NextResponse.json(
        { error: "Proposal was modified by another request — please refresh" },
        { status: 409 }
      );
    }
    console.error("[content-pilot/proposals/schedule] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
