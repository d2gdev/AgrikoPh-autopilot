export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TOPIC_CLUSTERS } from "@/lib/config/topic-clusters";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const records = await prisma.articleRecord.findMany({
      where: { publishedAt: { not: null } },
      select: { topicsData: true },
      orderBy: { indexedAt: "desc" },
    });

    const clusterCounts: Record<string, number> = {};
    for (const topic of Object.keys(TOPIC_CLUSTERS)) {
      clusterCounts[topic] = 0;
    }

    for (const r of records) {
      const topics = r.topicsData as Array<{ topic: string; confidence: number }>;
      for (const t of topics) {
        if (t.topic in clusterCounts) {
          clusterCounts[t.topic]!++;
        }
      }
    }

    // Gap score on an asymptotic curve: 100/(1 + count/5). Unlike a linear
    // deduction it never hits 0, so high-coverage clusters stay distinct and
    // monotonically decreasing (count 1→83, 5→50, 10→33, 20→20, 50→9, 100→5).
    const clusters = Object.entries(clusterCounts).map(([topic, count]) => ({
      topic,
      articleCount: count,
      keywordCount: TOPIC_CLUSTERS[topic]!.length, // safe: topic came from Object.keys(TOPIC_CLUSTERS)
      gapScore: count === 0 ? 100 : Math.round(100 / (1 + count / 5)),
    }));

    clusters.sort((a, b) => b.gapScore - a.gapScore);

    return NextResponse.json({ clusters, totalArticles: records.length });
  } catch (err) {
    console.error("[content-pilot/topic-clusters] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
