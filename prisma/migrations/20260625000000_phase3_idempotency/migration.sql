-- AlterTable: Add productIdentityHash to ShoppingResult
ALTER TABLE "ShoppingResult" ADD COLUMN IF NOT EXISTS "productIdentityHash" TEXT;

-- AlterTable: Add captureDate to ShoppingResult (day-truncated capturedAt)
ALTER TABLE "ShoppingResult" ADD COLUMN IF NOT EXISTS "captureDate" TIMESTAMP(3);
UPDATE "ShoppingResult" SET "captureDate" = DATE_TRUNC('day', "capturedAt") WHERE "captureDate" IS NULL;
ALTER TABLE "ShoppingResult" ALTER COLUMN "captureDate" SET DEFAULT date_trunc('day', CURRENT_TIMESTAMP);
ALTER TABLE "ShoppingResult" ALTER COLUMN "captureDate" SET NOT NULL;

-- CreateIndex: productIdentityHash index on ShoppingResult
CREATE INDEX IF NOT EXISTS "ShoppingResult_productIdentityHash_idx" ON "ShoppingResult"("productIdentityHash");

-- Drop stale ShoppingResult unique index if it exists
DROP INDEX IF EXISTS "ShoppingResult_captureDate_dedupe_key";

-- Remove duplicate ShoppingResult rows before adding constraint
DELETE FROM "ShoppingResult"
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY "keyword", "productKey", "captureDate"
             ORDER BY "createdAt" DESC
           ) AS rn
    FROM "ShoppingResult"
  ) ranked
  WHERE rn > 1
);

-- Add unique constraint for ShoppingResult
CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingResult_captureDate_dedupe_key"
  ON "ShoppingResult" ("keyword", "productKey", "captureDate");

-- AlterTable: Add captureDate to ShoppingPriceHistory (day-truncated capturedAt)
ALTER TABLE "ShoppingPriceHistory" ADD COLUMN IF NOT EXISTS "captureDate" TIMESTAMP(3);
UPDATE "ShoppingPriceHistory" SET "captureDate" = DATE_TRUNC('day', "capturedAt") WHERE "captureDate" IS NULL;
ALTER TABLE "ShoppingPriceHistory" ALTER COLUMN "captureDate" SET DEFAULT date_trunc('day', CURRENT_TIMESTAMP);
ALTER TABLE "ShoppingPriceHistory" ALTER COLUMN "captureDate" SET NOT NULL;

-- AlterTable: Add contextKey to ShoppingPriceHistory
ALTER TABLE "ShoppingPriceHistory" ADD COLUMN IF NOT EXISTS "contextKey" TEXT NOT NULL DEFAULT '';

-- AlterTable: Add dedupeKey to MarketInsight
ALTER TABLE "MarketInsight" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT NOT NULL DEFAULT '';

-- CreateIndex: contextKey index on ShoppingPriceHistory
CREATE INDEX IF NOT EXISTS "ShoppingPriceHistory_contextKey_capturedAt_idx" ON "ShoppingPriceHistory"("contextKey", "capturedAt");

-- Backfill contextKey for ShoppingPriceHistory
UPDATE "ShoppingPriceHistory"
SET "contextKey" = CASE
  WHEN "marketKeywordId" IS NOT NULL THEN 'market:' || "marketKeywordId"
  WHEN "competitorId" IS NOT NULL THEN 'competitor:' || "competitorId"
  ELSE 'unknown'
END
WHERE "contextKey" = '';

-- Remove duplicate ShoppingPriceHistory rows before adding constraint
DELETE FROM "ShoppingPriceHistory"
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY "productKey", "captureDate", "contextKey"
             ORDER BY "createdAt" DESC
           ) AS rn
    FROM "ShoppingPriceHistory"
  ) ranked
  WHERE rn > 1
);

-- Drop old unique constraint on ShoppingPriceHistory
DROP INDEX IF EXISTS "ShoppingPriceHistory_captureDate_dedupe_key";

-- Add new unique constraint with contextKey
CREATE UNIQUE INDEX "ShoppingPriceHistory_captureDate_dedupe_key" ON "ShoppingPriceHistory"("productKey", "captureDate", "contextKey");

-- Backfill dedupeKey for MarketInsight
UPDATE "MarketInsight"
SET "dedupeKey" = CONCAT(
  type, '|',
  COALESCE("competitorId", ''), '|',
  COALESCE("keywordId", ''), '|',
  COALESCE("adId", ''), '|',
  TO_CHAR(DATE("createdAt"), 'YYYY-MM-DD')
)
WHERE "dedupeKey" = '';

-- Remove duplicate MarketInsight rows before adding constraint
DELETE FROM "MarketInsight"
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY "dedupeKey"
             ORDER BY "createdAt" DESC
           ) AS rn
    FROM "MarketInsight"
  ) ranked
  WHERE rn > 1
);

-- Add unique constraint on MarketInsight.dedupeKey
CREATE UNIQUE INDEX IF NOT EXISTS "MarketInsight_dedupe_key" ON "MarketInsight"("dedupeKey");
