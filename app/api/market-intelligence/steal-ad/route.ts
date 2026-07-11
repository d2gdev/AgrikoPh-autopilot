import { NextResponse } from "next/server";
import { PERMISSIONS, requireAppAuth, requirePermission, getSessionShop, getSessionUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { generateStolenAd } from "@/lib/market-intel/steal-ad";

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  const actor = (await getSessionShop(req)) ?? (await getSessionUser(req)) ?? "embedded-app";
  if (!checkRateLimit(`market-intel-steal-ad:${actor}`, 20, 60_000)) {
    return NextResponse.json({ error: "Rate limit exceeded — max 20 per minute" }, { status: 429 });
  }

  try {
    const body = await req.json().catch(() => null) as { adId?: string } | null;
    if (!body || !body.adId || typeof body.adId !== "string") {
      return NextResponse.json({ error: "adId is required" }, { status: 400 });
    }
    const result = await generateStolenAd(body.adId);
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[steal-ad]", message);
    if (message === "Ad not found") {
      return NextResponse.json({ error: "Ad not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to rewrite ad" }, { status: 500 });
  }
}
