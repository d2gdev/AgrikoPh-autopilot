import { NextResponse } from "next/server";
import { PERMISSIONS, getSessionUser, requireAppAuth, requirePermission } from "@/lib/auth";
import { activateStrategyVersion } from "@/lib/topical-map/activation";
import { optionalReason, safeTopicalMapError } from "@/lib/topical-map/operator-route";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.SETTINGS_ADMIN);
  if (permissionError) return permissionError;

  const body = await optionalReason(req);
  if (body instanceof NextResponse) return body;
  const { id } = await params;
  const actor = (await getSessionUser(req)) ?? "authenticated-operator";
  try {
    return NextResponse.json(await activateStrategyVersion({ versionId: id, siteHost: "agrikoph.com", actor, ...body }));
  } catch (error) {
    return safeTopicalMapError(error);
  }
}
