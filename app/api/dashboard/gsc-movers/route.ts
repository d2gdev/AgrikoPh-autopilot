export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { getGscMovers } from "@/lib/dashboard/gsc-movers";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const result = await getGscMovers();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[dashboard/gsc-movers] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
