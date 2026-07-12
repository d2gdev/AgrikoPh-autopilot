import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { compileStrategyPackage, type CompiledStrategyPackage } from "@/lib/topical-map/compiler";
import type { RawStrategyPackage } from "@/lib/topical-map/types";
import { validateCompiledPackage, type ValidationReport } from "@/lib/topical-map/validator";

export class StrategyActivationConflictError extends Error {
  constructor(message = "Topical-map strategy lifecycle conflict.") {
    super(message);
    this.name = "StrategyActivationConflictError";
  }
}

type StrategyVersionResult = {
  id: string;
  siteHost: string;
  packageSha256: string;
  lifecycle: string;
  idempotent: boolean;
};

type ImportInput = { rawPackage: RawStrategyPackage; asOf: string };
type LifecycleInput = { siteHost: string; versionId: string; actor: string; reason?: string };
type VersionSummary = { id: string; packageSha256: string };

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function siteHost(rawPackage: RawStrategyPackage): string {
  return rawPackage.manifest.compatibility.siteHost;
}

function validationStatus(report: ValidationReport): "valid" | "invalid" | "stale_evidence" {
  if (report.valid) return "valid";
  return report.evidenceFreshness.some((entry) => entry.status === "stale") ? "stale_evidence" : "invalid";
}

function sourceLocator(rule: CompiledStrategyPackage["rules"][number]): string {
  return JSON.stringify(rule.sourceReferences[0]?.locator ?? {});
}

function coherentExisting(existing: {
  artifacts: Array<{ artifactId: string }>;
  compiledRules: Array<{ ruleId: string }>;
  validationIssues: Array<{ code: string }>;
  validationReport: Prisma.JsonValue | null;
}, compiledPackage: CompiledStrategyPackage, report: ValidationReport): boolean {
  const artifactIds = new Set(existing.artifacts.map((artifact) => artifact.artifactId));
  const ruleIds = new Set(existing.compiledRules.map((rule) => rule.ruleId));
  const expectedIssues = report.issues.map((issue) => issue.code).sort();
  const existingIssues = existing.validationIssues.map((issue) => issue.code).sort();
  return artifactIds.size === 6
    && existing.artifacts.length === 6
    && ruleIds.size === compiledPackage.rules.length
    && existing.compiledRules.length === compiledPackage.rules.length
    && compiledPackage.rules.every((rule) => ruleIds.has(rule.ruleId))
    && JSON.stringify(existingIssues) === JSON.stringify(expectedIssues)
    && canonicalJson(existing.validationReport) === canonicalJson(report);
}

