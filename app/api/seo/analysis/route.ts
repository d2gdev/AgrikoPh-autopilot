export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { getLatestSnapshot } from "@/lib/seo/snapshot";
import { prisma } from "@/lib/db";
import { loadActiveTopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import { readAnalysisForStrategy, readAnalysisStrategyIdentity } from "@/lib/seo/analysis";

export async function GET(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const [snap, commandCenter] = await Promise.all([getLatestSnapshot("seo_analysis"), loadActiveTopicalMapCommandCenter(prisma)]);
  if (!commandCenter) return NextResponse.json({ state: "no_active_strategy", analysis: null, generatedAt: null, strategy: null });
  const cachedStrategy = snap ? readAnalysisStrategyIdentity(snap.payload) : null;
  const analysis = commandCenter && snap ? readAnalysisForStrategy(snap.payload, commandCenter.identity) : null;
  const stale = cachedStrategy !== null && (cachedStrategy.versionId !== commandCenter.identity.versionId || cachedStrategy.packageSha256 !== commandCenter.identity.packageSha256);
  return NextResponse.json({
    state: stale ? "stale" : analysis ? "ready" : "empty",
    analysis,
    generatedAt: analysis ? snap?.fetchedAt ?? null : null,
    strategy: commandCenter.identity,
    ...(stale ? { cachedStrategy } : {}),
  });
}
