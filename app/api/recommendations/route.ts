import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAppAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set([
  "pending", "approved", "rejected", "override_approved",
  "executing", "executed", "failed",
]);

const VALID_PLATFORMS = new Set(["meta"]);

export async function GET(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const statusParam = req.nextUrl.searchParams.get("status") ?? "pending";
  if (!VALID_STATUSES.has(statusParam)) {
    return NextResponse.json({ error: `Invalid status "${statusParam}"` }, { status: 400 });
  }
  const status = statusParam;

  const platformParam = req.nextUrl.searchParams.get("platform");
  if (platformParam && !VALID_PLATFORMS.has(platformParam)) {
    return NextResponse.json({ error: `Invalid platform "${platformParam}"` }, { status: 400 });
  }
  const platform = platformParam;
  const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);
  const limit = Math.min(Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "25", 10) || 25), 50);

  const targetEntityId = req.nextUrl.searchParams.get("targetEntityId");

  const where: Record<string, unknown> = { status };
  if (platform) where.platform = platform;
  if (targetEntityId) where.targetEntityId = targetEntityId;

  const [recommendations, total] = await Promise.all([
    prisma.recommendation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
    }),
    prisma.recommendation.count({ where }),
  ]);

  return NextResponse.json({ recommendations, total, offset, limit });
}
