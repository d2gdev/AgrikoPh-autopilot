import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateBrief, type BriefSections } from "@/lib/market-intel/generate-brief";
import { Prisma } from "@prisma/client";

const BRIEF_SOURCE = "competitive_brief";
const SENTINEL = new Date("2000-01-01T00:00:00.000Z");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const existing = await prisma.rawSnapshot.findFirst({
      where: {
        source: BRIEF_SOURCE,
        dateRangeStart: SENTINEL,
        dateRangeEnd: SENTINEL,
      },
      orderBy: { fetchedAt: "desc" },
    });

    if (existing && Date.now() - existing.fetchedAt.getTime() < CACHE_TTL_MS) {
      return NextResponse.json({
        brief: existing.payload as unknown as BriefSections,
        cached: true,
        generatedAt: (existing.payload as Record<string, unknown>).generatedAt ?? existing.fetchedAt.toISOString(),
      });
    }

    const brief = await generateBrief();

    await prisma.rawSnapshot.upsert({
      where: { source_dateRangeStart_dateRangeEnd: { source: BRIEF_SOURCE, dateRangeStart: SENTINEL, dateRangeEnd: SENTINEL } },
      create: { source: BRIEF_SOURCE, dateRangeStart: SENTINEL, dateRangeEnd: SENTINEL, payload: brief as unknown as Prisma.InputJsonValue },
      update: { payload: brief as unknown as Prisma.InputJsonValue, fetchedAt: new Date() },
    });

    return NextResponse.json({ brief, cached: false, generatedAt: brief.generatedAt });
  } catch (err) {
    console.error("[brief] generation failed:", err);
    return NextResponse.json({ error: "Brief generation failed" }, { status: 500 });
  }
}
