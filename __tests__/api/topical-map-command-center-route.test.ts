import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { ALL_TOPICAL_MAP_DOMAINS } from "@/lib/topical-map/command-center";

const auth = vi.hoisted(() => ({ requireAppAuth: vi.fn() }));
const db = vi.hoisted(() => ({ topicalMapActivation: { findUnique: vi.fn() } }));

vi.mock("@/lib/auth", () => ({ requireAppAuth: auth.requireAppAuth }));
vi.mock("@/lib/db", () => ({ prisma: db }));

const route = () => import("@/app/api/topical-map/command-center/route");
const request = () => new Request("http://test.local/api/topical-map/command-center");
const sourceReferences = [{ coverageUnitId: "unit-1", artifactId: "artifact-1", locator: { kind: "csv_row", businessKey: "key", headerFingerprint: "header", rowFingerprint: "row", rowNumber: 2 } }];
const activeStrategy = (overrides: Record<string, unknown> = {}) => ({
  id: "v3", strategyVersion: "revision-3", contractRevision: 3, packageSha256: "a".repeat(64), activatedAt: new Date("2026-07-13T00:00:00.000Z"),
  lifecycle: "active", validationStatus: "valid",
  compiledRules: ALL_TOPICAL_MAP_DOMAINS.map((ruleType, index) => ({ ruleId: `rule-${index}`, ruleType, sourceArtifactId: "artifact-1", compiledPayload: { payload: {}, sourceReferences, resolutionStatus: "resolved", conditions: [], evidenceRequirements: [], reviewRequirements: [] } })),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireAppAuth.mockResolvedValue(null);
});

describe("GET /api/topical-map/command-center", () => {
  it("authenticates before Prisma and stops unauthenticated requests at that boundary", async () => {
    auth.requireAppAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const response = await (await route()).GET(request());

    expect(response.status).toBe(401);
    expect(auth.requireAppAuth).toHaveBeenCalledOnce();
    expect(db.topicalMapActivation.findUnique).not.toHaveBeenCalled();
  });

  it("returns a private no-active-strategy projection", async () => {
    db.topicalMapActivation.findUnique.mockResolvedValue(null);

    const response = await (await route()).GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ state: "no_active_strategy", generatedAt: expect.any(String), commandCenter: null });
    expect(auth.requireAppAuth.mock.invocationCallOrder[0]).toBeLessThan(db.topicalMapActivation.findUnique.mock.invocationCallOrder[0]!);
  });

  it("returns a bounded JSON error when the database fails", async () => {
    db.topicalMapActivation.findUnique.mockRejectedValue(new Error("postgres credentials and query details must not leak"));

    const response = await (await route()).GET(request());

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ state: "unavailable", error: "Command center is unavailable." });
  });

  it.each([
    ["a stale lifecycle pointer", { lifecycle: "superseded" }],
    ["an invalid strategy", { validationStatus: "invalid" }],
  ])("fails closed for %s", async (_name, overrides) => {
    db.topicalMapActivation.findUnique.mockResolvedValue({ strategyVersion: activeStrategy(overrides) });

    const response = await (await route()).GET(request());

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ state: "unavailable", error: "Command center is unavailable." });
  });

  it("projects every domain from the exact bounded select and excludes unselected artifact fields from the response", async () => {
    db.topicalMapActivation.findUnique.mockResolvedValue({
      strategyVersion: activeStrategy(),
      artifacts: [{ rawContent: "secret source bytes" }],
    });

    const response = await (await route()).GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toEqual({ state: "ready", generatedAt: expect.any(String), commandCenter: expect.objectContaining({ identity: expect.objectContaining({ versionId: "v3" }) }) });
    expect(body.commandCenter.domainCounts).toEqual(Object.fromEntries(ALL_TOPICAL_MAP_DOMAINS.map((domain) => [domain, 1])));
    expect(JSON.stringify(body)).not.toContain("rawContent");
    expect(JSON.stringify(body)).not.toContain("secret source bytes");
    expect(db.topicalMapActivation.findUnique).toHaveBeenCalledWith({
      where: { siteHost: "agrikoph.com" },
      select: {
        strategyVersion: { select: {
          id: true, strategyVersion: true, contractRevision: true, packageSha256: true, activatedAt: true, lifecycle: true, validationStatus: true,
          compiledRules: { select: { ruleId: true, ruleType: true, sourceArtifactId: true, compiledPayload: true } },
        } },
      },
    });
  });
});
