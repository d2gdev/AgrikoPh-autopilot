-- Fix A: Replace NULL-unsafe unique constraint on CompetitorSocialPage(platform, pageId)
-- with a partial unique index that only applies when pageId IS NOT NULL.
-- Also add a plain index for query performance (covers both NULL and non-NULL rows).

DROP INDEX IF EXISTS "CompetitorSocialPage_platform_pageId_key";

CREATE INDEX IF NOT EXISTS "CompetitorSocialPage_platform_pageId_idx"
  ON "CompetitorSocialPage" (platform, "pageId");

CREATE UNIQUE INDEX IF NOT EXISTS "CompetitorSocialPage_platform_pageId_unique_notnull"
  ON "CompetitorSocialPage" (platform, "pageId")
  WHERE "pageId" IS NOT NULL;

-- Fix B: Add composite index on CompetitorAd(competitorId, capturedAt)
CREATE INDEX IF NOT EXISTS "CompetitorAd_competitorId_capturedAt_idx"
  ON "CompetitorAd" ("competitorId", "capturedAt");

-- Fix C: Add index on MarketInsight.adId
CREATE INDEX IF NOT EXISTS "MarketInsight_adId_idx"
  ON "MarketInsight" ("adId");

-- Fix D: Make ShoppingResult.marketKeywordId nullable with SetNull on delete
-- Change the NOT NULL column to nullable
ALTER TABLE "ShoppingResult" ALTER COLUMN "marketKeywordId" DROP NOT NULL;

-- Drop the existing Cascade FK and replace with SetNull
ALTER TABLE "ShoppingResult" DROP CONSTRAINT IF EXISTS "ShoppingResult_marketKeywordId_fkey";

ALTER TABLE "ShoppingResult"
  ADD CONSTRAINT "ShoppingResult_marketKeywordId_fkey"
  FOREIGN KEY ("marketKeywordId")
  REFERENCES "MarketKeyword"(id)
  ON DELETE SET NULL ON UPDATE CASCADE;
