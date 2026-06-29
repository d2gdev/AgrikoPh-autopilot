export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { getJobHistory } from "@/lib/dashboard/job-history";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const history = await getJobHistory();
    return NextResponse.json({ history });
  } catch (err) {
    console.error("[dashboard/job-history] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
