import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

const url = process.env.DATABASE_URL_TEST;
const parsed = url ? new URL(url) : null;
const safe = Boolean(parsed &&
  ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) &&
  parsed.pathname.slice(1) === "autopilot_test");

if (url && !safe) {
  throw new Error("DATABASE_URL_TEST must point to the guarded local autopilot_test database");
}

function packageData(suffix: string, lifecycle = "validated") {
  return {
    siteHost: `strategy-${suffix}.test`,
    packageId: `package-${suffix}`,
    strategyVersion: "2026-07-11",
    packageSha256: `a${suffix.padEnd(63, "0").slice(0, 63)}`,
    evidenceDate: new Date("2026-07-11T00:00:00.000Z"),
    provenance: { source: "postgres-test" },
    compatibility: { runtimeSchema: "1.0.0" },
    manifest: { packageId: `package-${suffix}` },
    lifecycle,
  };
}

describe.skipIf(!url)("PostgreSQL topical-map strategy persistence", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it("rejects duplicate content-addressed package identity and immutable artifact updates", async () => {
    const suffix = `${Date.now()}a`;
    const version = await prisma.topicalMapStrategyVersion.create({ data: packageData(suffix) });

    await expect(prisma.topicalMapStrategyVersion.create({
      data: { ...packageData(`${suffix}b`), siteHost: version.siteHost, packageSha256: version.packageSha256 },
    })).rejects.toMatchObject({ code: "P2002" });

    const artifact = await prisma.topicalMapStrategyArtifact.create({
      data: {
        strategyVersionId: version.id,
        artifactId: "map",
        path: "agriko-topical-map.md",
        mediaType: "text/markdown",
        sha256: "b".repeat(64),
        byteLength: 4,
        rawContent: "map\n",
        metadata: { required: true },
      },
    });

    await expect(prisma.topicalMapStrategyArtifact.update({
      where: { id: artifact.id },
      data: { rawContent: "changed\n" },
    })).rejects.toBeTruthy();
  });

  it("rejects an activation that references a missing, cross-site, draft, or rejected version", async () => {
    const suffix = `${Date.now()}b`;
    const rejected = await prisma.topicalMapStrategyVersion.create({ data: packageData(suffix, "rejected") });
    const draft = await prisma.topicalMapStrategyVersion.create({ data: packageData(`${suffix}d`, "draft") });
    const valid = await prisma.topicalMapStrategyVersion.create({ data: packageData(`${suffix}v`) });

    await expect(prisma.topicalMapActivation.create({
      data: {
        siteHost: rejected.siteHost,
        strategyVersionId: rejected.id,
        activatedBy: "postgres-test",
      },
    })).rejects.toBeTruthy();

    await expect(prisma.topicalMapActivation.create({
      data: {
        siteHost: draft.siteHost,
        strategyVersionId: draft.id,
        activatedBy: "postgres-test",
      },
    })).rejects.toBeTruthy();

    await expect(prisma.topicalMapActivation.create({
      data: {
        siteHost: `other-site-${suffix}.test`,
        strategyVersionId: valid.id,
        activatedBy: "postgres-test",
      },
    })).rejects.toBeTruthy();

    await expect(prisma.topicalMapActivation.create({
      data: {
        siteHost: `missing-${suffix}.test`,
        strategyVersionId: "missing-strategy-version",
        activatedBy: "postgres-test",
      },
    })).rejects.toBeTruthy();
  });

  it("permits exactly one activation pointer per site and binds compliance to the package hash", async () => {
    const suffix = `${Date.now()}c`;
    const version = await prisma.topicalMapStrategyVersion.create({ data: packageData(suffix) });

    await prisma.topicalMapActivation.create({
      data: { siteHost: version.siteHost, strategyVersionId: version.id, activatedBy: "postgres-test" },
    });
    await expect(prisma.topicalMapActivation.create({
      data: { siteHost: version.siteHost, strategyVersionId: version.id, activatedBy: "postgres-test" },
    })).rejects.toMatchObject({ code: "P2002" });

    await prisma.topicalMapProposalCompliance.create({
      data: {
        strategyVersionId: version.id,
        packageSha256: version.packageSha256,
        entityType: "content_proposal",
        entityId: "unpersisted-candidate",
        proposalType: "content",
        result: "compliant",
        matchedRuleIds: ["rule-1"],
        evidence: { fresh: true },
        evidenceFreshness: { current: true },
        requiredGates: [],
        requiredApprovals: [],
        evaluatorSchemaVersion: "1.0.0",
      },
    });
    await expect(prisma.topicalMapProposalCompliance.create({
      data: {
        strategyVersionId: version.id,
        packageSha256: "c".repeat(64),
        entityType: "content_proposal",
        entityId: "invalid-package-binding",
        proposalType: "content",
        result: "blocked",
        matchedRuleIds: [],
        evidence: {},
        evidenceFreshness: {},
        requiredGates: [],
        requiredApprovals: [],
        evaluatorSchemaVersion: "1.0.0",
      },
    })).rejects.toBeTruthy();
  });
});
