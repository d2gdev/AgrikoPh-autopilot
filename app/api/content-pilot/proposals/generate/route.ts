export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireAppAuth, getSessionShop } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { generateProposals } from "@/lib/content-pilot/generate-proposals";
import { opportunityFromProposal, upsertOpportunities } from "@/lib/opportunities/generate";
import { markContentProposalOpportunitiesTerminal } from "@/lib/opportunities/content-proposal-outcomes";

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const shop = (await getSessionShop(req)) ?? "api";
  if (!checkRateLimit(`proposals-generate:${shop}`, 5, 60_000)) {
    return NextResponse.json(
      { error: "Rate limit exceeded — max 5 proposal generations per minute" },
      { status: 429 }
    );
  }

  try {
    const proposals = await generateProposals(prisma);
    const opportunityResult = await upsertOpportunities(
      prisma,
      proposals.map(opportunityFromProposal),
    );

    // Deduplicate existing approved proposals: for each (articleHandle, proposalType)
    // group with more than one record, keep ONE and delete the rest. We keep the
    // row with the most recent updatedAt so operator edits (which bump updatedAt)
    // are preserved rather than silently discarded in favour of a newer createdAt.
    const approved = await prisma.contentProposal.findMany({
      where: { status: { in: ["approved", "rejected"] } },
      select: { id: true, articleHandle: true, proposalType: true, updatedAt: true, status: true, draftStatus: true, sourceData: true },
      // Most recently edited first → the first row seen per key is the keeper.
      orderBy: { updatedAt: "desc" },
    });
    const seen = new Set<string>();
    const toDelete: typeof approved = [];
    for (const p of approved) {
      const key = `${p.articleHandle ?? "__null__"}::${p.proposalType}`;
      if (seen.has(key)) {
        toDelete.push(p);
      } else {
        seen.add(key);
      }
    }
    if (toDelete.length > 0) {
      await markContentProposalOpportunitiesTerminal(prisma, toDelete);
      await prisma.contentProposal.deleteMany({ where: { id: { in: toDelete.map((p) => p.id) } } });
    }

    if (proposals.length === 0) {
      return NextResponse.json({ created: 0, proposals: [], deduplicated: toDelete.length, opportunities: opportunityResult.upserted });
    }

    // Build a set of already-active (approved/published) article+type combos so we
    // don't create new proposals that would immediately duplicate them.
    const activeKeys = new Set(
      (await prisma.contentProposal.findMany({
        where: { status: { in: ["approved", "published"] } },
        select: { articleHandle: true, proposalType: true },
      })).map((p) => `${p.articleHandle ?? "__null__"}::${p.proposalType}`)
    );

    const fresh = proposals.filter(
      (p) => !activeKeys.has(`${p.articleHandle ?? "__null__"}::${p.proposalType}`)
    );

    if (fresh.length === 0) {
      return NextResponse.json({ created: 0, proposals: [], deduplicated: toDelete.length, opportunities: opportunityResult.upserted });
    }

    // Delete existing pending proposals and create the fresh set atomically, so a
    // failure can never leave the table with the old pending rows wiped and no
    // replacements written.
    const pendingToDelete = await prisma.contentProposal.findMany({
      where: { status: "pending" },
      select: { id: true, status: true, draftStatus: true, sourceData: true },
    });
    if (pendingToDelete.length > 0) {
      await markContentProposalOpportunitiesTerminal(prisma, pendingToDelete);
    }
    const created = await prisma.$transaction([
      prisma.contentProposal.deleteMany({ where: { status: "pending" } }),
      ...fresh.map((p) =>
        prisma.contentProposal.create({
          data: {
            articleHandle: p.articleHandle,
            proposalType: p.proposalType,
            changeType: p.changeType,
            priority: p.priority,
            impact: p.impact,
            effort: p.effort,
            title: p.title,
            description: p.description,
            proposedState: p.proposedState as object,
            sourceData: p.sourceData as object,
          },
        })
      ),
    ]);

    // First element is the deleteMany batch result; the rest are the created rows.
    const createdRows = created.slice(1);
    return NextResponse.json({
      created: createdRows.length,
      proposals: createdRows,
      deduplicated: toDelete.length,
      opportunities: opportunityResult.upserted,
    });
  } catch (err) {
    console.error("[content-pilot/proposals/generate] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
