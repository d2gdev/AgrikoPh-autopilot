import { NextResponse } from "next/server";
import { PERMISSIONS, requireAppAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { importAndValidatePackage } from "@/lib/topical-map/activation";
import { safeTopicalMapError } from "@/lib/topical-map/operator-route";
import { readStrategyPackage } from "@/lib/topical-map/package-reader";

export const dynamic = "force-dynamic";

const versionSelect = {
  id: true,
  packageId: true,
  strategyVersion: true,
  packageSha256: true,
  lifecycle: true,
  validationStatus: true,
  validationReport: true,
  evidenceDate: true,
  createdAt: true,
  validatedAt: true,
  activatedAt: true,
  artifacts: { select: { artifactId: true, mediaType: true, sha256: true, byteLength: true, metadata: true } },
  validationIssues: { select: { severity: true, code: true, blocking: true, ruleId: true, sourceArtifactId: true } },
  _count: { select: { compiledRules: true } },
} as const;

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const [packages, active] = await Promise.all([
      prisma.topicalMapStrategyVersion.findMany({ orderBy: { createdAt: "desc" }, select: versionSelect }),
      prisma.topicalMapActivation.findUnique({ where: { siteHost: "agrikoph.com" }, select: { strategyVersionId: true } }),
    ]);
    return NextResponse.json({ packages, activeVersionId: active?.strategyVersionId ?? null });
  } catch (error) {
    return safeTopicalMapError(error);
  }
}

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const permissionError = await requirePermission(req, PERMISSIONS.SETTINGS_ADMIN);
  if (permissionError) return permissionError;

  const root = process.env.TOPICAL_MAP_STRATEGY_ROOT;
  if (!root) return NextResponse.json({ error: "Strategy package service is unavailable." }, { status: 503 });

  try {
    const rawPackage = await readStrategyPackage(root);
    const result = await importAndValidatePackage({ rawPackage, asOf: new Date().toISOString() });
    return NextResponse.json(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return safeTopicalMapError(error);
  }
}
