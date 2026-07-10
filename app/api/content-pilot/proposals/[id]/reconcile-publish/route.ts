export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { reconcilePublishOperation } from "@/lib/content-pilot/publish-reconciliation";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_PUBLISH);
  if (permissionError) return permissionError;
  const { id } = await params;
  const result = await reconcilePublishOperation({ prismaClient: prisma, proposalId: id });
  return NextResponse.json(result, { status: result.kind === "not_found" ? 404 : result.kind === "conflict" ? 409 : 200 });
}
