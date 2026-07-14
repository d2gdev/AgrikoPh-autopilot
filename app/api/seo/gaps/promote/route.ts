export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";

/**
 * Retired map-bound endpoint. Topical-map proposals must be reconstructed from
 * persisted candidate IDs by /api/seo/gaps/promote-selected.
 */
export async function POST(req: NextRequest) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;

  return NextResponse.json(
    { error: "This endpoint is retired. Use persisted candidate selection.", code: "ENDPOINT_RETIRED" },
    { status: 410 },
  );
}
