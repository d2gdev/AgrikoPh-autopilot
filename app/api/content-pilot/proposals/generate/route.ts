export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getSessionShop, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { generateProposals } from "@/lib/content-pilot/generate-proposals";
import { opportunityFromProposal, upsertOpportunities } from "@/lib/opportunities/generate";
import { markContentProposalOpportunitiesTerminal } from "@/lib/opportunities/content-proposal-outcomes";
import {
  CONTENT_PROPOSAL_REPLACEMENT_BLOCKING_STATUSES,
  contentProposalDedupeKey,
  filterBlockedContentProposalInputs,
} from "@/lib/content-pilot/proposal-dedupe";
import { createContentProposalOnce, withContentProposalDedupeKey } from "@/lib/content-pilot/create-proposal";
import { replacePendingContentProposals } from "@/lib/content-pilot/proposal-replacement";

export async function POST(req: Request) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  const shop = (await getSessionShop(req)) ?? "api";
  if (!checkRateLimit(`proposals-generate:${shop}`, 5, 60_000)) {
    return NextResponse.json(
      { error: "Rate limit exceeded — max 5 proposal generations per minute" },
      { status: 429 }
    );
  }

  try {
    const proposals = await generateProposals(prisma);

    // Deduplicate existing approved proposals: for each (articleHandle, proposalType)
    // group with more than one record, keep ONE and delete the rest. We keep the
    // row with the most recent updatedAt so operator edits (which bump updatedAt)
    // are preserved rather than silently discarded in favour of a newer createdAt.
    const approved = await prisma.contentProposal.findMany({
      where: { status: { in: ["approved", "override_approved", "rejected"] } },
      select: { id: true, articleHandle: true, proposalType: true, title: true, proposedState: true, updatedAt: true, status: true, draftStatus: true, sourceData: true },
      // Most recently edited first → the first row seen per key is the keeper.
      orderBy: { updatedAt: "desc" },
    });
    const seen = new Set<string>();
    const toDelete: typeof approved = [];
    for (const p of approved) {
      const key = contentProposalDedupeKey(p);
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
      return NextResponse.json({ created: 0, proposals: [], deduplicated: toDelete.length, opportunities: 0 });
    }

    const fresh = await filterBlockedContentProposalInputs(
      prisma,
      proposals,
      CONTENT_PROPOSAL_REPLACEMENT_BLOCKING_STATUSES,
    );

    if (fresh.length === 0) {
      return NextResponse.json({ created: 0, proposals: [], deduplicated: toDelete.length, opportunities: 0 });
    }

    // Delete existing pending proposals and create the fresh set atomically, so a
    // failure can never leave the table with the old pending rows wiped and no
    // replacements written.
    const replacement = await replacePendingContentProposals(prisma, fresh.map((p) => ({ articleHandle: p.articleHandle,
            proposalType: p.proposalType,
            changeType: p.changeType,
            priority: p.priority,
            impact: p.impact,
            effort: p.effort,
            title: p.title,
            description: p.description,
            proposedState: p.proposedState as object,
            sourceData: p.sourceData as object })));
    return NextResponse.json({
      created: replacement.created,
      proposals: replacement.proposals,
      deduplicated: toDelete.length,
      opportunities: replacement.opportunities,
    });
  } catch (err) {
    console.error("[content-pilot/proposals/generate] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
