export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { SeoAnalysis } from "@/lib/analyzers/blog-seo";
import type { LinksAnalysis } from "@/lib/analyzers/blog-links";
import type { TopicTag } from "@/lib/analyzers/blog-topics";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const { slug } = await params;
  if (!slug || slug.length > 255 || !/^[\w-]+$/.test(slug)) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }

  try {
    const blogHandle = new URL(req.url).searchParams.get("blogHandle") ?? "news";
    if (!/^[\w-]+$/.test(blogHandle)) return NextResponse.json({ error: "Invalid blog handle" }, { status: 400 });
    const record = await prisma.articleRecord.findUnique({
      where: { blogHandle_handle: { blogHandle, handle: slug } },
      select: {
        blogHandle: true,
        handle: true,
        title: true,
        publishedAt: true,
        wordCount: true,
        seoData: true,
        linksData: true,
        topicsData: true,
        indexedAt: true,
        snapshots: {
          orderBy: { capturedAt: "desc" },
          take: 10,
          select: {
            id: true,
            capturedAt: true,
            contentHash: true,
            wordCount: true,
            imageCount: true,
            headingCount: true,
            ctaCount: true,
            internalLinkCount: true,
            inboundCount: true,
            seoScore: true,
          },
        },
      },
    });
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      blogHandle: record.blogHandle,
      handle: record.handle,
      title: record.title,
      publishedAt: record.publishedAt,
      wordCount: record.wordCount,
      seo: record.seoData as unknown as SeoAnalysis,
      links: record.linksData as unknown as LinksAnalysis,
      topics: record.topicsData as unknown as TopicTag[],
      indexedAt: record.indexedAt,
      snapshots: record.snapshots,
    });
  } catch (err) {
    console.error("[content-pilot/articles/slug] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
