export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  // status is a free-form String column, but only a known set of values is ever
  // written. Reject anything else so an arbitrary query param can't be passed
  // straight into the Prisma where clause.
  const VALID_STATUSES = ["pending", "approved", "rejected", "published"];
  if (status !== null && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  try {
    // Recover drafts stuck in "generating" — if a generation crashed, timed out,
    // or the server restarted mid-run, the row would otherwise stay "generating"
    // forever and the UI would never let the operator retry. The generate-draft
    // route has maxDuration=300s (5 min), so anything still generating after
    // 6 minutes is guaranteed dead and safe to mark failed.
    const STALE_MS = 6 * 60 * 1000;
    await prisma.contentProposal.updateMany({
      where: { draftStatus: "generating", updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
      data: { draftStatus: "failed" },
    });

    // Omit draftContent (full article HTML) from the list — it's only needed on
    // the draft detail page, and shipping it for every row bloats the payload.
    const proposals = await prisma.contentProposal.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      take: 200,
      select: {
        id: true,
        createdAt: true,
        articleHandle: true,
        proposalType: true,
        changeType: true,
        priority: true,
        impact: true,
        effort: true,
        title: true,
        description: true,
        proposedState: true,
        status: true,
        reviewedBy: true,
        reviewedAt: true,
        reviewNote: true,
        draftStatus: true,
        draftError: true,
        draftGeneratedAt: true,
        scheduledPublishAt: true,
        publishedHandle: true,
        shopifyArticleId: true,
        baselineSeoScore: true,
        followUpSeoScore: true,
        followUpScoredAt: true,
        // sourceData omitted — not rendered in list view
      },
    });
    return NextResponse.json({ proposals, total: proposals.length });
  } catch (err) {
    console.error("[content-pilot/proposals] list error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
