import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { projectTopicalMapCommandCenter } from "@/lib/topical-map/command-center";

export const dynamic = "force-dynamic";

const response = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "Cache-Control": "private, no-store" },
});

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const activation = await prisma.topicalMapActivation.findUnique({
      where: { siteHost: "agrikoph.com" },
      select: {
        strategyVersion: {
          select: {
            id: true,
            strategyVersion: true,
            contractRevision: true,
            packageSha256: true,
            activatedAt: true,
            lifecycle: true,
            validationStatus: true,
            compiledRules: {
              select: {
                ruleId: true,
                ruleType: true,
                sourceArtifactId: true,
                compiledPayload: true,
              },
            },
          },
        },
      },
    });
    const generatedAt = new Date().toISOString();
    if (!activation) return response({ state: "no_active_strategy", generatedAt, commandCenter: null });

    const active = activation.strategyVersion;
    if (active.lifecycle !== "active" || active.validationStatus !== "valid" || active.contractRevision === null) throw new Error("INVALID_ACTIVE_STRATEGY");

    return response({
      state: "ready",
      generatedAt,
      commandCenter: projectTopicalMapCommandCenter({
        strategy: { ...active, contractRevision: String(active.contractRevision) },
        rules: active.compiledRules.map((rule) => {
          const compiled = object(rule.compiledPayload);
          return {
            ruleId: rule.ruleId,
            ruleType: rule.ruleType,
            sourceArtifactId: rule.sourceArtifactId,
            payload: compiled.payload,
            sourceReferences: Array.isArray(compiled.sourceReferences) ? compiled.sourceReferences : [],
          };
        }),
      }),
    });
  } catch {
    return response({ state: "unavailable", error: "Command center is unavailable." }, 500);
  }
}
