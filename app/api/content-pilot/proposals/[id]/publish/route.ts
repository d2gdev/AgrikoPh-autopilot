export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextResponse } from "next/server";
import { getSessionUser, PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publishContentProposal } from "@/lib/content-pilot/publish-service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appAuthError = await requireAppAuth(req);
  if (appAuthError) return appAuthError;
  const permissionError = await requirePermission(req, PERMISSIONS.CONTENT_PUBLISH);
  if (permissionError) return permissionError;
  const { id } = await params;
  const result = await publishContentProposal({
    prismaClient: prisma, proposalId: id, actor: (await getSessionUser(req)) ?? "operator", trigger: "manual",
  });
  if (result.kind === "conflict") return NextResponse.json({ error: result.message }, { status: 409 });
  if (result.kind === "failed_before_external_write") return NextResponse.json({ error: result.message }, { status: 500 });
  if (result.kind === "reconciliation_required") return NextResponse.json({ reconciliationRequired: true, error: result.message }, { status: 202 });
  return NextResponse.json({ published: true, kind: result.kind, shopifyId: result.shopifyId, handle: result.handle, ...(result.kind === "published_with_warnings" ? { publishWarning: result.warning } : {}) });
}
