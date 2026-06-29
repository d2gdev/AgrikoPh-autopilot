export const dynamic = "force-dynamic";
export const maxDuration = 60;
import { NextRequest, NextResponse } from "next/server";
import { requireAppAuth, getSessionShop } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { fetchSeoDataHandler } from "@/jobs/fetch-seo-data";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
import { jobResponse } from "@/lib/jobs/response";

export async function POST(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const shop = (await getSessionShop(req)) ?? "api";
  if (!checkRateLimit(`seo-refresh:${shop}`, 3, 60_000)) {
    return NextResponse.json({ error: "Rate limit: max 3 refreshes per minute" }, { status: 429 });
  }
  const acquired = await acquireJobLock("fetch-seo-data");
  if (!acquired) return NextResponse.json({ skipped: true, reason: "fetch already running" }, { status: 409 });
  try {
    const result = await fetchSeoDataHandler();
    return jobResponse(result);
  } catch (err) {
    console.error("[seo/refresh] error:", err);
    return NextResponse.json({ error: "Refresh failed" }, { status: 500 });
  } finally {
    await releaseJobLock("fetch-seo-data");
  }
}
