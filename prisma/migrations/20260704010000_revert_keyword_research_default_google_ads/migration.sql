-- Reverts migration 20260704000000_keyword_research_default_dataforseo.
-- Keyword Planner (Google Ads) keyword research is staying — only the
-- ad-execution/campaign side of Google Ads was intended for removal. Code
-- always passes source explicitly, so this only changes the column default
-- applied to a future insert that omits the field — no existing rows change.
ALTER TABLE "KeywordResearchResult" ALTER COLUMN "source" SET DEFAULT 'google_ads';
