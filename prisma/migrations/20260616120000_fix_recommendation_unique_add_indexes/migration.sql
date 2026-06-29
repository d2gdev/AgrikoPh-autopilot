-- Fix H-6: Replace Recommendation unique constraint to include skillId
-- This allows different skills to independently recommend the same action on the same entity

-- Step 1: Remove old constraint (without skillId)
ALTER TABLE "Recommendation" DROP CONSTRAINT IF EXISTS "Recommendation_platform_actionType_targetEntityId_status_key";

-- Step 2: Deduplicate rows that would violate the new constraint.
-- Keep the most recent row (highest createdAt) for each duplicate group.
DELETE FROM "Recommendation"
WHERE id NOT IN (
  SELECT DISTINCT ON ("skillId", platform, "actionType", "targetEntityId", status)
    id
  FROM "Recommendation"
  ORDER BY "skillId", platform, "actionType", "targetEntityId", status, "createdAt" DESC
);

-- Step 3: Add new unique constraint including skillId
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_skillId_platform_actionType_targetEntityId_status_key" UNIQUE ("skillId", "platform", "actionType", "targetEntityId", "status");

-- Fix M-8: Add contentHash index to ArticleRecord for fast duplicate detection
CREATE INDEX IF NOT EXISTS "ArticleRecord_contentHash_idx" ON "ArticleRecord"("contentHash");
