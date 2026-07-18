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
      select: { topicsData: true },
      orderBy: { indexedAt: "desc" },
    });

    const clusterCounts = new Map<string, number>();

    for (const r of records) {
      const topics = r.topicsData as Array<{ topic: string; confidence: number }>;
      for (const t of topics) {
        const topic = typeof t.topic === "string" ? t.topic.trim() : "";
        if (topic) clusterCounts.set(topic, (clusterCounts.get(topic) ?? 0) + 1);
      }
    }

    const clusters = [...clusterCounts].map(([topic, count]) => ({
      topic,
      articleCount: count,
    }));

    clusters.sort((a, b) => b.articleCount - a.articleCount || a.topic.localeCompare(b.topic));

    return NextResponse.json({ clusters, totalArticles: records.length });
  } catch (err) {
    console.error("[content-pilot/topic-clusters] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
