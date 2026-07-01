export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireAppAuth, getSessionShop, getSessionUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { fillCaptureTranslations } from "@/lib/market-intel/translate-captures";

// One-time (re-runnable) backfill: fill English translation columns for existing
// Market Intelligence captures. Idempotent — only touches rows whose *En column is
// still null, so repeated calls converge. Triggered manually with the app API key.
export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const actor = (await getSessionShop(req)) ?? (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`market-intel-backfill-translations:${actor}`, 3, 60_000)) {
    return NextResponse.json({ error: "Rate limit exceeded — max 3 per minute" }, { status: 429 });
  }

  const totals = { shopping: 0, adHeadlines: 0, adCopies: 0, adCaptureHeadlines: 0, adCaptureCopies: 0 };
  try {
    // Loop until a pass translates nothing new (or a safety cap is reached).
    // Must account for ALL counters fillCaptureTranslations returns — including
    // the competitorAdCapture ones — or the loop stops early while capture rows
    // still need translating, and the response under-reports work done.
    for (let i = 0; i < 50; i++) {
      const r = await fillCaptureTranslations({ limit: 100 });
      totals.shopping += r.shopping;
      totals.adHeadlines += r.adHeadlines;
      totals.adCopies += r.adCopies;
      totals.adCaptureHeadlines += r.adCaptureHeadlines;
      totals.adCaptureCopies += r.adCaptureCopies;
      if (
        r.shopping === 0 && r.adHeadlines === 0 && r.adCopies === 0 &&
        r.adCaptureHeadlines === 0 && r.adCaptureCopies === 0
      ) break;
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
