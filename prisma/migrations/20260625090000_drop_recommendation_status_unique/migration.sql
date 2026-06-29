-- Drop unique constraint that blocked status transitions (pending→approved etc.)
-- when a prior approved/executed record existed for the same skill+entity combo.
-- Code-level dedup in run-skills.ts (findFirst check) is sufficient.
ALTER TABLE "Recommendation" DROP CONSTRAINT IF EXISTS "Recommendation_skillId_platform_actionType_targetEntityId_statu";
