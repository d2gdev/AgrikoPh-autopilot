export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CONTENT_PROPOSAL_ACTIVE_STATUSES } from "@/lib/content-pilot/proposal-dedupe";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const rawLimit = Number(searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : 100;
  const cursorParam = searchParams.get("cursor");
  let cursor: { priority: string; createdAt: string; id: string } | undefined;
  if (cursorParam) {
    try {
      const parsed = JSON.parse(Buffer.from(cursorParam, "base64url").toString("utf8"));
      if (!parsed?.createdAt || !parsed?.id) throw new Error("invalid");
      cursor = { priority: String(parsed.priority), createdAt: String(parsed.createdAt), id: String(parsed.id) };
    } catch {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
  }

  // status is a free-form String column, but only a known set of values is ever
  // written. Reject anything else so an arbitrary query param can't be passed
  // straight into the Prisma where clause.
  const VALID_STATUSES = [...CONTENT_PROPOSAL_ACTIVE_STATUSES, "rejected"];
  if (status !== null && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  try {
    // Omit draftContent (full article HTML) from the list — it's only needed on
    // the draft detail page, and shipping it for every row bloats the payload.
    const baseWhere: any = status ? { status } : {};
    // The ordering and tie-breaker are deliberately stable across pages.
    if (cursor) baseWhere.OR = [{ priority: { gt: cursor.priority } }, { priority: cursor.priority, createdAt: { lt: new Date(cursor.createdAt) } }, { priority: cursor.priority, createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }];
    const proposals = await prisma.contentProposal.findMany({
      where: baseWhere,
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
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
        sourceData: true,
      },
    });
    const hasMore = proposals.length > limit;
    const page = hasMore ? proposals.slice(0, limit) : proposals;
    const last = page[page.length - 1] as any;
    const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ priority: last.priority, createdAt: last.createdAt, id: last.id })).toString("base64url") : null;
    const countFn = (prisma.contentProposal as any).count;
    const total = typeof countFn === "function" ? await countFn({ where: status ? { status } : undefined }) : page.length;
    return NextResponse.json({ proposals: page, total, hasMore, nextCursor });
  } catch (err) {
    console.error("[content-pilot/proposals] list error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
