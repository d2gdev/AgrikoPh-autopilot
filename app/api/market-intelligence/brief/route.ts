import { NextResponse } from "next/server";
import { PERMISSIONS, requireAppAuth, requirePermission, getSessionShop, getSessionUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { generateBrief, type BriefSections } from "@/lib/market-intel/generate-brief";
import { Prisma } from "@prisma/client";

const BRIEF_SOURCE = "competitive_brief";
const SENTINEL = new Date("2000-01-01T00:00:00.000Z");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Dedup concurrent cache-miss requests so two GETs arriving while the cache is
// stale (e.g. two tabs, or a client retry) trigger one paid AI generation, not
// two — mirrors the in-flight dedup already used by /api/market-intelligence.
let briefGenerationInFlight: Promise<BriefSections> | null = null;

async function generateAndCacheBrief(): Promise<BriefSections> {
  const brief = await generateBrief();
  await prisma.rawSnapshot.upsert({
    where: { source_dateRangeStart_dateRangeEnd: { source: BRIEF_SOURCE, dateRangeStart: SENTINEL, dateRangeEnd: SENTINEL } },
    create: { source: BRIEF_SOURCE, dateRangeStart: SENTINEL, dateRangeEnd: SENTINEL, payload: brief as unknown as Prisma.InputJsonValue },
    update: { payload: brief as unknown as Prisma.InputJsonValue, fetchedAt: new Date() },
  });
  return brief;
}

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  const actor = (await getSessionShop(req)) ?? (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`market-intel-brief:${actor}`, 10, 60_000)) {
    return NextResponse.json({ error: "Rate limit exceeded — max 10 brief requests per minute" }, { status: 429 });
  }

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

    let brief: BriefSections;
    if (briefGenerationInFlight) {
      brief = await briefGenerationInFlight;
    } else {
      const request = generateAndCacheBrief();
      briefGenerationInFlight = request;
      try {
        brief = await request;
      } finally {
        if (briefGenerationInFlight === request) briefGenerationInFlight = null;
      }
    }

    return NextResponse.json({ brief, cached: false, generatedAt: brief.generatedAt });
  } catch (err) {
    console.error("[brief] generation failed:", err);
    return NextResponse.json({ error: "Brief generation failed" }, { status: 500 });
  }
}
