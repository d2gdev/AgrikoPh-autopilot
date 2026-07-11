-- Expand-only persistence for complete topical-map strategy packages. Existing
-- application rows are neither rewritten nor used as a source of strategy data.
CREATE TABLE "TopicalMapStrategyVersion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "siteHost" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "strategyVersion" TEXT NOT NULL,
    "packageSha256" TEXT NOT NULL,
    "evidenceDate" TIMESTAMP(3) NOT NULL,
    "provenance" JSONB NOT NULL,
    "compatibility" JSONB NOT NULL,
    "manifest" JSONB NOT NULL,
    "lifecycle" TEXT NOT NULL DEFAULT 'draft',
    "validationStatus" TEXT NOT NULL DEFAULT 'pending',
    "compiledAt" TIMESTAMP(3),
    "compiledSchemaVersion" TEXT,
    "validatedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "TopicalMapStrategyVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TopicalMapStrategyVersion_siteHost_packageSha256_key" UNIQUE ("siteHost", "packageSha256"),
    CONSTRAINT "TopicalMapStrategyVersion_id_siteHost_key" UNIQUE ("id", "siteHost"),
    CONSTRAINT "TopicalMapStrategyVersion_id_packageSha256_key" UNIQUE ("id", "packageSha256"),
    CONSTRAINT "TopicalMapStrategyVersion_lifecycle_check" CHECK ("lifecycle" IN ('draft', 'validated', 'active', 'superseded', 'rolled_back', 'rejected'))
);

CREATE TABLE "TopicalMapStrategyArtifact" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "strategyVersionId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "rawContent" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "TopicalMapStrategyArtifact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TopicalMapStrategyArtifact_strategyVersionId_artifactId_key" UNIQUE ("strategyVersionId", "artifactId"),
    CONSTRAINT "TopicalMapStrategyArtifact_strategyVersionId_path_key" UNIQUE ("strategyVersionId", "path")
);

CREATE TABLE "TopicalMapValidationIssue" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "strategyVersionId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "sourceArtifactId" TEXT,
    "sourceLocator" TEXT,
    "ruleId" TEXT,
    "details" JSONB,

    CONSTRAINT "TopicalMapValidationIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TopicalMapCompiledRule" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "strategyVersionId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "sourceArtifactId" TEXT NOT NULL,
    "sourceLocator" TEXT NOT NULL,
    "compiledPayload" JSONB NOT NULL,

    CONSTRAINT "TopicalMapCompiledRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TopicalMapCompiledRule_strategyVersionId_ruleId_key" UNIQUE ("strategyVersionId", "ruleId")
);

CREATE TABLE "TopicalMapActivation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "siteHost" TEXT NOT NULL,
    "strategyVersionId" TEXT NOT NULL,
    "activatedBy" TEXT NOT NULL,
    "activationReason" TEXT,

    CONSTRAINT "TopicalMapActivation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TopicalMapActivation_siteHost_key" UNIQUE ("siteHost")
);

CREATE TABLE "TopicalMapProposalCompliance" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "strategyVersionId" TEXT NOT NULL,
    "packageSha256" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "proposalType" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "matchedRuleIds" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "evidenceFreshness" JSONB NOT NULL,
    "requiredGates" JSONB NOT NULL,
    "requiredApprovals" JSONB NOT NULL,
    "evaluatorSchemaVersion" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentProposalId" TEXT,
    "recommendationId" TEXT,

    CONSTRAINT "TopicalMapProposalCompliance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TopicalMapStrategyVersion_siteHost_lifecycle_idx" ON "TopicalMapStrategyVersion"("siteHost", "lifecycle");
CREATE INDEX "TopicalMapStrategyVersion_packageSha256_idx" ON "TopicalMapStrategyVersion"("packageSha256");
CREATE INDEX "TopicalMapStrategyVersion_strategyVersion_idx" ON "TopicalMapStrategyVersion"("strategyVersion");
CREATE INDEX "TopicalMapStrategyArtifact_sha256_idx" ON "TopicalMapStrategyArtifact"("sha256");
CREATE INDEX "TopicalMapValidationIssue_strategyVersionId_severity_idx" ON "TopicalMapValidationIssue"("strategyVersionId", "severity");
CREATE INDEX "TopicalMapValidationIssue_code_idx" ON "TopicalMapValidationIssue"("code");
CREATE INDEX "TopicalMapValidationIssue_sourceArtifactId_idx" ON "TopicalMapValidationIssue"("sourceArtifactId");
CREATE INDEX "TopicalMapCompiledRule_strategyVersionId_ruleType_idx" ON "TopicalMapCompiledRule"("strategyVersionId", "ruleType");
CREATE INDEX "TopicalMapCompiledRule_sourceArtifactId_idx" ON "TopicalMapCompiledRule"("sourceArtifactId");
CREATE INDEX "TopicalMapActivation_strategyVersionId_idx" ON "TopicalMapActivation"("strategyVersionId");
CREATE INDEX "TopicalMapProposalCompliance_strategyVersionId_idx" ON "TopicalMapProposalCompliance"("strategyVersionId");
CREATE INDEX "TopicalMapProposalCompliance_packageSha256_idx" ON "TopicalMapProposalCompliance"("packageSha256");
CREATE INDEX "TopicalMapProposalCompliance_entityType_entityId_idx" ON "TopicalMapProposalCompliance"("entityType", "entityId");
CREATE INDEX "TopicalMapProposalCompliance_contentProposalId_idx" ON "TopicalMapProposalCompliance"("contentProposalId");
CREATE INDEX "TopicalMapProposalCompliance_recommendationId_idx" ON "TopicalMapProposalCompliance"("recommendationId");
CREATE INDEX "TopicalMapProposalCompliance_result_idx" ON "TopicalMapProposalCompliance"("result");

