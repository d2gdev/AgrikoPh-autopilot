export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const records = await prisma.articleRecord.findMany({
      where: { publishedAt: { not: null } },
      select: { blogHandle: true, handle: true, title: true, linksData: true, inboundCount: true },
      orderBy: { indexedAt: "desc" },
    });
    const edges = await prisma.internalLinkEdge.findMany({
        where: {
          sourceType: "article",
          sourceHandle: { in: records.map((record) => record.handle) },
        },
        select: {
          sourceHandle: true,
          targetType: true,
          targetHandle: true,
          targetUrl: true,
          anchorText: true,
          isCta: true,
        },
        orderBy: { capturedAt: "desc" },
      });

    const outboundBySource = new Map<string, number>();
    const inboundArticleByHandle = new Map<string, number>();
    const targetsByType = new Map<string, Map<string, { targetType: string; targetHandle: string | null; targetUrl: string; inboundLinks: number; ctaLinks: number }>>();

    for (const edge of edges) {
      outboundBySource.set(edge.sourceHandle, (outboundBySource.get(edge.sourceHandle) ?? 0) + 1);

      const targetKey = edge.targetHandle ?? edge.targetUrl;
      if (!targetsByType.has(edge.targetType)) targetsByType.set(edge.targetType, new Map());
      const typeMap = targetsByType.get(edge.targetType)!;
      const current = typeMap.get(targetKey) ?? {
        targetType: edge.targetType,
        targetHandle: edge.targetHandle,
        targetUrl: edge.targetUrl,
        inboundLinks: 0,
        ctaLinks: 0,
      };
      current.inboundLinks++;
      if (edge.isCta) current.ctaLinks++;
      typeMap.set(targetKey, current);

      if (edge.targetType === "article" && edge.targetHandle) {
        inboundArticleByHandle.set(edge.targetHandle, (inboundArticleByHandle.get(edge.targetHandle) ?? 0) + 1);
      }
    }

    const withLinks = records.map((r) => {
      const links = r.linksData as { internal: unknown[]; external: unknown[] };
      const edgeOutbound = outboundBySource.get(r.handle);
      const edgeInbound = inboundArticleByHandle.get(r.handle);
      return {
        blogHandle: r.blogHandle,
        handle: r.handle,
        title: r.title,
        outboundLinks: edgeOutbound ?? links.internal?.length ?? 0,
        inboundCount: edgeInbound ?? r.inboundCount,
      };
    });

    // Hubs = articles with the most outbound internal links (they link out to many others)
    const hubs = [...withLinks]
      .sort((a, b) => b.outboundLinks - a.outboundLinks)
      .slice(0, 10);

    // Authorities = articles with the most inbound links (many others point to them)
    const authorities = [...withLinks]
      .sort((a, b) => b.inboundCount - a.inboundCount)
      .slice(0, 10);

    const orphans = withLinks.filter((a) => a.inboundCount === 0);
    const targets = Object.fromEntries(
      [...targetsByType.entries()].map(([type, rows]) => [
        type,
        [...rows.values()]
          .sort((a, b) => b.inboundLinks - a.inboundLinks || b.ctaLinks - a.ctaLinks)
          .slice(0, 25),
      ])
    );

    return NextResponse.json({
      total: records.length,
      hubs,
      authorities,
      orphans,
      orphanCount: orphans.length,
      edgeCount: edges.length,
      targets,
    });
  } catch (err) {
    console.error("[content-pilot/link-graph] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
