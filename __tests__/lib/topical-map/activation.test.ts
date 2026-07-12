import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  topicalMapStrategyVersion: { findUnique: vi.fn() },
  topicalMapActivation: { findUnique: vi.fn() },
}));
const compiler = vi.hoisted(() => vi.fn());
const validator = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/topical-map/compiler", () => ({ compileStrategyPackage: compiler }));
vi.mock("@/lib/topical-map/validator", () => ({ validateCompiledPackage: validator }));

import {
  activateStrategyVersion,
  importAndValidatePackage,
  rollbackStrategyVersion,
  StrategyActivationConflictError,
} from "@/lib/topical-map/activation";

const rawPackage = {
  packageSha256: "a".repeat(64), root: "/isolated", manifest: {
    packageId: "package-a", strategyVersion: "2026-07-12", evidenceDate: "2026-07-11", provenance: { source: "test" },
    compatibility: { runtimeSchema: ">=1.0.0 <2.0.0", pluginVersion: ">=0.1.0", siteHost: "agrikoph.com", urlNormalization: "agriko-url-v1" },
    packageSha256: "a".repeat(64), schemaVersion: "1.0.0", createdAt: "2026-07-11T00:00:00.000Z", approval: {}, artifacts: [],
  },
  artifacts: {
    map: { id: "map", path: "map.md", mediaType: "text/markdown", sha256: "1".repeat(64), required: true, byteLength: 3, bytes: Buffer.from("map") },
    evidence: { id: "evidence", path: "evidence.md", mediaType: "text/markdown", sha256: "2".repeat(64), required: true, byteLength: 8, bytes: Buffer.from("evidence") },
    "url-inventory": { id: "url-inventory", path: "urls.csv", mediaType: "text/csv", sha256: "3".repeat(64), required: true, byteLength: 4, bytes: Buffer.from("urls") },
    "redirect-inventory": { id: "redirect-inventory", path: "redirects.csv", mediaType: "text/csv", sha256: "4".repeat(64), required: true, byteLength: 9, bytes: Buffer.from("redirects") },
    "internal-links": { id: "internal-links", path: "links.csv", mediaType: "text/csv", sha256: "5".repeat(64), required: true, byteLength: 5, bytes: Buffer.from("links") },
    "compilation-contract": { id: "compilation-contract", path: "contract.json", mediaType: "application/json", sha256: "6".repeat(64), required: true, byteLength: 8, bytes: Buffer.from("contract") },
  },
} as any;

const compiled = { strategyVersion: "2026-07-12", packageSha256: rawPackage.packageSha256, rules: [{ ruleId: "rule-a", domain: "clusters", payload: { kind: "cluster" }, sourceReferences: [{ artifactId: "map", locator: { kind: "markdown", lineStart: 1 }, resolved: { artifactId: "map", lineStart: 1, lineEnd: 1 } }] }], coverage: [], integrity: {}, byDomain: {} } as any;
const validReport = { valid: true, issues: [], blockingIssueCount: 0, evidenceFreshness: [{ gateId: "gate-a", status: "current" }] };

function tx() {
  return {
    $executeRaw: vi.fn(),
    topicalMapStrategyVersion: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
    topicalMapStrategyArtifact: { createMany: vi.fn() },
    topicalMapCompiledRule: { createMany: vi.fn() },
    topicalMapValidationIssue: { createMany: vi.fn() },
    topicalMapActivation: { findUnique: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn() },
  };
}

