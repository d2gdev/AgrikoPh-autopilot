export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { getLatestSnapshot } from "@/lib/seo/snapshot";
import { prisma } from "@/lib/db";
import { loadActiveTopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import { readAnalysisForStrategy } from "@/lib/seo/analysis";

export async function GET(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const [snap, commandCenter] = await Promise.all([getLatestSnapshot("seo_analysis"), loadActiveTopicalMapCommandCenter(prisma)]);
  const analysis = commandCenter && snap ? readAnalysisForStrategy(snap.payload, commandCenter.identity) : null;
  return NextResponse.json({
    analysis,
    generatedAt: analysis ? snap?.fetchedAt ?? null : null,
    strategy: commandCenter?.identity ?? null,
  });
}
