export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAppAuth, getSessionShop, getSessionUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { classifyPriority, findingToImpact, changeTypeToEffort } from "@/lib/content-pilot/priority-score";
import { getLatestSnapshot } from "@/lib/seo/snapshot";

interface GapInput {
  query: string;
  impressions?: number;
  position?: number;
  suggestedTitle: string;
}

const ACTIVE_STATUSES = ["pending", "approved", "override_approved"];

export async function POST(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const shop = (await getSessionShop(req)) ?? "api";
  if (!checkRateLimit(`seo-promote:${shop}`, 10, 60_000)) {
    return NextResponse.json({ error: "Rate limit: max 10 promotions per minute" }, { status: 429 });
  }

  let body: { gaps?: GapInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const gaps = Array.isArray(body.gaps) ? body.gaps : [];
  if (gaps.length === 0) {
    return NextResponse.json({ error: "No gaps provided" }, { status: 400 });
  }
  if (gaps.length > 50) {
    return NextResponse.json({ error: "Too many gaps: max 50 per request" }, { status: 400 });
  }

  // Pull GSC keyword context to enrich proposals
  const gscSnap = await getLatestSnapshot("gsc");
  const allQueries = ((gscSnap?.payload?.topQueries as Array<{ query: string; impressions: number; clicks: number; position: string }>) ?? []);


  let skipped = 0;

  // Candidate titles from the input (deduped, valid gaps only).
  const candidateTitles = Array.from(
    new Set(
      gaps
        .filter((g) => g && g.query && g.suggestedTitle)
        .map((g) => g.suggestedTitle),
    ),
  );

  const created = await prisma.$transaction(async (tx) => {
    // Batched dedup reads (single query each) inside the transaction so concurrent
    // calls can't both pass the check-then-write window.
    // TODO: a DB partial-unique index on (title, proposalType, status) would be the
    // robust fix for this race; add via Prisma migration as a follow-up.
    const [existingProposals, existingArticles] = await Promise.all([
      tx.contentProposal.findMany({
        where: {
          proposalType: "new-content",
          title: { in: candidateTitles, mode: "insensitive" },
          status: { in: ACTIVE_STATUSES },
        },
        select: { title: true },
      }),
      tx.articleRecord.findMany({
        where: { title: { in: candidateTitles, mode: "insensitive" } },
        select: { title: true },
      }),
    ]);

    const existingTitleSet = new Set<string>([
      ...existingProposals.map((p) => p.title.toLowerCase()),
      ...existingArticles.map((a) => a.title.toLowerCase()),
    ]);

    const seenInBatch = new Set<string>();
    const rows: Array<Record<string, unknown>> = [];

    for (const gap of gaps) {
      if (!gap || !gap.query || !gap.suggestedTitle) {
        skipped++;
        continue;
      }
      const impressions = gap.impressions;
      const position = gap.position;
      const title = gap.suggestedTitle;
      const titleKey = title.toLowerCase();

      // Dedup against existing rows and within this same batch (case-insensitive).
      if (existingTitleSet.has(titleKey) || seenInBatch.has(titleKey)) {
        skipped++;
        continue;
      }
      seenInBatch.add(titleKey);

    const score = Math.min(
      100,
      Math.round((impressions ?? 0) / 20) +
        (position && position <= 10 ? 20 : position && position <= 20 ? 10 : 0)
    );
    const priority = classifyPriority(score);
    const impact = findingToImpact(score);
    const effort = changeTypeToEffort("new_article");

    rows.push({
      proposalType: "new-content",
      changeType: "new_article",
      articleHandle: null,
      priority,
      impact,
      effort,
      title,
      description: `Net-new article targeting the search query "${gap.query}" (${impressions ?? 0} impressions, avg position ${position ?? "—"}).`,
      proposedState: {
        title,
        targetQuery: gap.query,
        targetKeyword: gap.query,
        seoKeywords: allQueries
          .filter(q => q.query !== gap.query && gap.query.split(" ").some(w => w.length > 3 && q.query.includes(w)))
          .slice(0, 8)
          .map(q => q.query),
        gscPosition: position ?? null,
        gscImpressions: impressions ?? 0,
      },
      sourceData: { source: "seo-pilot", query: gap.query, impressions: impressions ?? 0, position: position ?? null },
    });
    }

    if (rows.length === 0) return [];

    return Promise.all(
      rows.map((r) => tx.contentProposal.create({ data: r as never })),
    );
  });

  if (created.length === 0) {
    return NextResponse.json({ created: 0, skipped, proposals: [] });
  }

  try {
    const actor = (await getSessionUser(req)) ?? "operator";
    await prisma.auditLog.create({
      data: {
        actor,
        action: "seo_gap_promoted",
        entityType: "ContentProposal",
        entityId: created.map((p) => p.id).join(","),
        meta: { created: created.length, skipped },
      },
    });
  } catch { /* audit log is best-effort */ }

  return NextResponse.json({
    created: created.length,
    skipped,
    proposals: created.map((p) => ({ id: p.id, title: p.title })),
  });
}
