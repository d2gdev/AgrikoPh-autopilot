/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CONTENT_PROPOSAL_ACTIVE_STATUSES } from "@/lib/content-pilot/proposal-dedupe";
import { decodeQueueCursor, encodeQueueCursor, parseQueueQuery } from "@/lib/content-pilot/queue-query";

function queueWhereSql(query: ReturnType<typeof parseQueueQuery>, status: string | undefined, priority: string | { in: string[] } | undefined): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (query.type) conditions.push(Prisma.sql`"proposalType" = ${query.type}`);
  if (typeof priority === "string") conditions.push(Prisma.sql`priority = ${priority}`);
  if (priority && typeof priority !== "string") conditions.push(Prisma.sql`priority IN (${Prisma.join(priority.in)})`);
  if (query.q) {
    const search = `%${query.q}%`;
    conditions.push(Prisma.sql`(title ILIKE ${search} OR description ILIKE ${search})`);
  }

  if (status) {
    conditions.push(Prisma.sql`status = ${status}`);
  } else if (query.stage) {
    if (query.stage === "rejected") conditions.push(Prisma.sql`status = 'rejected'`);
    else if (query.stage === "pending") conditions.push(Prisma.sql`status = 'pending'`);
    else {
      conditions.push(Prisma.sql`status IN ('approved', 'override_approved')`);
      if (query.stage === "approved") conditions.push(Prisma.sql`"draftStatus" IS NULL`);
      else if (query.stage === "scheduled") conditions.push(Prisma.sql`"draftStatus" = 'ready' AND "scheduledPublishAt" IS NOT NULL`);
      else if (query.stage === "ready") conditions.push(Prisma.sql`"draftStatus" = 'ready' AND "scheduledPublishAt" IS NULL`);
      else conditions.push(Prisma.sql`"draftStatus" = ${query.stage}`);
    }
  } else {
    conditions.push(Prisma.sql`status <> 'rejected'`);
  }

  return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
}

function queueOrderSql(sort: ReturnType<typeof parseQueueQuery>["sort"]): Prisma.Sql {
  if (sort === "priority") {
    return Prisma.sql`CASE lower(priority)
      WHEN 'p0' THEN 0 WHEN 'p1' THEN 1 WHEN 'p2' THEN 2 WHEN 'medium' THEN 2 WHEN 'p3' THEN 3 ELSE 4
    END ASC, "createdAt" DESC, id DESC`;
  }
  if (sort === "impact") {
    return Prisma.sql`CASE lower(impact)
      WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3
    END ASC, "createdAt" DESC, id DESC`;
  }
  return Prisma.sql`"createdAt" DESC, id DESC`;
}

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
    const priority = query.priority === "P2"
      ? { in: ["P2", "Medium", "medium"] }
      : query.priority;
    const filterWhere: any = {
      ...(query.type ? { proposalType: query.type } : {}),
      ...(priority ? { priority } : {}),
      ...(query.q ? { OR: [{ title: { contains: query.q, mode: "insensitive" } }, { description: { contains: query.q, mode: "insensitive" } }] } : {}),
    };
    const baseWhere: any = {
      ...filterWhere,
      ...(status ? { status } : query.stage ? {} : { status: { not: "rejected" } }),
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
    let cursor: ReturnType<typeof decodeQueueCursor> | null = null;
    try {
      cursor = cursorParam ? decodeQueueCursor(cursorParam) : null;
    } catch {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
    if (cursor && cursor.sort !== query.sort) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
    if (cursor) {
      const cursorExists = await prisma.contentProposal.count({
        where: { AND: [baseWhere, { id: cursor.id }] },
      });
      if (cursorExists === 0) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const whereSql = queueWhereSql(query, status, priority);
    const orderSql = queueOrderSql(query.sort);
    const orderedRows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH ordered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY ${orderSql}) AS row_number
        FROM "ContentProposal"
        ${whereSql}
      )
      SELECT id
      FROM ordered
      ${cursor ? Prisma.sql`WHERE row_number > (SELECT row_number FROM ordered WHERE id = ${cursor.id})` : Prisma.empty}
      ORDER BY row_number
      LIMIT ${limit + 1}
    `);
    const hasMore = orderedRows.length > limit;
    const pageIds = orderedRows.slice(0, limit).map((row) => row.id);
    const proposalRows = pageIds.length === 0 ? [] : await prisma.contentProposal.findMany({
      where: { id: { in: pageIds } },
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
    const proposalById = new Map(proposalRows.map((proposal) => [proposal.id, proposal]));
    const page = pageIds.flatMap((id) => {
      const proposal = proposalById.get(id);
      return proposal ? [proposal] : [];
    });
    const total = await prisma.contentProposal.count({ where: baseWhere });
    const groupBy = (prisma.contentProposal as any).groupBy;
    const grouped = typeof groupBy === "function" ? await groupBy({
      by: ["status", "draftStatus", "scheduledPublishAt"],
      where: filterWhere,
      _count: { _all: true },
    }) : [];
    const stageCounts = grouped.reduce((counts: Record<string, number>, row: any) => {
      const stage = row.status === "rejected" ? "rejected" : row.status === "pending" ? "pending" : row.draftStatus === "ready" && row.scheduledPublishAt ? "scheduled" : row.draftStatus ?? "approved";
      counts[stage] = (counts[stage] ?? 0) + row._count._all;
      return counts;
    }, {});
    const lastId = pageIds.at(-1);
    const nextCursor = hasMore && lastId ? encodeQueueCursor({ sort: query.sort, id: lastId }) : null;
    return NextResponse.json({ proposals: page, total, stageCounts, pageInfo: { hasNextPage: hasMore, nextCursor }, filters: query, hasMore, nextCursor });
  } catch (err) {
    console.error("[content-pilot/proposals] list error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
