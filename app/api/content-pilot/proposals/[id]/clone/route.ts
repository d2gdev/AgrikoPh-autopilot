export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";

export async function POST(
  req: Request,
  _context: { params: Promise<{ id: string }> },
) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_REVIEW);
  if (permissionError) return permissionError;
  void _context;

  return NextResponse.json(
    { error: "Proposals cannot be duplicated because mapped work and its history must keep one canonical identity." },
    { status: 409 },
  );
}
