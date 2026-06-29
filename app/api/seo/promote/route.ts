export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

type PromoteBody = {
  handle: string;
  title: string;
  issue: "missing-meta" | "thin-content" | "missing-h1";
  wordCount?: number;
};

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const body: PromoteBody = await req.json().catch(() => ({})) as PromoteBody;
  const { handle, title, issue, wordCount } = body;

  if (!handle || !title || !issue) {
    return NextResponse.json({ error: "handle, title, and issue are required" }, { status: 400 });
  }

  const proposalType =
    issue === "thin-content" ? "content-refresh" :
    issue === "missing-h1" ? "seo-fix" :
    "missing-meta";

  // Check for an existing non-rejected proposal for this article + type
  const existing = await prisma.contentProposal.findFirst({
    where: {
      articleHandle: handle,
      proposalType,
      status: { notIn: ["rejected"] },
    },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json({ id: existing.id, existed: true });
  }

  type ProposalCreateData = Parameters<typeof prisma.contentProposal.create>[0]["data"];
  let proposalData: ProposalCreateData;

  if (issue === "thin-content") {
    const target = Math.max(500, Math.round((wordCount ?? 200) * 2));
    proposalData = {
      articleHandle: handle,
      proposalType: "content-refresh",
      changeType: "update",
      priority: "P2",
      impact: "medium",
      effort: "medium",
      title: `Expand thin content: ${title}`,
      description: `Article has only ${wordCount ?? "few"} words. Expand to ${target}+ words to improve SEO.`,
      proposedState: { articleHandle: handle, articleTitle: title, targetWordCount: target },
      sourceData: { trigger: "seo-pilot-on-page-health", issue },
    };
  } else if (issue === "missing-meta") {
    proposalData = {
      articleHandle: handle,
      proposalType: "missing-meta",
      changeType: "update",
      priority: "P1",
      impact: "high",
      effort: "low",
      title: `Fix meta: ${title}`,
      description: `Missing meta title or description. Add optimised meta tags.`,
      proposedState: { articleHandle: handle, articleTitle: title },
      sourceData: { trigger: "seo-pilot-on-page-health", issue },
    };
  } else if (issue === "missing-h1") {
    proposalData = {
      articleHandle: handle,
      proposalType: "seo-fix",
      changeType: "update",
      priority: "P1",
      impact: "high",
      effort: "low",
      title: `Fix meta: ${title}`,
      description: `Missing H1 heading. Add an H1 and review meta title/description.`,
      proposedState: { articleHandle: handle, articleTitle: title },
      sourceData: { trigger: "seo-pilot-on-page-health", issue },
    };
  } else {
    return NextResponse.json({ error: "Unknown issue type" }, { status: 400 });
  }

  const proposal = await prisma.contentProposal.create({ data: proposalData });
  return NextResponse.json({ id: proposal.id, existed: false });
}
