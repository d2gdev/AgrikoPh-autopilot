-- Collapse duplicate tracked-keyword identities and preserve all child references.
WITH ranked AS (
  SELECT "id", first_value("id") OVER (PARTITION BY lower(regexp_replace(btrim("keyword"), '\s+', ' ', 'g')), COALESCE(lower(btrim("locationName")), ''), lower(btrim("languageCode")) ORDER BY "createdAt", "id") AS survivor_id,
    row_number() OVER (PARTITION BY lower(regexp_replace(btrim("keyword"), '\s+', ' ', 'g')), COALESCE(lower(btrim("locationName")), ''), lower(btrim("languageCode")) ORDER BY "createdAt", "id") AS duplicate_rank
  FROM "MarketKeyword"
)
UPDATE "ShoppingResult" AS child SET "marketKeywordId" = ranked.survivor_id FROM ranked WHERE child."marketKeywordId" = ranked."id" AND ranked.duplicate_rank > 1;
WITH ranked AS (SELECT "id", first_value("id") OVER (PARTITION BY lower(regexp_replace(btrim("keyword"), '\s+', ' ', 'g')), COALESCE(lower(btrim("locationName")), ''), lower(btrim("languageCode")) ORDER BY "createdAt", "id") AS survivor_id, row_number() OVER (PARTITION BY lower(regexp_replace(btrim("keyword"), '\s+', ' ', 'g')), COALESCE(lower(btrim("locationName")), ''), lower(btrim("languageCode")) ORDER BY "createdAt", "id") AS duplicate_rank FROM "MarketKeyword")
UPDATE "ShoppingPriceHistory" AS child SET "marketKeywordId" = ranked.survivor_id FROM ranked WHERE child."marketKeywordId" = ranked."id" AND ranked.duplicate_rank > 1;
WITH ranked AS (SELECT "id", first_value("id") OVER (PARTITION BY lower(regexp_replace(btrim("keyword"), '\s+', ' ', 'g')), COALESCE(lower(btrim("locationName")), ''), lower(btrim("languageCode")) ORDER BY "createdAt", "id") AS survivor_id, row_number() OVER (PARTITION BY lower(regexp_replace(btrim("keyword"), '\s+', ' ', 'g')), COALESCE(lower(btrim("locationName")), ''), lower(btrim("languageCode")) ORDER BY "createdAt", "id") AS duplicate_rank FROM "MarketKeyword")
UPDATE "KeywordResearchResult" AS child SET "marketKeywordId" = ranked.survivor_id FROM ranked WHERE child."marketKeywordId" = ranked."id" AND ranked.duplicate_rank > 1;
WITH ranked AS (SELECT "id", first_value("id") OVER (PARTITION BY lower(regexp_replace(btrim("keyword"), '\s+', ' ', 'g')), COALESCE(lower(btrim("locationName")), ''), lower(btrim("languageCode")) ORDER BY "createdAt", "id") AS survivor_id, row_number() OVER (PARTITION BY lower(regexp_replace(btrim("keyword"), '\s+', ' ', 'g')), COALESCE(lower(btrim("locationName")), ''), lower(btrim("languageCode")) ORDER BY "createdAt", "id") AS duplicate_rank FROM "MarketKeyword")
UPDATE "MarketInsight" AS child SET "keywordId" = ranked.survivor_id FROM ranked WHERE child."keywordId" = ranked."id" AND ranked.duplicate_rank > 1;
WITH ranked AS (SELECT "id", row_number() OVER (PARTITION BY lower(regexp_replace(btrim("keyword"), '\s+', ' ', 'g')), COALESCE(lower(btrim("locationName")), ''), lower(btrim("languageCode")) ORDER BY "createdAt", "id") AS duplicate_rank FROM "MarketKeyword")
DELETE FROM "MarketKeyword" mk USING ranked WHERE mk."id" = ranked."id" AND ranked.duplicate_rank > 1;
DROP INDEX IF EXISTS "MarketKeyword_keyword_locationName_languageCode_key";
CREATE UNIQUE INDEX "MarketKeyword_normalized_identity_key" ON "MarketKeyword" (lower(regexp_replace(btrim("keyword"), '\s+', ' ', 'g')), COALESCE(lower(btrim("locationName")), ''), lower(btrim("languageCode")));