ALTER TABLE "TopicalMapStrategyArtifact"
  ADD CONSTRAINT "TopicalMapStrategyArtifact_strategyVersionId_fkey"
  FOREIGN KEY ("strategyVersionId") REFERENCES "TopicalMapStrategyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TopicalMapValidationIssue"
  ADD CONSTRAINT "TopicalMapValidationIssue_strategyVersionId_fkey"
  FOREIGN KEY ("strategyVersionId") REFERENCES "TopicalMapStrategyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicalMapCompiledRule"
  ADD CONSTRAINT "TopicalMapCompiledRule_strategyVersionId_fkey"
  FOREIGN KEY ("strategyVersionId") REFERENCES "TopicalMapStrategyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TopicalMapCompiledRule"
  ADD CONSTRAINT "TopicalMapCompiledRule_strategyVersionId_sourceArtifactId_fkey"
  FOREIGN KEY ("strategyVersionId", "sourceArtifactId") REFERENCES "TopicalMapStrategyArtifact"("strategyVersionId", "artifactId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TopicalMapActivation"
  ADD CONSTRAINT "TopicalMapActivation_strategyVersionId_siteHost_fkey"
  FOREIGN KEY ("strategyVersionId", "siteHost") REFERENCES "TopicalMapStrategyVersion" ("id", "siteHost") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TopicalMapProposalCompliance"
  ADD CONSTRAINT "TopicalMapProposalCompliance_strategyVersionId_packageSha256_fkey"
  FOREIGN KEY ("strategyVersionId", "packageSha256") REFERENCES "TopicalMapStrategyVersion" ("id", "packageSha256") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TopicalMapProposalCompliance"
  ADD CONSTRAINT "TopicalMapProposalCompliance_contentProposalId_fkey"
  FOREIGN KEY ("contentProposalId") REFERENCES "ContentProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TopicalMapProposalCompliance"
  ADD CONSTRAINT "TopicalMapProposalCompliance_recommendationId_fkey"
  FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Package bytes and their metadata are immutable. The lifecycle is intentionally
-- excluded: later activation work is allowed to transition only that state.
CREATE OR REPLACE FUNCTION topical_map_strategy_version_identity_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."siteHost" IS DISTINCT FROM OLD."siteHost"
     OR NEW."packageId" IS DISTINCT FROM OLD."packageId"
     OR NEW."strategyVersion" IS DISTINCT FROM OLD."strategyVersion"
     OR NEW."packageSha256" IS DISTINCT FROM OLD."packageSha256"
     OR NEW."evidenceDate" IS DISTINCT FROM OLD."evidenceDate"
     OR NEW."provenance" IS DISTINCT FROM OLD."provenance"
     OR NEW."compatibility" IS DISTINCT FROM OLD."compatibility"
     OR NEW."manifest" IS DISTINCT FROM OLD."manifest"
     OR NEW."compiledAt" IS DISTINCT FROM OLD."compiledAt"
     OR NEW."compiledSchemaVersion" IS DISTINCT FROM OLD."compiledSchemaVersion" THEN
    RAISE EXCEPTION 'topical map strategy package identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER topical_map_strategy_version_identity_immutable
BEFORE UPDATE ON "TopicalMapStrategyVersion"
FOR EACH ROW EXECUTE FUNCTION topical_map_strategy_version_identity_immutable();

CREATE OR REPLACE FUNCTION topical_map_strategy_artifact_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'topical map strategy artifacts are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER topical_map_strategy_artifact_immutable
BEFORE UPDATE OR DELETE ON "TopicalMapStrategyArtifact"
FOR EACH ROW EXECUTE FUNCTION topical_map_strategy_artifact_immutable();

CREATE OR REPLACE FUNCTION topical_map_compiled_rule_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'topical map compiled rules are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER topical_map_compiled_rule_immutable
BEFORE UPDATE OR DELETE ON "TopicalMapCompiledRule"
FOR EACH ROW EXECUTE FUNCTION topical_map_compiled_rule_immutable();

-- A FK proves that a version exists; this trigger additionally proves it is a
-- complete, activation-eligible version. PostgreSQL cannot express that
-- lifecycle predicate with a foreign key alone.
CREATE OR REPLACE FUNCTION topical_map_activation_requires_validated_version()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "TopicalMapStrategyVersion"
    WHERE "id" = NEW."strategyVersionId"
      AND "siteHost" = NEW."siteHost"
      AND "lifecycle" IN ('validated', 'active')
  ) THEN
    RAISE EXCEPTION 'topical map activation requires a validated strategy version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER topical_map_activation_requires_validated_version
BEFORE INSERT OR UPDATE ON "TopicalMapActivation"
FOR EACH ROW EXECUTE FUNCTION topical_map_activation_requires_validated_version();
