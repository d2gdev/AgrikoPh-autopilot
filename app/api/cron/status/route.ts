export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionShop } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const shop = await getSessionShop(req);
  if (!shop) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [runs, recCount, snapCount] = await Promise.all([
      prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 5 }),
      prisma.recommendation.count(),
      prisma.rawSnapshot.count(),
    ]);
    return NextResponse.json({ runs, recCount, snapCount });
  } catch (err) {
    console.error("[cron/status] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
