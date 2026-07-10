export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAppAuth } from "@/lib/auth";
import { aggregateOnPageHealth, type ArticleHealthInput } from "@/lib/seo/health";

export async function GET(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const ARTICLE_LIMIT = 500;
  const articleCandidates = await prisma.articleRecord.findMany({
    take: ARTICLE_LIMIT + 1,
    orderBy: [{ indexedAt: "desc" }, { handle: "asc" }],
    select: {
      handle: true,
      title: true,
      wordCount: true,
      internalLinkCount: true,
      headingCount: true,
      inboundCount: true,
      seoData: true,
    },
  });

  const articles = articleCandidates.slice(0, ARTICLE_LIMIT);
  const result = aggregateOnPageHealth(articles as ArticleHealthInput[]);
  return NextResponse.json({
    ...result,
    limits: {
      articlesTotalLowerBound: articleCandidates.length,
      articlesAnalyzed: articles.length,
      articlesTruncated: articleCandidates.length > ARTICLE_LIMIT,
    },
  });
}