/** The only persistence boundary for immutable strategy packages. */
export async function importAndValidatePackage(input: ImportInput): Promise<StrategyVersionResult> {
  // Compile before opening a transaction: pre-persistence failures cannot leave rows behind.
  const compiledPackage = compileStrategyPackage(input.rawPackage);
  const report = validateCompiledPackage({ rawPackage: input.rawPackage, compiledPackage, asOf: input.asOf });
  const host = siteHost(input.rawPackage);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`topical-map-import:${host}:${input.rawPackage.packageSha256}`}))`;
    const existing = await tx.topicalMapStrategyVersion.findUnique({
      where: { siteHost_packageSha256: { siteHost: host, packageSha256: input.rawPackage.packageSha256 } },
      include: { artifacts: { select: { artifactId: true } }, compiledRules: { select: { ruleId: true } }, validationIssues: { select: { code: true } } },
    });
    if (existing) {
      if (!coherentExisting(existing, compiledPackage, report)) throw new StrategyActivationConflictError("Existing strategy package state is incomplete or conflicting.");
      return { id: existing.id, siteHost: existing.siteHost, packageSha256: existing.packageSha256, lifecycle: existing.lifecycle, idempotent: true };
    }

    const version = await tx.topicalMapStrategyVersion.create({
      data: {
        siteHost: host,
        packageId: input.rawPackage.manifest.packageId,
        strategyVersion: input.rawPackage.manifest.strategyVersion,
        packageSha256: input.rawPackage.packageSha256,
        evidenceDate: new Date(`${input.rawPackage.manifest.evidenceDate}T00:00:00.000Z`),
        provenance: json(input.rawPackage.manifest.provenance),
        compatibility: json(input.rawPackage.manifest.compatibility),
        manifest: json(input.rawPackage.manifest),
        lifecycle: report.valid ? "validated" : "rejected",
        validationStatus: validationStatus(report),
        validationReport: json(report),
        compiledAt: new Date(input.asOf),
        compiledSchemaVersion: "1.0.0",
        validatedAt: new Date(input.asOf),
      },
      select: { id: true, siteHost: true, packageSha256: true, lifecycle: true },
    });
    await tx.topicalMapStrategyArtifact.createMany({ data: Object.values(input.rawPackage.artifacts).map((artifact) => ({
      strategyVersionId: version.id, artifactId: artifact.id, path: artifact.path, mediaType: artifact.mediaType,
      sha256: artifact.sha256, byteLength: artifact.byteLength, rawContent: artifact.bytes.toString("utf8"),
      metadata: json({ required: artifact.required }),
    })) });
    await tx.topicalMapCompiledRule.createMany({ data: compiledPackage.rules.map((rule) => ({
      strategyVersionId: version.id, ruleId: rule.ruleId, ruleType: rule.domain, sourceArtifactId: rule.sourceReferences[0]!.artifactId,
      sourceLocator: sourceLocator(rule), compiledPayload: json(rule),
    })) });
    if (report.issues.length) await tx.topicalMapValidationIssue.createMany({ data: report.issues.map((issue) => ({
      strategyVersionId: version.id, severity: "error", code: issue.code, message: `Validation issue: ${issue.code}`,
      blocking: issue.blocking, sourceArtifactId: issue.sourceArtifactId, sourceLocator: issue.sourceLocator ? JSON.stringify(issue.sourceLocator) : null,
      ruleId: issue.ruleId, details: json({}),
    })) });
    return { ...version, idempotent: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function withLifecycleTransaction<T>(host: string, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`topical-map-activation:${host}`}))`;
    return run(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function targetVersion(tx: Prisma.TransactionClient, input: LifecycleInput) {
  const target = await tx.topicalMapStrategyVersion.findUnique({ where: { id: input.versionId }, select: { id: true, siteHost: true, lifecycle: true, validationStatus: true, packageSha256: true } });
  if (!target || target.siteHost !== input.siteHost) throw new StrategyActivationConflictError();
  return target;
}

function auditData(action: string, input: LifecycleInput, before: VersionSummary, after: VersionSummary) {
  return {
    actor: input.actor, action, entityType: "topical_map_strategy", entityId: after.id,
    before: { versionId: before.id, packageSha256: before.packageSha256, siteHost: input.siteHost },
    after: { versionId: after.id, packageSha256: after.packageSha256, siteHost: input.siteHost },
    meta: { siteHost: input.siteHost, actor: input.actor, ...(input.reason ? { reason: input.reason } : {}) },
  };
}

export async function activateStrategyVersion(input: LifecycleInput) {
  // The approved contract is validation/import-only. A future activation design
  // must introduce explicit runtime authorization before this transaction can run.
  const runtimeActivationAuthorized = false;
  if (!runtimeActivationAuthorized) throw new StrategyActivationConflictError("Runtime topical-map activation is not authorized.");

  const expectedCurrent = await prisma.topicalMapActivation.findUnique({
    where: { siteHost: input.siteHost },
    select: { strategyVersionId: true },
  });
  return withLifecycleTransaction(input.siteHost, async (tx) => {
    const target = await targetVersion(tx, input);
    if (target.lifecycle !== "validated") throw new StrategyActivationConflictError();
    const current = await tx.topicalMapActivation.findUnique({ where: { siteHost: input.siteHost }, select: { strategyVersion: { select: { id: true, packageSha256: true } } } });
    if ((current?.strategyVersion.id ?? null) !== (expectedCurrent?.strategyVersionId ?? null)) {
      throw new StrategyActivationConflictError("Active strategy changed before this request acquired ownership.");
    }
    const claimed = await tx.topicalMapStrategyVersion.updateMany({ where: { id: target.id, siteHost: input.siteHost, lifecycle: "validated" }, data: { lifecycle: "active", activatedAt: new Date() } });
    if (claimed.count !== 1) throw new StrategyActivationConflictError();
    if (current && current.strategyVersion.id !== target.id) {
      const superseded = await tx.topicalMapStrategyVersion.updateMany({ where: { id: current.strategyVersion.id, siteHost: input.siteHost, lifecycle: "active" }, data: { lifecycle: "superseded" } });
      if (superseded.count !== 1) throw new StrategyActivationConflictError();
    }
    await tx.topicalMapActivation.upsert({ where: { siteHost: input.siteHost }, create: { siteHost: input.siteHost, strategyVersionId: target.id, activatedBy: input.actor, activationReason: input.reason }, update: { strategyVersionId: target.id, activatedBy: input.actor, activationReason: input.reason } });
    await tx.auditLog.create({ data: auditData("topical_map_strategy_activated", input, current?.strategyVersion ?? target, target) });
    return { versionId: target.id, packageSha256: target.packageSha256, siteHost: input.siteHost };
  });
}

export async function rollbackStrategyVersion(input: LifecycleInput) {
  return withLifecycleTransaction(input.siteHost, async (tx) => {
    const target = await targetVersion(tx, input);
    if (!(["superseded", "rolled_back"] as const).includes(target.lifecycle as "superseded" | "rolled_back") || target.validationStatus !== "valid") throw new StrategyActivationConflictError();
    const current = await tx.topicalMapActivation.findUnique({ where: { siteHost: input.siteHost }, select: { strategyVersion: { select: { id: true, packageSha256: true } } } });
    if (!current || current.strategyVersion.id === target.id) throw new StrategyActivationConflictError();
    const restored = await tx.topicalMapStrategyVersion.updateMany({ where: { id: target.id, siteHost: input.siteHost, lifecycle: target.lifecycle }, data: { lifecycle: "active", activatedAt: new Date() } });
    if (restored.count !== 1) throw new StrategyActivationConflictError();
    const rolledBack = await tx.topicalMapStrategyVersion.updateMany({ where: { id: current.strategyVersion.id, siteHost: input.siteHost, lifecycle: "active" }, data: { lifecycle: "rolled_back" } });
    if (rolledBack.count !== 1) throw new StrategyActivationConflictError();
    await tx.topicalMapActivation.upsert({ where: { siteHost: input.siteHost }, create: { siteHost: input.siteHost, strategyVersionId: target.id, activatedBy: input.actor, activationReason: input.reason }, update: { strategyVersionId: target.id, activatedBy: input.actor, activationReason: input.reason } });
    await tx.auditLog.create({ data: auditData("topical_map_strategy_rolled_back", input, current.strategyVersion, target) });
    return { versionId: target.id, packageSha256: target.packageSha256, siteHost: input.siteHost };
  });
}
