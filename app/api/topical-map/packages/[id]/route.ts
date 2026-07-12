import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { safeTopicalMapError } from "@/lib/topical-map/operator-route";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const { id } = await params;
  try {
    const [strategyPackage, active] = await Promise.all([
      prisma.topicalMapStrategyVersion.findUnique({
        where: { id },
        select: {
          id: true, packageId: true, strategyVersion: true, packageSha256: true, lifecycle: true, validationStatus: true,
          validationReport: true, evidenceDate: true, createdAt: true, validatedAt: true, activatedAt: true,
          artifacts: { select: { artifactId: true, mediaType: true, sha256: true, byteLength: true, metadata: true } },
          validationIssues: { select: { severity: true, code: true, blocking: true, ruleId: true, sourceArtifactId: true } },
          _count: { select: { compiledRules: true } },
        },
      }),
      prisma.topicalMapActivation.findUnique({ where: { siteHost: "agrikoph.com" }, select: { strategyVersionId: true } }),
    ]);
    if (!strategyPackage) return NextResponse.json({ error: "Strategy package not found." }, { status: 404 });
    return NextResponse.json({ package: strategyPackage, active: active?.strategyVersionId === strategyPackage.id });
  } catch (error) {
    return safeTopicalMapError(error);
  }
}
