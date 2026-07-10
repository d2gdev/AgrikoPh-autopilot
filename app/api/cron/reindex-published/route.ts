export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";

const BATCH = 20;
const MIN_DAYS = 14;
const MAX_DAYS = 60;

export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;
  const acquired = await acquireJobLock("reindex-published");
  if (!acquired) return NextResponse.json({ skipped: true }, { status: 409 });

  try {

  const now = new Date();
  const minDate = new Date(now.getTime() - MAX_DAYS * 24 * 60 * 60 * 1000);
  const maxDate = new Date(now.getTime() - MIN_DAYS * 24 * 60 * 60 * 1000);

  // Find published proposals with a tracked article handle, published 14–60 days
  // ago, and no follow-up score yet.
  const proposals = await prisma.contentProposal.findMany({
    where: {
      draftStatus: "published",
      publishedAt: { gte: minDate, lte: maxDate },
      followUpSeoScore: null,
      baselineSeoScore: { not: null },
      articleHandle: { not: null },
    },
    select: {
      id: true,
      articleHandle: true,
      publishedHandle: true,
    },
    take: BATCH,
  });

  if (proposals.length === 0) {
    return NextResponse.json({ scored: 0, message: "No proposals due for follow-up scoring." });
  }

  // Collect all handles to look up — prefer publishedHandle (new articles) then
  // fall back to articleHandle (edits to existing articles).
  const handleSet = new Set<string>();
  for (const p of proposals) {
    const h = p.publishedHandle ?? p.articleHandle;
    if (h) handleSet.add(h);
  }

  const records = await prisma.articleRecord.findMany({
    where: { handle: { in: Array.from(handleSet) } },
    select: { handle: true, seoData: true },
  });

  const scoreMap = new Map<string, number>();
  for (const r of records) {
    const seo = r.seoData as { score?: number } | null;
    if (seo?.score != null) {
      scoreMap.set(r.handle, seo.score);
    }
  }

  let scored = 0;
  const updates: Promise<unknown>[] = [];

  for (const p of proposals) {
    const handle = p.publishedHandle ?? p.articleHandle;
    if (!handle) continue;
    const score = scoreMap.get(handle);
    if (score == null) continue;

    updates.push(
      prisma.contentProposal.update({
        where: { id: p.id },
        data: { followUpSeoScore: score, followUpScoredAt: now },
      })
    );
    scored++;
  }

  await Promise.all(updates);

  return NextResponse.json({ scored, total: proposals.length });
  } finally {
    await releaseJobLock("reindex-published");
  }
}
