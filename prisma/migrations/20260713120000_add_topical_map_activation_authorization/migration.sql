-- Persist the reviewed contract's activation projection. Defaults keep every
-- historical package unauthorized unless explicitly backfilled below.
ALTER TABLE "TopicalMapStrategyVersion"
  ADD COLUMN "contractRevision" INTEGER,
  ADD COLUMN "activationEligible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "runtimeActivationAuthorized" BOOLEAN NOT NULL DEFAULT false;

-- Preserve coherence for the sole already-reviewed revision-3 production
-- package. Runtime activation remains content-agnostic and uses these columns.
UPDATE "TopicalMapStrategyVersion"
SET "contractRevision" = 3,
    "activationEligible" = true,
    "runtimeActivationAuthorized" = true
WHERE "packageSha256" = 'f2a39fabd27a1dcb7ffb29e44695d18a39325186443137dd15762126a8d1bf1c';
