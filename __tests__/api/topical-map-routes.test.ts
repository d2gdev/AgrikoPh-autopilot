import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { StrategyPackageError } from "@/lib/topical-map/manifest";
import { StrategyActivationConflictError } from "@/lib/topical-map/activation";

const auth = vi.hoisted(() => ({
  requireAppAuth: vi.fn(),
  requirePermission: vi.fn(),
  getSessionUser: vi.fn(),
}));
const reader = vi.hoisted(() => vi.fn());
const services = vi.hoisted(() => ({
    importAndValidatePackage: vi.fn(),
    activateStrategyVersion: vi.fn(),
    rollbackStrategyVersion: vi.fn(),
  }));
const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  topicalMapStrategyVersion: { findUnique: vi.fn(), updateMany: vi.fn() },
  topicalMapActivation: { findUnique: vi.fn(), upsert: vi.fn() },
  auditLog: { create: vi.fn() },
}));
const db = vi.hoisted(() => ({
  $transaction: vi.fn(), auditLog: { findMany: vi.fn() },
  topicalMapStrategyVersion: { findMany: vi.fn(), findUnique: vi.fn() },
  topicalMapActivation: { findUnique: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: { SETTINGS_ADMIN: "settings:admin" },
  requireAppAuth: auth.requireAppAuth,
  requirePermission: auth.requirePermission,
  getSessionUser: auth.getSessionUser,
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/topical-map/package-reader", () => ({ readStrategyPackage: reader }));
vi.mock("@/lib/topical-map/activation", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/topical-map/activation")>(),
  importAndValidatePackage: services.importAndValidatePackage,
  activateStrategyVersion: services.activateStrategyVersion,
  rollbackStrategyVersion: services.rollbackStrategyVersion,
}));

const imports = () => import("@/app/api/topical-map/packages/route");
const detail = () => import("@/app/api/topical-map/packages/[id]/route");
const activate = () => import("@/app/api/topical-map/packages/[id]/activate/route");
const rollback = () => import("@/app/api/topical-map/packages/[id]/rollback/route");
const req = (path: string, body?: string) => new Request(`http://test.local${path}`, { method: "POST", ...(body === undefined ? {} : { body }) });
const params = (id = "version-a") => ({ params: Promise.resolve({ id }) });

function boundaryCalls() {
  return [
    reader,
    services.importAndValidatePackage,
    services.activateStrategyVersion,
    services.rollbackStrategyVersion,
    db.topicalMapStrategyVersion.findMany,
    db.topicalMapStrategyVersion.findUnique,
    db.topicalMapActivation.findUnique,
    db.auditLog.findMany,
    db.$transaction,
    tx.auditLog.create,
  ].reduce((count, fn) => count + fn.mock.calls.length, 0);
}

function expectNoBoundaries() {
  expect(boundaryCalls()).toBe(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TOPICAL_MAP_STRATEGY_ROOT", "/isolated/package");
  auth.requireAppAuth.mockResolvedValue(null);
  auth.requirePermission.mockResolvedValue(null);
  auth.getSessionUser.mockResolvedValue("operator-1");
  db.$transaction.mockImplementation(async (run) => run(tx));
  db.auditLog.findMany.mockResolvedValue([]);
});

afterEach(() => vi.unstubAllEnvs());

describe("topical-map package operator routes", () => {
  const mutations: Array<[string, () => Promise<Response>]> = [
    ["import", async () => (await imports()).POST(req("/packages"))],
    ["activate", async () => (await activate()).POST(req("/packages/version-a/activate"), params())],
    ["rollback", async () => (await rollback()).POST(req("/packages/version-a/rollback"), params())],
  ];

  it.each(mutations)("returns 401 before all boundaries for unauthenticated %s", async (_name, invoke) => {
    auth.requireAppAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const response = await invoke();

    expect(response.status).toBe(401);
    expect(auth.requirePermission).not.toHaveBeenCalled();
    expectNoBoundaries();
  });

  it.each(mutations)("returns 403 after auth but before all boundaries for forbidden %s", async (_name, invoke) => {
    auth.requirePermission.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));

    const response = await invoke();

    expect(response.status).toBe(403);
    expect(auth.requireAppAuth.mock.invocationCallOrder[0]).toBeLessThan(auth.requirePermission.mock.invocationCallOrder[0]!);
    expectNoBoundaries();
  });

  it("imports only from the configured root with a server-generated UTC freshness timestamp", async () => {
    const rawPackage = { packageSha256: "a".repeat(64) };
    reader.mockResolvedValue(rawPackage);
    services.importAndValidatePackage.mockResolvedValue({ id: "version-a", idempotent: false, lifecycle: "validated" });

    const response = await (await imports()).POST(req("/packages"));

    expect(response.status).toBe(201);
    expect(reader).toHaveBeenCalledWith("/isolated/package");
    expect(services.importAndValidatePackage).toHaveBeenCalledWith(expect.objectContaining({ rawPackage, asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/) }));
    expect(await response.json()).toEqual(expect.objectContaining({ id: "version-a" }));
  });

  it("returns 200 for a same-hash idempotent import", async () => {
    reader.mockResolvedValue({ packageSha256: "a".repeat(64) });
    services.importAndValidatePackage.mockResolvedValue({ id: "version-a", idempotent: true });

    const response = await (await imports()).POST(req("/packages"));

    expect(response.status).toBe(200);
  });

  it("fails safely without reading a package when the configured root is absent", async () => {
    vi.stubEnv("TOPICAL_MAP_STRATEGY_ROOT", "");

    const response = await (await imports()).POST(req("/packages"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Strategy package service is unavailable." });
    expectNoBoundaries();
  });

  it("maps known package validation failures to a typed safe 422", async () => {
    reader.mockRejectedValue(new StrategyPackageError("HASH_MISMATCH", "raw bytes must not leak"));

    const response = await (await imports()).POST(req("/packages"));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Invalid strategy package.", code: "HASH_MISMATCH" });
  });

  it("returns only projected inspection fields and never artifact source bytes", async () => {
    db.topicalMapStrategyVersion.findMany.mockResolvedValue([{ id: "version-a", packageId: "package-a", strategyVersion: "2026-07-12", packageSha256: "a".repeat(64), lifecycle: "validated", validationStatus: "valid", evidenceDate: new Date("2026-07-11T00:00:00.000Z"), createdAt: new Date("2026-07-12T00:00:00.000Z"), validatedAt: new Date("2026-07-12T00:00:00.000Z"), activatedAt: null, validationReport: { valid: true, evidenceFreshness: [{ gateId: "gate-a", ruleId: "rule-a", mandatory: true, status: "current", maxAgeDays: 180, ageDays: 1, blockingReason: null }] }, artifacts: [{ artifactId: "map", sha256: "b".repeat(64), byteLength: 10, mediaType: "text/markdown", metadata: { required: true } }], validationIssues: [{ code: "NONE", blocking: false, severity: "warning", ruleId: null, sourceArtifactId: null }], proposalCompliances: [{ result: "conflict", matchedRuleIds: ["rule-a"], evidenceFreshness: [], requiredGates: ["gate-a"] }], _count: { compiledRules: 4 } }]);
    db.topicalMapActivation.findUnique.mockResolvedValue({ strategyVersionId: "version-a" });

    const response = await (await imports()).GET(new Request("http://test.local/packages"));

    expect(response.status).toBe(200);
    expect(db.topicalMapStrategyVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.any(Object) }));
    const body = await response.json();
    expect(body.activeVersionId).toBe("version-a");
    expect(JSON.stringify(body)).not.toContain("rawContent");
    expect(JSON.stringify(body)).not.toContain("validationReport");
    expect(JSON.stringify(body)).not.toContain("compiledPayload");
    expect(body.packages[0]).toMatchObject({ compiledRuleCount: 4, evidenceGates: [{ gateId: "gate-a" }], compliance: { counts: { conflict: 1 } }, lifecycleControls: { canActivate: false, canRollback: false } });
    expect(JSON.stringify(db.topicalMapStrategyVersion.findMany.mock.calls[0]![0])).not.toContain("rawContent");
  });

  it("returns 404 for an absent inspected version", async () => {
    db.topicalMapStrategyVersion.findUnique.mockResolvedValue(null);

    const response = await (await detail()).GET(new Request("http://test.local/packages/missing"), params("missing"));

    expect(response.status).toBe(404);
  });

  it("fails closed before the activation transaction while runtime authorization is false", async () => {
    const actual = await vi.importActual<typeof import("@/lib/topical-map/activation")>("@/lib/topical-map/activation");
    services.activateStrategyVersion.mockImplementation(actual.activateStrategyVersion);
    db.topicalMapActivation.findUnique.mockResolvedValue(null);
    tx.topicalMapStrategyVersion.findUnique.mockResolvedValue({ id: "version-a", siteHost: "agrikoph.com", lifecycle: "validated", validationStatus: "valid", activationEligible: true, runtimeActivationAuthorized: true, packageSha256: "a".repeat(64) });
    tx.topicalMapActivation.findUnique.mockResolvedValue(null);
    tx.topicalMapStrategyVersion.updateMany.mockResolvedValue({ count: 1 });

    const response = await (await activate()).POST(req("/packages/version-a/activate", JSON.stringify({ reason: "reviewed" })), params());

    expect(response.status).toBe(409);
    expect(services.activateStrategyVersion).toHaveBeenCalledWith({ versionId: "version-a", siteHost: "agrikoph.com", actor: "operator-1", reason: "reviewed" });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("keeps auth and permission first before an enabled activation reaches the lifecycle transaction", async () => {
    vi.stubEnv("TOPICAL_MAP_ACTIVATION_ENABLED", "true");
    const actual = await vi.importActual<typeof import("@/lib/topical-map/activation")>("@/lib/topical-map/activation");
    services.activateStrategyVersion.mockImplementation(actual.activateStrategyVersion);
    db.topicalMapActivation.findUnique.mockResolvedValue(null);
    tx.topicalMapStrategyVersion.findUnique.mockResolvedValue({ id: "version-a", siteHost: "agrikoph.com", lifecycle: "validated", validationStatus: "valid", activationEligible: true, runtimeActivationAuthorized: true, packageSha256: "a".repeat(64) });
    tx.topicalMapActivation.findUnique.mockResolvedValue(null);
    tx.topicalMapStrategyVersion.updateMany.mockResolvedValue({ count: 1 });
    tx.topicalMapActivation.upsert.mockResolvedValue({ strategyVersionId: "version-a" });

    const response = await (await activate()).POST(req("/packages/version-a/activate", JSON.stringify({ reason: "reviewed" })), params());

    expect(response.status).toBe(200);
    expect(auth.requireAppAuth.mock.invocationCallOrder[0]).toBeLessThan(auth.requirePermission.mock.invocationCallOrder[0]!);
    expect(auth.requirePermission.mock.invocationCallOrder[0]).toBeLessThan(db.topicalMapActivation.findUnique.mock.invocationCallOrder[0]!);
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });

  it("accepts an empty activation body and maps lifecycle conflicts to 409", async () => {
    services.activateStrategyVersion.mockRejectedValue(new StrategyActivationConflictError());

    const response = await (await activate()).POST(req("/packages/version-a/activate", ""), params());

    expect(response.status).toBe(409);
    expect(services.activateStrategyVersion).toHaveBeenCalledWith(expect.not.objectContaining({ reason: expect.anything() }));
  });

  it("rejects malformed or overlong rollback reasons before its service boundary", async () => {
    const malformed = await (await rollback()).POST(req("/packages/version-a/rollback", "{"), params());
    const overlong = await (await rollback()).POST(req("/packages/version-a/rollback", JSON.stringify({ reason: "x".repeat(501) })), params());

    expect(malformed.status).toBe(400);
    expect(overlong.status).toBe(400);
    expect(services.rollbackStrategyVersion).not.toHaveBeenCalled();
  });
});
