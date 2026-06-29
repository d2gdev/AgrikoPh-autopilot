export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { fillCaptureTranslations } from "@/lib/market-intel/translate-captures";

// One-time (re-runnable) backfill: fill English translation columns for existing
// Market Intelligence captures. Idempotent — only touches rows whose *En column is
// still null, so repeated calls converge. Triggered manually with the app API key.
export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const totals = { shopping: 0, adHeadlines: 0, adCopies: 0 };
  try {
    // Loop until a pass translates nothing new (or a safety cap is reached).
    for (let i = 0; i < 50; i++) {
      const r = await fillCaptureTranslations({ limit: 100 });
      totals.shopping += r.shopping;
      totals.adHeadlines += r.adHeadlines;
      totals.adCopies += r.adCopies;
      if (r.shopping === 0 && r.adHeadlines === 0 && r.adCopies === 0) break;
    }
    return NextResponse.json({ ok: true, totals });
  } catch (error) {
    console.error("[market-intelligence] backfill-translations failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backfill failed", totals },
      { status: 500 },
    );
  }
}