describe("topical-map activation persistence boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.topicalMapActivation.findUnique.mockResolvedValue(null);
    compiler.mockReturnValue(compiled);
    validator.mockReturnValue(validReport);
    db.$transaction.mockImplementation(async (fn: any) => fn(tx()));
  });

  it("persists all six immutable artifacts, compiled rules, and a zero-issue report without activation", async () => {
    const client = tx();
    client.topicalMapStrategyVersion.findUnique.mockResolvedValue(null);
    client.topicalMapStrategyVersion.create.mockResolvedValue({ id: "version-a", lifecycle: "validated", packageSha256: rawPackage.packageSha256 });
    db.$transaction.mockImplementation(async (fn: any) => fn(client));

    await importAndValidatePackage({ rawPackage, asOf: "2026-07-12T00:00:00.000Z" });

    expect(compiler).toHaveBeenCalledWith(rawPackage);
    expect(validator).toHaveBeenCalledWith({ rawPackage, compiledPackage: compiled, asOf: "2026-07-12T00:00:00.000Z" });
    expect(client.topicalMapStrategyArtifact.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ artifactId: "compilation-contract" })]) }));
    expect(client.topicalMapCompiledRule.createMany).toHaveBeenCalled();
    expect(client.topicalMapStrategyVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lifecycle: "validated", validationStatus: "valid", validationReport: validReport }) }));
    expect(client.topicalMapActivation.upsert).not.toHaveBeenCalled();
  });

  it("returns a coherent same-host same-hash version without immutable overwrite or history duplication", async () => {
    const client = tx();
    const existing = { id: "version-a", siteHost: "agrikoph.com", packageSha256: rawPackage.packageSha256, lifecycle: "validated", validationReport: validReport, artifacts: [{ artifactId: "map" }, { artifactId: "evidence" }, { artifactId: "url-inventory" }, { artifactId: "redirect-inventory" }, { artifactId: "internal-links" }, { artifactId: "compilation-contract" }], compiledRules: [{ ruleId: "rule-a" }], validationIssues: [] };
    client.topicalMapStrategyVersion.findUnique.mockResolvedValue(existing);
    db.$transaction.mockImplementation(async (fn: any) => fn(client));
    await expect(importAndValidatePackage({ rawPackage, asOf: "2026-07-12T00:00:00.000Z" })).resolves.toEqual(expect.objectContaining({ id: "version-a", idempotent: true }));
    expect(client.topicalMapStrategyVersion.create).not.toHaveBeenCalled();
    expect(client.topicalMapStrategyArtifact.createMany).not.toHaveBeenCalled();
    expect(client.auditLog.create).not.toHaveBeenCalled();
  });

  it("persists stale validation as rejected and inspectable but never activates it", async () => {
    const client = tx();
    validator.mockReturnValue({ valid: false, issues: [{ code: "STALE_MANDATORY_EVIDENCE", blocking: true, ruleId: "rule-a", sourceArtifactId: "evidence", sourceLocator: { line: 1 } }], blockingIssueCount: 1, evidenceFreshness: [{ gateId: "gate-a", status: "stale" }] });
    client.topicalMapStrategyVersion.findUnique.mockResolvedValue(null);
    client.topicalMapStrategyVersion.create.mockResolvedValue({ id: "rejected-a", lifecycle: "rejected" });
    db.$transaction.mockImplementation(async (fn: any) => fn(client));
    await importAndValidatePackage({ rawPackage, asOf: "2027-01-08T00:00:00.000Z" });
    expect(client.topicalMapStrategyVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lifecycle: "rejected", validationStatus: "stale_evidence", validationReport: expect.objectContaining({ evidenceFreshness: [expect.objectContaining({ status: "stale" })] }) }) }));
    expect(client.topicalMapActivation.upsert).not.toHaveBeenCalled();
  });
});

