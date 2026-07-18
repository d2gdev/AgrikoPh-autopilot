export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  return NextResponse.json({
    error: "Unguided SEO briefs have been retired.",
    replacement: "/content-pilot?tab=brief",
  }, { status: 410 });
}
