export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppAuth, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createContentProposalOnce } from "@/lib/content-pilot/create-proposal";
import { checkRateLimit } from "@/lib/rate-limit";
import { CONTENT_PROPOSAL_RECREATE_BLOCKING_STATUSES } from "@/lib/content-pilot/proposal-dedupe";

const PromoteBodySchema = z.object({
  handle: z.string().trim().min(1).max(180),
  title: z.string().trim().min(1).max(240),
  issue: z.enum(["missing-meta", "thin-content", "missing-h1"]),
  wordCount: z.coerce.number().int().nonnegative().max(100_000).optional(),
});

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const actor = (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`seo-promote:${actor}`, 20, 60_000)) {
    return NextResponse.json({ error: "Rate limit: max 20 promotions per minute" }, { status: 429 });
  }

  const parsed = PromoteBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "handle, title, and issue are required" }, { status: 400 });
  }
  const { handle, issue, wordCount } = parsed.data;

  const article = await prisma.articleRecord.findUnique({
    where: { handle },
    select: { handle: true, title: true, wordCount: true },
  });
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const title = article.title;
  const currentWordCount = wordCount ?? article.wordCount ?? 0;

  const proposalType =
    issue === "thin-content" ? "content-refresh" :
    issue === "missing-h1" ? "content-refresh" :
    "seo-fix";
  const proposalTitle =
    issue === "thin-content" ? `Expand thin content: ${title}` :
    issue === "missing-h1" ? `Add heading structure: ${title}` :
    `Fix meta: ${title}`;

  // Check for an existing proposal for this exact article action, including
  // terminal operator decisions so finished ideas do not come back.
  const existing = await prisma.contentProposal.findFirst({
    where: {
      articleHandle: handle,
      proposalType,
      title: proposalTitle,
      status: { in: CONTENT_PROPOSAL_RECREATE_BLOCKING_STATUSES },
    },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json({ id: existing.id, existed: true });
  }

  type ProposalCreateData = Parameters<typeof prisma.contentProposal.create>[0]["data"];
  let proposalData: ProposalCreateData;

  if (issue === "thin-content") {
    const target = Math.max(500, Math.round(Math.max(currentWordCount, 200) * 2));
    proposalData = {
      articleHandle: handle,
      proposalType: "content-refresh",
      changeType: "update",
      priority: "P2",
      impact: "medium",
      effort: "medium",
      title: proposalTitle,
      description: `Article has only ${currentWordCount || "few"} words. Expand to ${target}+ words to improve SEO.`,
      proposedState: { action: "expand", articleHandle: handle, articleTitle: title, currentWordCount, targetWordCount: target },
      sourceData: { trigger: "seo-pilot-on-page-health", issue },
    };
  } else if (issue === "missing-meta") {
    proposalData = {
      articleHandle: handle,
      proposalType: "seo-fix",
      changeType: "update",
      priority: "P1",
      impact: "high",
      effort: "low",
      title: proposalTitle,
      description: `Missing meta title or description. Add optimised meta tags.`,
      proposedState: { articleHandle: handle, articleTitle: title, targetQuery: title, issue },
      sourceData: { trigger: "seo-pilot-on-page-health", issue },
    };
  } else if (issue === "missing-h1") {
    proposalData = {
      articleHandle: handle,
      proposalType: "content-refresh",
      changeType: "update",
      priority: "P1",
      impact: "high",
      effort: "medium",
      title: proposalTitle,
      description: `Missing H1 heading. Refresh the article body to add a clear H1-style opening heading and improve heading hierarchy without changing the article topic.`,
      proposedState: {
        action: "add_h1",
        articleHandle: handle,
        articleTitle: title,
        currentWordCount,
        targetWordCount: Math.max(500, currentWordCount || 300),
        issue,
      },
      sourceData: { trigger: "seo-pilot-on-page-health", issue },
    };
  } else {
    return NextResponse.json({ error: "Unknown issue type" }, { status: 400 });
  }

  const result = await createContentProposalOnce(prisma, proposalData as never);
  return NextResponse.json({ id: result.proposal.id, existed: !result.created });
}
