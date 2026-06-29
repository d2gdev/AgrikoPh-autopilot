export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { getSeoHistoryTrend } from "@/lib/seo/data";

export async function GET(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  try {
    const { searchParams } = new URL(req.url);
    const source = searchParams.get("source") ?? "seo_history";

    const trend = await getSeoHistoryTrend(source);

    return NextResponse.json({ trend });
  } catch (err) {
    console.error("[seo/history] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
