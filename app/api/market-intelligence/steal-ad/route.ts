import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { generateStolenAd } from "@/lib/market-intel/steal-ad";

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const body = await req.json() as { adId?: string };
    if (!body.adId || typeof body.adId !== "string") {
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
