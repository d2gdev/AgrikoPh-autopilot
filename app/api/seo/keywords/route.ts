export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAppAuth, getSessionShop, getSessionUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getLatestGscData, getPreviousGscQueries } from "@/lib/seo/data";
import { buildKeywordReport } from "@/lib/seo/keywords";

const KeywordBodySchema = z.object({
  keyword: z.string().trim().min(1).max(120),
});

function normalizeKeyword(keyword: string): string {
  return keyword.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function GET(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const tracked = await prisma.marketKeyword.findMany({
    where: { active: true, category: "seo" },
    select: { keyword: true },
  });

  const latest = await getLatestGscData();
  const previous = await getPreviousGscQueries(latest);

  const report = buildKeywordReport(tracked, latest.queries, previous ?? []);
  return NextResponse.json({ keywords: report });
}

export async function POST(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const actor = (await getSessionShop(req)) ?? (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`seo-keyword:${actor}`, 20, 60_000)) {
    return NextResponse.json({ error: "Rate limit: max 20 keyword adds per minute" }, { status: 429 });
  }

  const parsed = KeywordBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const keyword = normalizeKeyword(parsed.data.keyword);

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
