export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateAllOpportunities } from "@/lib/opportunities/generate";
import { routeOpenOpportunities } from "@/lib/opportunities/route";

const VALID_STATUSES = ["open", "routed", "dismissed", "resolved"];

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? "open";
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  const opportunities = await prisma.opportunity.findMany({
    where: { status },
    orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
    take: 250,
  });

  return NextResponse.json({ opportunities, total: opportunities.length });
}

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  try {
    const { searchParams } = new URL(req.url);
    const shouldRoute = ["1", "true", "yes"].includes((searchParams.get("route") ?? "").toLowerCase());
    const result = await generateAllOpportunities(prisma);
    if (!shouldRoute) return NextResponse.json(result);

    const routing = await routeOpenOpportunities(prisma);
    return NextResponse.json({ ...result, routing });
  } catch (err) {
    console.error("[opportunities] generate error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
