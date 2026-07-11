/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CONTENT_PROPOSAL_ACTIVE_STATUSES } from "@/lib/content-pilot/proposal-dedupe";
import { decodeQueueCursor, parseQueueQuery } from "@/lib/content-pilot/queue-query";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  let query;
  try {
    query = parseQueueQuery(req.url);
  } catch {
    return NextResponse.json({ error: "Invalid queue query" }, { status: 400 });
  }
  const { status, limit, cursor: cursorParam } = query;
  let cursor: { priority: string; createdAt: string; id: string } | undefined;
  if (cursorParam) {
    try {
      cursor = decodeQueueCursor(cursorParam);
    } catch {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
  }

  // status is a free-form String column, but only a known set of values is ever
  // written. Reject anything else so an arbitrary query param can't be passed
  // straight into the Prisma where clause.
  const VALID_STATUSES = [...CONTENT_PROPOSAL_ACTIVE_STATUSES, "rejected"];
  if (status != null && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  try {
    // Omit draftContent (full article HTML) from the list — it's only needed on
    // the draft detail page, and shipping it for every row bloats the payload.
    const baseWhere: any = {
      ...(status ? { status } : {}),
      ...(query.type ? { proposalType: query.type } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.q ? { OR: [{ title: { contains: query.q, mode: "insensitive" } }, { description: { contains: query.q, mode: "insensitive" } }] } : {}),
    };
    if (query.stage) {
      const publishable = { in: ["approved", "override_approved"] };
      Object.assign(baseWhere,
        query.stage === "rejected" ? { status: "rejected" } :
        query.stage === "pending" ? { status: "pending" } :
        query.stage === "approved" ? { status: publishable, draftStatus: null } :
        query.stage === "scheduled" ? { status: publishable, draftStatus: "ready", scheduledPublishAt: { not: null } } :
        query.stage === "ready" ? { status: publishable, draftStatus: "ready", scheduledPublishAt: null } :
        { status: publishable, draftStatus: query.stage },
      );
    }
    const filteredWhere = { ...baseWhere };
    // The ordering and tie-breaker are deliberately stable across pages.
    if (cursor) {
      const cursorWhere = [{ priority: { gt: cursor.priority } }, { priority: cursor.priority, createdAt: { lt: new Date(cursor.createdAt) } }, { priority: cursor.priority, createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }];
      baseWhere.AND = [...(baseWhere.OR ? [{ OR: baseWhere.OR }] : []), { OR: cursorWhere }];
      delete baseWhere.OR;
    }
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
        publishWarning: true,
        publishOperationId: true,
        publishFinalizedAt: true,
        sourceData: true,
      },
    });
    const hasMore = proposals.length > limit;
    const page = hasMore ? proposals.slice(0, limit) : proposals;
    const last = page[page.length - 1] as any;
    const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ priority: last.priority, createdAt: last.createdAt, id: last.id })).toString("base64url") : null;
    const countFn = (prisma.contentProposal as any).count;
    const total = typeof countFn === "function" ? await countFn({ where: filteredWhere }) : page.length;
    const groupBy = (prisma.contentProposal as any).groupBy;
    const grouped = typeof groupBy === "function" ? await groupBy({ by: ["status", "draftStatus", "scheduledPublishAt"], _count: { _all: true } }) : [];
    const stageCounts = grouped.reduce((counts: Record<string, number>, row: any) => {
      const stage = row.status === "rejected" ? "rejected" : row.status === "pending" ? "pending" : row.draftStatus === "ready" && row.scheduledPublishAt ? "scheduled" : row.draftStatus ?? "approved";
      counts[stage] = (counts[stage] ?? 0) + row._count._all;
      return counts;
    }, {});
    return NextResponse.json({ proposals: page, total, stageCounts, pageInfo: { hasNextPage: hasMore, nextCursor }, filters: query, hasMore, nextCursor });
  } catch (err) {
    console.error("[content-pilot/proposals] list error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
