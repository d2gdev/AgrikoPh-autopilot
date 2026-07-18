export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

// Lightweight keep-alive endpoint — pinged every 4 minutes by cron to prevent Neon hibernation.
export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;
  if (!checkRateLimit("cron:ping", 20, 60_000)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
