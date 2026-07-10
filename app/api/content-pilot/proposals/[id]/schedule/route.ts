export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { ContentProposalConflictError } from "@/lib/content-pilot/proposal-transitions";
import { getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { scheduleProposal } from "@/lib/content-pilot/proposal-transitions";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
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

  const actor = (await getSessionUser(req)) ?? "operator";

  try {
    const { proposal } = await prisma.$transaction((tx) =>
      scheduleProposal(tx, {
        id,
        actor,
        scheduledPublishAt: scheduledDate,
      }),
    );

    return NextResponse.json({ proposal });
  } catch (err) {
    if (err instanceof ContentProposalConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (typeof err === "object" && err !== null && (err as Error).message.startsWith("Proposal not found:")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (typeof err === "object" && err !== null && (err as Error).message.startsWith("Cannot schedule")) {
      return NextResponse.json({ error: (err as Error).message }, { status: 409 });
    }
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
