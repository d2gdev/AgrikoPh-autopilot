export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { getExecutionQueueSummary } from "@/lib/recommendations/execution-queue";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const summary = await getExecutionQueueSummary();
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[recommendations/execution-queue] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
