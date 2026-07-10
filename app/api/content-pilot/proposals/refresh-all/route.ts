export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireAppAuth, getSessionShop } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { withContentProposalDedupeKey } from "@/lib/content-pilot/create-proposal";
import { checkRateLimit } from "@/lib/rate-limit";
import { fetchBlogArticles } from "@/lib/shopify-admin";
import { CONTENT_PROPOSAL_RECREATE_BLOCKING_STATUSES } from "@/lib/content-pilot/proposal-dedupe";

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  // Expensive mutating endpoint (fetches the whole blog + bulk-creates proposals).
  const shop = (await getSessionShop(req)) ?? "api";
  if (!checkRateLimit(`refresh-all:${shop}`, 5, 60_000)) {
    return NextResponse.json(
      { error: "Rate limit exceeded — max 5 refreshes per minute" },
      { status: 429 }
    );
  }

  try {
    const articles = await fetchBlogArticles();

    // Find articles that already have active or terminal refresh history, so
    // rejected/published decisions do not come back through this bulk bypass.
    const existing = await prisma.contentProposal.findMany({
      where: {
        proposalType: "content-refresh",
        status: { in: CONTENT_PROPOSAL_RECREATE_BLOCKING_STATUSES },
      },
      select: { articleHandle: true },
    });
    const existingHandles = new Set(existing.map((p) => p.articleHandle).filter(Boolean));

    const toCreate = articles.filter((a) => a.handle && !existingHandles.has(a.handle));

    if (toCreate.length === 0) {
      return NextResponse.json({ created: 0, message: "All articles already have a refresh proposal." });
    }

    const created = await prisma.$transaction(
      toCreate.map((a) =>
        prisma.contentProposal.create({
          data: {
            ...withContentProposalDedupeKey({ articleHandle: a.handle,
            proposalType: "content-refresh",
            changeType: "update",
            priority: "P3",
            impact: "medium",
            effort: "medium",
            title: `Guidelines refresh: ${a.title}`,
            description: `Re-write "${a.title}" to apply the current brand & writing guidelines.`,
            proposedState: { articleHandle: a.handle, articleTitle: a.title },
            sourceData: { trigger: "manual-guidelines-refresh" } }),
          },
        })
      )
    );

    return NextResponse.json({ created: created.length });
  } catch (err) {
    console.error("[proposals/refresh-all] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
