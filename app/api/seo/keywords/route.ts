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

function isPrismaUniqueError(error: unknown): error is { code: "P2002" } {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
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

  try {
    await prisma.marketKeyword.create({
      data: { keyword, category: "seo", languageCode: "en", active: true },
    });
  } catch (error) {
    if (!isPrismaUniqueError(error)) throw error;
    const existing = await prisma.marketKeyword.findFirst({
      where: { keyword: { equals: keyword, mode: "insensitive" }, locationName: null, languageCode: "en" },
      select: { id: true },
    });
    if (!existing) throw error;
    await prisma.marketKeyword.update({
      where: { id: existing.id },
      data: { active: true, category: "seo" },
    });
  }

  return NextResponse.json({ ok: true, keyword });
}
