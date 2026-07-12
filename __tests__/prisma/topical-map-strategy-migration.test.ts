import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = "prisma/migrations/20260712090000_add_topical_map_strategy_package/migration.sql";

describe("topical-map strategy-package persistence migration", () => {
  it("defines all immutable strategy persistence models and required traceability fields", async () => {
    const schema = await readFile(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");

    for (const model of [
      "TopicalMapStrategyVersion",
      "TopicalMapStrategyArtifact",
      "TopicalMapValidationIssue",
      "TopicalMapCompiledRule",
      "TopicalMapActivation",
      "TopicalMapProposalCompliance",
    ]) {
      expect(schema).toMatch(new RegExp(`model\\s+${model}\\s+\\{`));
    }

    expect(schema).toContain("@@unique([siteHost, packageSha256])");
    expect(schema).toContain("sourceArtifactId");
    expect(schema).toContain("sourceLocator");
    expect(schema).toContain("matchedRuleIds");
    expect(schema).toContain("evidence");
    expect(schema).toContain("requiredGates");
    expect(schema).toContain("contentProposalId");
    expect(schema).toContain("recommendationId");
  });

  it("uses an expand-only migration with database-enforced identity and activation integrity", async () => {
    const sql = await readFile(resolve(process.cwd(), migrationPath), "utf8");

    expect(sql).toContain('CREATE TABLE "TopicalMapStrategyVersion"');
    expect(sql).toContain('CREATE TABLE "TopicalMapStrategyArtifact"');
    expect(sql).toContain('CREATE TABLE "TopicalMapValidationIssue"');
    expect(sql).toContain('CREATE TABLE "TopicalMapCompiledRule"');
    expect(sql).toContain('CREATE TABLE "TopicalMapActivation"');
    expect(sql).toContain('CREATE TABLE "TopicalMapProposalCompliance"');
    expect(sql).toContain('UNIQUE ("siteHost", "packageSha256")');
    expect(sql).toContain('UNIQUE ("id", "siteHost")');
    expect(sql).toContain('UNIQUE ("id", "packageSha256")');
    expect(sql).toContain('UNIQUE ("siteHost")');
    expect(sql).toContain('REFERENCES "TopicalMapStrategyVersion" ("id", "siteHost")');
    expect(sql).toContain('REFERENCES "TopicalMapStrategyVersion" ("id", "packageSha256")');
    expect(sql).toContain('topical_map_activation_requires_validated_version');
    expect(sql).toContain('topical_map_strategy_version_identity_immutable');
    expect(sql).toContain('topical_map_strategy_artifact_immutable');
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+"(?:ContentProposal|Recommendation)"/i);
  });

  it("adds a nullable lossless validation report without weakening the original immutable contract", async () => {
    const schema = await readFile(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    const sql = await readFile(resolve(process.cwd(), "prisma/migrations/20260712100000_add_topical_map_validation_report/migration.sql"), "utf8");

    expect(schema).toContain("validationReport      Json?");
    expect(sql).toContain('ADD COLUMN "validationReport" JSONB');
    expect(sql).not.toMatch(/\bDROP\b/i);
  });
});