describe("topical-map atomic lifecycle transitions", () => {
  it("activates only a same-site validated target, supersedes the prior active version, and records provenance", async () => {
    const client = tx();
    db.topicalMapActivation.findUnique.mockResolvedValue({ strategyVersionId: "old" });
    client.topicalMapStrategyVersion.findUnique.mockResolvedValue({ id: "next", siteHost: "agrikoph.com", lifecycle: "validated", packageSha256: "b".repeat(64) });
    client.topicalMapActivation.findUnique.mockResolvedValue({ strategyVersion: { id: "old", packageSha256: "a".repeat(64) } });
    client.topicalMapStrategyVersion.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    client.topicalMapActivation.upsert.mockResolvedValue({ strategyVersionId: "next" });
    db.$transaction.mockImplementation(async (fn: any) => fn(client));
    await activateStrategyVersion({ siteHost: "agrikoph.com", versionId: "next", actor: "operator", reason: "reviewed" });
    expect(client.$executeRaw).toHaveBeenCalled();
    expect(client.topicalMapStrategyVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "next", siteHost: "agrikoph.com", lifecycle: "validated" }, data: expect.objectContaining({ lifecycle: "active" }) }));
    expect(client.topicalMapStrategyVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "old", siteHost: "agrikoph.com", lifecycle: "active" }, data: { lifecycle: "superseded" } }));
    expect(client.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "topical_map_strategy_activated", before: expect.objectContaining({ versionId: "old", packageSha256: "a".repeat(64) }), after: expect.objectContaining({ versionId: "next", packageSha256: "b".repeat(64) }), meta: expect.objectContaining({ siteHost: "agrikoph.com", actor: "operator", reason: "reviewed" }) }) }));
  });

  it("fails closed when a conditional activation loses its race", async () => {
    const client = tx();
    client.topicalMapStrategyVersion.findUnique.mockResolvedValue({ id: "next", siteHost: "agrikoph.com", lifecycle: "validated", packageSha256: "b".repeat(64) });
    client.topicalMapStrategyVersion.updateMany.mockResolvedValue({ count: 0 });
    db.$transaction.mockImplementation(async (fn: any) => fn(client));
    await expect(activateStrategyVersion({ siteHost: "agrikoph.com", versionId: "next", actor: "operator" })).rejects.toBeInstanceOf(StrategyActivationConflictError);
    expect(client.topicalMapActivation.upsert).not.toHaveBeenCalled();
  });

  it("rolls back atomically only to a historically validated same-site version and audits both hashes", async () => {
    const client = tx();
    client.topicalMapStrategyVersion.findUnique.mockResolvedValue({ id: "historic", siteHost: "agrikoph.com", lifecycle: "superseded", validationStatus: "valid", packageSha256: "a".repeat(64) });
    client.topicalMapActivation.findUnique.mockResolvedValue({ strategyVersion: { id: "current", packageSha256: "b".repeat(64) } });
    client.topicalMapStrategyVersion.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    client.topicalMapActivation.upsert.mockResolvedValue({ strategyVersionId: "historic" });
    db.$transaction.mockImplementation(async (fn: any) => fn(client));
    await rollbackStrategyVersion({ siteHost: "agrikoph.com", versionId: "historic", actor: "operator", reason: "regression" });
    expect(client.topicalMapStrategyVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "current", siteHost: "agrikoph.com", lifecycle: "active" }, data: { lifecycle: "rolled_back" } }));
    expect(client.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "topical_map_strategy_rolled_back", before: expect.objectContaining({ versionId: "current", packageSha256: "b".repeat(64) }), after: expect.objectContaining({ versionId: "historic", packageSha256: "a".repeat(64) }) }) }));
  });

  it("does not report a rollback when its in-transaction audit persistence fails", async () => {
    const client = tx();
    client.topicalMapStrategyVersion.findUnique.mockResolvedValue({ id: "historic", siteHost: "agrikoph.com", lifecycle: "superseded", validationStatus: "valid", packageSha256: "a".repeat(64) });
    client.topicalMapActivation.findUnique.mockResolvedValue({ strategyVersion: { id: "current", packageSha256: "b".repeat(64) } });
    client.topicalMapStrategyVersion.updateMany.mockResolvedValue({ count: 1 });
    client.topicalMapActivation.upsert.mockResolvedValue({ strategyVersionId: "historic" });
    client.auditLog.create.mockRejectedValue(new Error("audit unavailable"));
    db.$transaction.mockImplementation(async (fn: any) => fn(client));
    await expect(rollbackStrategyVersion({ siteHost: "agrikoph.com", versionId: "historic", actor: "operator" })).rejects.toThrow("audit unavailable");
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
  });
});
