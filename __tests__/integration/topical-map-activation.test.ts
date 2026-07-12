import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { readStrategyPackage } from "@/lib/topical-map/package-reader";
import { activateStrategyVersion, importAndValidatePackage, rollbackStrategyVersion } from "@/lib/topical-map/activation";

const url = process.env.DATABASE_URL_TEST;
const parsed = url ? new URL(url) : null;
const safe = Boolean(parsed && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) && parsed.pathname.slice(1) === "autopilot_test");
if (url && !safe) throw new Error("DATABASE_URL_TEST must point to the guarded local autopilot_test database");

const root = "/home/sean/Agriko/shopify-theme/docs/seo";
const host = "agrikoph.com";
const stamp = `${Date.now()}${Math.random().toString(16).slice(2)}`;
const hash = (prefix: string) => `${prefix}${stamp}`.padEnd(64, "0").slice(0, 64);

function versionData(packageSha256: string, lifecycle: "validated" | "active" | "superseded" | "rolled_back" = "validated") {
  return { siteHost: host, packageId: `activation-${stamp}`, strategyVersion: "2026-07-12", packageSha256, evidenceDate: new Date("2026-07-11T00:00:00.000Z"), provenance: { test: stamp }, compatibility: { runtimeSchema: "1.0.0" }, manifest: { test: stamp }, lifecycle, validationStatus: "valid", validationReport: { valid: true, issues: [], blockingIssueCount: 0, evidenceFreshness: [] }, compiledAt: new Date(), compiledSchemaVersion: "1.0.0", validatedAt: new Date() };
}

describe.skipIf(!url)("PostgreSQL topical-map activation", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "TopicalMapStrategyVersion" CASCADE');
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("imports a valid package idempotently and preserves a rejected stale package for inspection", async () => {
    const raw = await readStrategyPackage(root);
    const first = await importAndValidatePackage({ rawPackage: raw, asOf: "2026-07-12T00:00:00.000Z" });
    const duplicate = await importAndValidatePackage({ rawPackage: raw, asOf: "2026-07-12T00:00:00.000Z" });
    expect(first.lifecycle).toBe("validated");
    expect(duplicate).toMatchObject({ id: first.id, idempotent: true });
    await expect(prisma.topicalMapStrategyArtifact.count({ where: { strategyVersionId: first.id } })).resolves.toBe(6);

    const stale = { ...raw, manifest: { ...raw.manifest } } as typeof raw;
    stale.packageSha256 = hash("c");
    stale.manifest.packageSha256 = stale.packageSha256;
    stale.manifest.evidenceDate = "2025-01-01";
    const rejected = await importAndValidatePackage({ rawPackage: stale, asOf: "2026-07-12T00:00:00.000Z" });
    const persisted = await prisma.topicalMapStrategyVersion.findUniqueOrThrow({ where: { id: rejected.id }, include: { validationIssues: true } });
    expect(persisted.lifecycle).toBe("rejected");
    expect(persisted.validationReport).toMatchObject({ evidenceFreshness: expect.arrayContaining([expect.objectContaining({ status: "stale" })]) });
    expect(persisted.validationIssues.some((issue) => issue.code === "STALE_MANDATORY_EVIDENCE")).toBe(true);
  }, 30000);

  it("rejects concurrent activation while runtime authorization is false and preserves the existing active pointer", async () => {
    const old = await prisma.topicalMapStrategyVersion.create({ data: versionData(hash("d"), "active") });
    await prisma.topicalMapActivation.upsert({ where: { siteHost: host }, create: { siteHost: host, strategyVersionId: old.id, activatedBy: "test" }, update: { strategyVersionId: old.id, activatedBy: "test" } });
    const left = await prisma.topicalMapStrategyVersion.create({ data: versionData(hash("e")) });
    const right = await prisma.topicalMapStrategyVersion.create({ data: versionData(hash("f")) });
    const settled = await Promise.allSettled([
      activateStrategyVersion({ siteHost: host, versionId: left.id, actor: "concurrent-a", reason: "test" }),
      activateStrategyVersion({ siteHost: host, versionId: right.id, actor: "concurrent-b", reason: "test" }),
    ]);
    for (const result of settled) {
      expect(result).toMatchObject({
        status: "rejected",
        reason: expect.objectContaining({ message: "Runtime topical-map activation is not authorized." }),
      });
    }
    const active = await prisma.topicalMapStrategyVersion.findMany({ where: { siteHost: host, lifecycle: "active" } });
    const pointer = await prisma.topicalMapActivation.findUniqueOrThrow({ where: { siteHost: host } });
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(old.id);
    expect(pointer.strategyVersionId).toBe(old.id);
    expect(await prisma.topicalMapStrategyVersion.findUniqueOrThrow({ where: { id: left.id } })).toMatchObject({ lifecycle: "validated" });
    expect(await prisma.topicalMapStrategyVersion.findUniqueOrThrow({ where: { id: right.id } })).toMatchObject({ lifecycle: "validated" });
    expect(await prisma.auditLog.count({ where: { action: "topical_map_strategy_activated", entityType: "topical_map_strategy", entityId: { in: [left.id, right.id] } } })).toBe(0);
  }, 30000);

  it("rolls back only to a historically validated same-site version atomically with provenance", async () => {
    const historic = await prisma.topicalMapStrategyVersion.create({ data: versionData(hash("g"), "superseded") });
    const current = await prisma.topicalMapStrategyVersion.create({ data: versionData(hash("h"), "active") });
    await prisma.topicalMapActivation.create({ data: { siteHost: host, strategyVersionId: current.id, activatedBy: "test" } });
    await rollbackStrategyVersion({ siteHost: host, versionId: historic.id, actor: "rollback-operator", reason: "test rollback" });
    const pointer = await prisma.topicalMapActivation.findUniqueOrThrow({ where: { siteHost: host } });
    expect(pointer.strategyVersionId).toBe(historic.id);
    expect(await prisma.topicalMapStrategyVersion.findUniqueOrThrow({ where: { id: historic.id } })).toMatchObject({ lifecycle: "active" });
    expect(await prisma.topicalMapStrategyVersion.findUniqueOrThrow({ where: { id: current.id } })).toMatchObject({ lifecycle: "rolled_back" });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "topical_map_strategy_rolled_back", entityId: historic.id }, orderBy: { createdAt: "desc" } });
    expect(audit).toMatchObject({ before: expect.objectContaining({ versionId: current.id, packageSha256: current.packageSha256 }), after: expect.objectContaining({ versionId: historic.id, packageSha256: historic.packageSha256 }), meta: expect.objectContaining({ siteHost: host, actor: "rollback-operator", reason: "test rollback" }) });
  }, 30000);
});
