export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { SeoAnalysis } from "@/lib/analyzers/blog-seo";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = 50;
  const skip = (page - 1) * limit;

  try {
    const [records, total] = await Promise.all([
      prisma.articleRecord.findMany({
        skip,
        take: limit,
        orderBy: { publishedAt: "desc" },
        select: {
          handle: true,
          title: true,
          publishedAt: true,
          wordCount: true,
          seoData: true,
          topicsData: true,
          linksData: true,
          inboundCount: true,
          indexedAt: true,
        },
      }),
      prisma.articleRecord.count(),
    ]);

    const articles = records.map((r) => {
      const seo = (r.seoData as unknown as SeoAnalysis) ?? { score: 0, issues: [] };
      const links = r.linksData as { internal: unknown[]; external: unknown[]; inboundCount?: number };
      const topics = r.topicsData as Array<{ topic: string; confidence: number }>;
      return {
        handle: r.handle,
        title: r.title,
        publishedAt: r.publishedAt,
        wordCount: r.wordCount,
        seoScore: seo.score,
        seoIssues: seo.issues,
        internalLinks: links.internal?.length ?? 0,
        inboundCount: r.inboundCount,
        topics: topics.slice(0, 3).map((t) => t.topic),
        indexedAt: r.indexedAt,
      };
    });

    return NextResponse.json({ articles, total, page, pages: Math.ceil(total / limit) });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
