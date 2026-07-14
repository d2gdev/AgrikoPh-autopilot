export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createGovernedContentProposal } from "@/lib/topical-map/compliance-store";
import { checkRateLimit } from "@/lib/rate-limit";
import { normalizeGovernedUrl } from "@/lib/topical-map/url-normalizer";

const PromoteBodySchema = z.object({
  handle: z.string().trim().min(1).max(180),
  title: z.string().trim().min(1).max(240),
  issue: z.enum(["missing-meta", "thin-content", "missing-h1"]),
  targetUrl: z.string().trim().min(1).max(500),
  highStakesTopics: z.array(z.enum(["medical", "dosage"])).max(2).optional(),
  wordCount: z.coerce.number().int().nonnegative().max(100_000).optional(),
});

export async function POST(req: Request) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  const actor = (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`seo-promote:${actor}`, 20, 60_000)) {
    return NextResponse.json({ error: "Rate limit: max 20 promotions per minute" }, { status: 429 });
  }

  const parsed = PromoteBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "handle, title, and issue are required" }, { status: 400 });
  }
  const { handle, issue, targetUrl, highStakesTopics } = parsed.data;
  const targetMatch = /^\/blogs\/([^/]+)\/([^/]+)$/.exec(normalizeGovernedUrl(targetUrl));
  if (!targetMatch || targetMatch[2] !== handle) return NextResponse.json({ error: "Exact blog article target is required" }, { status: 400 });

  const article = await prisma.articleRecord.findUnique({
    where: { blogHandle_handle: { blogHandle: targetMatch[1]!, handle } },
    select: { handle: true, title: true, wordCount: true },
  });
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const title = article.title;
  const currentWordCount = article.wordCount ?? 0;

  const proposalTitle =
    issue === "thin-content" ? `Expand thin content: ${title}` :
    issue === "missing-h1" ? `Add heading structure: ${title}` :
    `Fix meta: ${title}`;

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

  const result = await createGovernedContentProposal(prisma as never, {
    data: proposalData as never,
    candidate: { type: "seo_metadata", targetUrl, ...(highStakesTopics ? { highStakesTopics } : {}) },
  });
  if (!result.created || !result.proposal) return NextResponse.json({ id: null, existed: false, compliance: result.compliance }, { status: 409 });
  return NextResponse.json({ id: result.proposal.id, existed: false });
}
