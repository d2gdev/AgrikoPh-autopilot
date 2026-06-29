export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { getActivitySparkline } from "@/lib/dashboard/activity-sparkline";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const result = await getActivitySparkline();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[dashboard/activity-sparkline] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
