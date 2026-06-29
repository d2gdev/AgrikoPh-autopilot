-- Enforce explicit idempotency keys used by application upsert paths.

-- ShoppingResult -------------------------------------------------------------------------------
ALTER TABLE "ShoppingResult"
  ADD COLUMN IF NOT EXISTS "captureDate" TIMESTAMP(3);

UPDATE "ShoppingResult"
SET "captureDate" = date_trunc('day', "capturedAt")
WHERE "captureDate" IS NULL;

ALTER TABLE "ShoppingResult"
  ALTER COLUMN "captureDate" SET DEFAULT date_trunc('day', CURRENT_TIMESTAMP),
  ALTER COLUMN "captureDate" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingResult_captureDate_dedupe_key"
  ON "ShoppingResult" ("keyword", "productKey", "captureDate");

-- ShoppingPriceHistory ------------------------------------------------------------------------
ALTER TABLE "ShoppingPriceHistory"
  ADD COLUMN IF NOT EXISTS "captureDate" TIMESTAMP(3);

UPDATE "ShoppingPriceHistory"
SET "captureDate" = date_trunc('day', "capturedAt")
WHERE "captureDate" IS NULL;

ALTER TABLE "ShoppingPriceHistory"
  ALTER COLUMN "captureDate" SET DEFAULT date_trunc('day', CURRENT_TIMESTAMP),
  ALTER COLUMN "captureDate" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingPriceHistory_captureDate_dedupe_key"
  ON "ShoppingPriceHistory" ("productKey", "captureDate");

-- KeywordResearchResult -----------------------------------------------------------------------
ALTER TABLE "KeywordResearchResult"
  ADD COLUMN IF NOT EXISTS "locationNameForDedupe" TEXT,
  ADD COLUMN IF NOT EXISTS "languageCodeForDedupe" TEXT,
  ADD COLUMN IF NOT EXISTS "captureDate" TIMESTAMP(3);

UPDATE "KeywordResearchResult"
SET
  "locationNameForDedupe" = COALESCE("locationName", ''),
  "languageCodeForDedupe" = COALESCE("languageCode", ''),
  "captureDate" = date_trunc('day', "capturedAt")
WHERE
  "locationNameForDedupe" IS NULL
  OR "languageCodeForDedupe" IS NULL
  OR "captureDate" IS NULL;

ALTER TABLE "KeywordResearchResult"
  ALTER COLUMN "locationNameForDedupe" SET DEFAULT '',
  ALTER COLUMN "languageCodeForDedupe" SET DEFAULT '',
  ALTER COLUMN "captureDate" SET DEFAULT date_trunc('day', CURRENT_TIMESTAMP);

UPDATE "KeywordResearchResult"
SET
  "locationNameForDedupe" = ''
WHERE "locationNameForDedupe" IS NULL;
UPDATE "KeywordResearchResult"
SET
  "languageCodeForDedupe" = ''
WHERE "languageCodeForDedupe" IS NULL;

ALTER TABLE "KeywordResearchResult"
  ALTER COLUMN "locationNameForDedupe" SET NOT NULL,
  ALTER COLUMN "languageCodeForDedupe" SET NOT NULL,
  ALTER COLUMN "captureDate" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "KeywordResearchResult_locale_dedupe_key"
  ON "KeywordResearchResult" ("source", "keyword", "locationNameForDedupe", "languageCodeForDedupe", "captureDate");

-- CompetitorSocialPage -----------------------------------------------------------------------
ALTER TABLE "CompetitorSocialPage"
  ADD COLUMN IF NOT EXISTS "identityKey" TEXT;

UPDATE "CompetitorSocialPage"
SET "identityKey" = CASE
  WHEN "pageId" IS NOT NULL AND trim("pageId") <> ''
    THEN lower(trim("platform")) || '|' || trim("pageId")
  ELSE lower(trim("platform")) || '|' || "competitorId" || '|' || lower(regexp_replace(trim("pageName"), '\\s+', ' ', 'g'))
END
WHERE "identityKey" IS NULL OR trim("identityKey") = '';

ALTER TABLE "CompetitorSocialPage"
  ALTER COLUMN "identityKey" SET DEFAULT '',
  ALTER COLUMN "identityKey" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "CompetitorSocialPage_identity_key"
  ON "CompetitorSocialPage" ("identityKey");

-- CompetitorAdCapture ------------------------------------------------------------------------
ALTER TABLE "CompetitorAdCapture"
  ADD COLUMN IF NOT EXISTS "captureDate" TIMESTAMP(3);

UPDATE "CompetitorAdCapture"
SET "captureDate" = date_trunc('day', "capturedAt")
WHERE "captureDate" IS NULL;

ALTER TABLE "CompetitorAdCapture"
  ALTER COLUMN "captureDate" SET DEFAULT date_trunc('day', CURRENT_TIMESTAMP),
  ALTER COLUMN "captureDate" SET NOT NULL;

-- Remove duplicate CompetitorAdCapture rows before adding constraint
DELETE FROM "CompetitorAdCapture"
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY "adArchiveId", "captureDate"
             ORDER BY "capturedAt" DESC
           ) AS rn
    FROM "CompetitorAdCapture"
  ) ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "CompetitorAdCapture_captureDate_dedupe_key"
  ON "CompetitorAdCapture" ("adArchiveId", "captureDate");
