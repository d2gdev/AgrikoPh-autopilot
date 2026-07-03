-- Google Ads removal: KeywordResearchResult.source now defaults to "dataforseo"
-- instead of "google_ads". Code always passes source explicitly (see
-- jobs/fetch-keyword-research.ts), so this only changes the column default
-- applied to a future insert that omits the field — no existing rows change.
ALTER TABLE "KeywordResearchResult" ALTER COLUMN "source" SET DEFAULT 'dataforseo';
