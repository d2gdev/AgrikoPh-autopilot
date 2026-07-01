-- Cached monthly search volume per keyword (DataForSEO), populated by the GSC
-- fetch job and read by the SEO summary API for the "Traffic" column. Keyed by
-- normalized keyword so passive page views never hit the metered DataForSEO API.
CREATE TABLE IF NOT EXISTS "KeywordSearchVolume" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "searchVolume" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'dataforseo',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KeywordSearchVolume_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "KeywordSearchVolume_keyword_key" ON "KeywordSearchVolume"("keyword");
CREATE INDEX IF NOT EXISTS "KeywordSearchVolume_fetchedAt_idx" ON "KeywordSearchVolume"("fetchedAt");
