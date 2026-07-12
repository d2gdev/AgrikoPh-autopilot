import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
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
  validationIssues: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 24, select: { severity: true, code: true, blocking: true, ruleId: true, sourceArtifactId: true } },
  proposalCompliances: {
    orderBy: [{ evaluatedAt: "desc" }, { id: "desc" }], take: 12,
    select: { result: true, matchedRuleIds: true, evidenceFreshness: true, requiredGates: true },
  },
  _count: { select: { compiledRules: true } },
} satisfies Prisma.TopicalMapStrategyVersionSelect;

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const strings = (value: unknown, limit = 12): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, limit) : [];

function gates(value: unknown) {
  const report = object(value);
  const entries = Array.isArray(report?.evidenceFreshness) ? report.evidenceFreshness : [];
  return entries.slice(0, 24).flatMap((entry) => {
    const gate = object(entry);
    if (!gate || typeof gate.gateId !== "string" || typeof gate.ruleId !== "string" || !["current", "missing", "stale"].includes(String(gate.status))) return [];
    return [{ gateId: gate.gateId, ruleId: gate.ruleId, mandatory: gate.mandatory === true, status: gate.status, maxAgeDays: typeof gate.maxAgeDays === "number" ? gate.maxAgeDays : 0, ageDays: typeof gate.ageDays === "number" ? gate.ageDays : null, blockingReason: typeof gate.blockingReason === "string" ? gate.blockingReason : null }];
  });
}

function compliance(entries: Array<{ result: string; matchedRuleIds: unknown; evidenceFreshness: unknown; requiredGates: unknown }>) {
  const counts: Record<string, number> = {};
  const recent = entries.map((entry) => {
    counts[entry.result] = (counts[entry.result] ?? 0) + 1;
    const freshness = Array.isArray(entry.evidenceFreshness) ? entry.evidenceFreshness : [];
    return {
      result: entry.result,
      matchedRuleIds: strings(entry.matchedRuleIds),
      evidenceGates: [...strings(entry.requiredGates), ...freshness.flatMap((item) => { const gate = object(item); return typeof gate?.gateId === "string" ? [gate.gateId] : []; })].slice(0, 12),
      sourceArtifactIds: freshness.flatMap((item) => { const gate = object(item); return typeof gate?.sourceArtifactId === "string" ? [gate.sourceArtifactId] : []; }).slice(0, 12),
    };
  });
  return { counts, recent };
}

function auditEntry(value: { action: string; createdAt: Date; meta: unknown }) {
  const meta = object(value.meta);
  return { action: value.action, occurredAt: value.createdAt, actor: typeof meta?.actor === "string" ? meta.actor : null, reason: typeof meta?.reason === "string" ? meta.reason : null };
}

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const [packages, active] = await Promise.all([
      prisma.topicalMapStrategyVersion.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 12, select: versionSelect }),
      prisma.topicalMapActivation.findUnique({ where: { siteHost: "agrikoph.com" }, select: { strategyVersionId: true } }),
    ]);
    const audits = packages.length ? await prisma.auditLog.findMany({
      where: { entityType: "topical_map_strategy", entityId: { in: packages.map((strategyPackage) => strategyPackage.id) }, action: { in: ["topical_map_strategy_activated", "topical_map_strategy_rolled_back"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 24,
      select: { entityId: true, action: true, createdAt: true, meta: true },
    }) : [];
    const auditByVersion = new Map<string, ReturnType<typeof auditEntry>[]>();
    for (const audit of audits) {
      const entries = auditByVersion.get(audit.entityId) ?? [];
      if (entries.length < 8) entries.push(auditEntry(audit));
      auditByVersion.set(audit.entityId, entries);
    }
    return NextResponse.json({
      activeVersionId: active?.strategyVersionId ?? null,
      packages: packages.map((strategyPackage) => ({
        id: strategyPackage.id, packageId: strategyPackage.packageId, strategyVersion: strategyPackage.strategyVersion,
        packageSha256: strategyPackage.packageSha256, lifecycle: strategyPackage.lifecycle, validationStatus: strategyPackage.validationStatus,
        evidenceDate: strategyPackage.evidenceDate, compiledRuleCount: strategyPackage._count.compiledRules,
        validationIssues: strategyPackage.validationIssues, evidenceGates: gates(strategyPackage.validationReport),
        compliance: compliance(strategyPackage.proposalCompliances), auditTimeline: auditByVersion.get(strategyPackage.id) ?? [],
        lifecycleControls: { canActivate: false, canRollback: false, reason: "Runtime activation is not authorized from SEO Pilot. This package remains read-only unless server-projected authorization and lifecycle eligibility both permit a future control." },
      })),
    });
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
