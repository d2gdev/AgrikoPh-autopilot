-- Enforce dashboard ingestion idempotency at the database layer.
-- Existing duplicate logical rows must be removed before this migration runs.

CREATE UNIQUE INDEX IF NOT EXISTS "GscQuery_query_page_dateRangeStart_dateRangeEnd_key"
  ON "GscQuery" ("query", "page", "dateRangeStart", "dateRangeEnd");

CREATE UNIQUE INDEX IF NOT EXISTS "KeywordResearchResult_daily_dedupe_key"
  ON "KeywordResearchResult" (
    "source",
    "keyword",
    COALESCE("locationName", ''),
    COALESCE("languageCode", ''),
    ("capturedAt"::date)
  );

CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingResult_daily_dedupe_key"
  ON "ShoppingResult" (
    "keyword",
    "productKey",
    ("capturedAt"::date)
  );

CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingPriceHistory_daily_dedupe_key"
  ON "ShoppingPriceHistory" (
    "productKey",
    ("capturedAt"::date)
  );

CREATE UNIQUE INDEX IF NOT EXISTS "MarketInsight_open_daily_dedupe_key"
  ON "MarketInsight" (
    "type",
    "title",
    COALESCE("competitorId", ''),
    COALESCE("keywordId", ''),
    COALESCE("adId", ''),
    ("createdAt"::date)
  )
  WHERE "status" = 'open';
