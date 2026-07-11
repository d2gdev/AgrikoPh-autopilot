import { NextResponse } from "next/server";
import { PERMISSIONS, requireAppAuth, requirePermission, getSessionShop, getSessionUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { generateBrief } from "@/lib/market-intel/generate-brief";
import { Prisma } from "@prisma/client";

const BRIEF_SOURCE = "competitive_brief";
const SENTINEL = new Date("2000-01-01T00:00:00.000Z");

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  const actor = (await getSessionShop(req)) ?? (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`market-intel-brief-refresh:${actor}`, 5, 60_000)) {
    return NextResponse.json({ error: "Rate limit exceeded — max 5 brief refreshes per minute" }, { status: 429 });
  }

  try {
    const brief = await generateBrief();

    await prisma.rawSnapshot.upsert({
      where: { source_dateRangeStart_dateRangeEnd: { source: BRIEF_SOURCE, dateRangeStart: SENTINEL, dateRangeEnd: SENTINEL } },
      create: { source: BRIEF_SOURCE, dateRangeStart: SENTINEL, dateRangeEnd: SENTINEL, payload: brief as unknown as Prisma.InputJsonValue },
      update: { payload: brief as unknown as Prisma.InputJsonValue, fetchedAt: new Date() },
    });

    return NextResponse.json({ brief, cached: false, generatedAt: brief.generatedAt });
  } catch (err) {
    console.error("[brief/refresh] failed:", err);
    return NextResponse.json({ error: "Brief refresh failed" }, { status: 500 });
  }
}
