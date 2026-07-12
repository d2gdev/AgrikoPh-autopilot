-- Expand-only storage for the complete deterministic validation report. It is
-- nullable so historical Task 1 rows remain readable without fabrication.
ALTER TABLE "TopicalMapStrategyVersion"
  ADD COLUMN "validationReport" JSONB;
