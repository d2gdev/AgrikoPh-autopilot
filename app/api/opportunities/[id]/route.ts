export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { routeOpportunity } from "@/lib/opportunities/route";

const TERMINAL_ACTIONS = ["dismiss", "resolve"] as const;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const opportunity = await prisma.opportunity.findUnique({ where: { id } });
  if (!opportunity) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ opportunity });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "route";

  try {
    if (action === "route") {
      const result = await routeOpportunity(prisma, id);
      if (result.reason === "not_found") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (!result.routed) {
        return NextResponse.json({ error: result.reason ?? "Could not route opportunity" }, { status: 409 });
      }
      return NextResponse.json(result);
    }

    if (TERMINAL_ACTIONS.includes(action as typeof TERMINAL_ACTIONS[number])) {
      const status = action === "resolve" ? "resolved" : "dismissed";
      const opportunity = await prisma.opportunity.update({
        where: { id },
        data: {
          status,
          resolvedAt: new Date(),
        },
      });
      return NextResponse.json({ opportunity });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[opportunity] update error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  return PATCH(req, context);
}
