export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAppAuth } from "@/lib/auth";
import { aggregateOnPageHealth, type ArticleHealthInput } from "@/lib/seo/health";

export async function GET(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const articles = await prisma.articleRecord.findMany({
    take: 500,
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

  const result = aggregateOnPageHealth(articles as ArticleHealthInput[]);
  return NextResponse.json(result);
}
