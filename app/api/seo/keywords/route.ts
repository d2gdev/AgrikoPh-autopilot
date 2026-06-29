export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAppAuth, getSessionShop } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getLatestSnapshot, getComparisonSnapshot, getQueries } from "@/lib/seo/snapshot";
import { buildKeywordReport } from "@/lib/seo/keywords";

export async function GET(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const tracked = await prisma.marketKeyword.findMany({
    where: { active: true, category: "seo" },
    select: { keyword: true },
  });

  const latest = await getLatestSnapshot("gsc");
  const previous = latest ? await getComparisonSnapshot("gsc", latest) : null;

  const report = buildKeywordReport(tracked, getQueries(latest), getQueries(previous));
  return NextResponse.json({ keywords: report });
}

export async function POST(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const shop = (await getSessionShop(req)) ?? "api";
  if (!checkRateLimit(`seo-keyword:${shop}`, 20, 60_000)) {
    return NextResponse.json({ error: "Rate limit: max 20 keyword adds per minute" }, { status: 429 });
  }

  let body: { keyword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const keyword = body.keyword?.trim();
  if (!keyword) {
    return NextResponse.json({ error: "keyword is required" }, { status: 400 });
  }

  // locationName is nullable and part of the compound unique; Prisma's compound
  // unique `where` input does not accept null, so use findFirst-then-upsert.
  const existing = await prisma.marketKeyword.findFirst({
    where: { keyword, locationName: null, languageCode: "en" },
    select: { id: true },
  });

  if (existing) {
    await prisma.marketKeyword.update({
      where: { id: existing.id },
      data: { active: true, category: "seo" },
    });
  } else {
    await prisma.marketKeyword.create({
      data: { keyword, category: "seo", languageCode: "en", active: true },
    });
  }

  return NextResponse.json({ ok: true, keyword });
}
