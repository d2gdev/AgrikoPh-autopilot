export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { getLatestSnapshot } from "@/lib/seo/snapshot";

export async function GET(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const snap = await getLatestSnapshot("seo_analysis");
  return NextResponse.json({
    analysis: snap?.payload ?? null,
    generatedAt: snap?.fetchedAt ?? null,
  });
}
