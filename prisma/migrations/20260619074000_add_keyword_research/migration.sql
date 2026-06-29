CREATE TABLE "KeywordResearchResult" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "marketKeywordId" TEXT,
  "seedKeyword" TEXT NOT NULL,
  "keyword" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'google_ads',
  "locationName" TEXT,
  "languageCode" TEXT,
  "avgMonthlySearches" INTEGER,
  "competition" TEXT,
  "competitionIndex" INTEGER,
  "lowTopOfPageBidMicros" BIGINT,
  "highTopOfPageBidMicros" BIGINT,
  "monthlySearchVolumes" JSONB,
  "rawPayload" JSONB,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KeywordResearchResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KeywordResearchResult_marketKeywordId_capturedAt_idx" ON "KeywordResearchResult"("marketKeywordId", "capturedAt");
CREATE INDEX "KeywordResearchResult_seedKeyword_capturedAt_idx" ON "KeywordResearchResult"("seedKeyword", "capturedAt");
CREATE INDEX "KeywordResearchResult_keyword_capturedAt_idx" ON "KeywordResearchResult"("keyword", "capturedAt");
CREATE INDEX "KeywordResearchResult_avgMonthlySearches_idx" ON "KeywordResearchResult"("avgMonthlySearches");
CREATE INDEX "KeywordResearchResult_competition_idx" ON "KeywordResearchResult"("competition");

ALTER TABLE "KeywordResearchResult" ADD CONSTRAINT "KeywordResearchResult_marketKeywordId_fkey" FOREIGN KEY ("marketKeywordId") REFERENCES "MarketKeyword"("id") ON DELETE SET NULL ON UPDATE CASCADE;
