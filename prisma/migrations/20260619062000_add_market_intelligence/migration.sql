-- Add Market Intelligence pilot tables for competitor ads, shopping results, price history, and insights.
CREATE TABLE "Competitor" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "name" TEXT NOT NULL,
  "domain" TEXT,
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompetitorSocialPage" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "competitorId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "pageName" TEXT NOT NULL,
  "pageId" TEXT,
  "pageUrl" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "CompetitorSocialPage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketKeyword" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "keyword" TEXT NOT NULL,
  "category" TEXT,
  "locationName" TEXT,
  "languageCode" TEXT NOT NULL DEFAULT 'en',
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "MarketKeyword_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShoppingResult" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "marketKeywordId" TEXT NOT NULL,
  "keyword" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "brand" TEXT,
  "price" DOUBLE PRECISION,
  "currency" TEXT,
  "store" TEXT,
  "rating" DOUBLE PRECISION,
  "reviewCount" INTEGER,
  "searchPosition" INTEGER,
  "productUrl" TEXT,
  "imageUrl" TEXT,
  "productKey" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rawPayload" JSONB,
  CONSTRAINT "ShoppingResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShoppingPriceHistory" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "marketKeywordId" TEXT NOT NULL,
  "productKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "store" TEXT,
  "price" DOUBLE PRECISION NOT NULL,
  "currency" TEXT,
  "previousPrice" DOUBLE PRECISION,
  "priceDelta" DOUBLE PRECISION,
  "priceDeltaPct" DOUBLE PRECISION,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShoppingPriceHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompetitorAd" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "competitorId" TEXT NOT NULL,
  "pageName" TEXT,
  "pageId" TEXT,
  "adArchiveId" TEXT NOT NULL,
  "adCopy" TEXT,
  "headline" TEXT,
  "description" TEXT,
  "cta" TEXT,
  "landingPageUrl" TEXT,
  "adSnapshotUrl" TEXT,
  "platforms" JSONB,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "activeStatus" TEXT,
  "creativeType" TEXT,
  "imageUrl" TEXT,
  "videoUrl" TEXT,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rawPayload" JSONB,
  CONSTRAINT "CompetitorAd_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketInsight" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'info',
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "competitorId" TEXT,
  "keywordId" TEXT,
  "adId" TEXT,
  CONSTRAINT "MarketInsight_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Competitor_name_key" ON "Competitor"("name");
CREATE INDEX "Competitor_active_idx" ON "Competitor"("active");

CREATE INDEX "CompetitorSocialPage_competitorId_idx" ON "CompetitorSocialPage"("competitorId");
CREATE INDEX "CompetitorSocialPage_platform_active_idx" ON "CompetitorSocialPage"("platform", "active");
CREATE UNIQUE INDEX "CompetitorSocialPage_platform_pageId_key" ON "CompetitorSocialPage"("platform", "pageId");

CREATE INDEX "MarketKeyword_active_idx" ON "MarketKeyword"("active");
CREATE UNIQUE INDEX "MarketKeyword_keyword_locationName_languageCode_key" ON "MarketKeyword"("keyword", "locationName", "languageCode");

CREATE INDEX "ShoppingResult_marketKeywordId_capturedAt_idx" ON "ShoppingResult"("marketKeywordId", "capturedAt");
CREATE INDEX "ShoppingResult_keyword_capturedAt_idx" ON "ShoppingResult"("keyword", "capturedAt");
CREATE INDEX "ShoppingResult_store_idx" ON "ShoppingResult"("store");
CREATE INDEX "ShoppingResult_productKey_capturedAt_idx" ON "ShoppingResult"("productKey", "capturedAt");
CREATE INDEX "ShoppingResult_searchPosition_idx" ON "ShoppingResult"("searchPosition");

CREATE INDEX "ShoppingPriceHistory_marketKeywordId_capturedAt_idx" ON "ShoppingPriceHistory"("marketKeywordId", "capturedAt");
CREATE INDEX "ShoppingPriceHistory_productKey_capturedAt_idx" ON "ShoppingPriceHistory"("productKey", "capturedAt");
CREATE INDEX "ShoppingPriceHistory_store_idx" ON "ShoppingPriceHistory"("store");

CREATE UNIQUE INDEX "CompetitorAd_adArchiveId_key" ON "CompetitorAd"("adArchiveId");
CREATE INDEX "CompetitorAd_competitorId_idx" ON "CompetitorAd"("competitorId");
CREATE INDEX "CompetitorAd_activeStatus_idx" ON "CompetitorAd"("activeStatus");
CREATE INDEX "CompetitorAd_startDate_idx" ON "CompetitorAd"("startDate");
CREATE INDEX "CompetitorAd_capturedAt_idx" ON "CompetitorAd"("capturedAt");

CREATE INDEX "MarketInsight_status_createdAt_idx" ON "MarketInsight"("status", "createdAt");
CREATE INDEX "MarketInsight_type_createdAt_idx" ON "MarketInsight"("type", "createdAt");
CREATE INDEX "MarketInsight_severity_idx" ON "MarketInsight"("severity");
CREATE INDEX "MarketInsight_competitorId_idx" ON "MarketInsight"("competitorId");
CREATE INDEX "MarketInsight_keywordId_idx" ON "MarketInsight"("keywordId");

ALTER TABLE "CompetitorSocialPage" ADD CONSTRAINT "CompetitorSocialPage_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShoppingResult" ADD CONSTRAINT "ShoppingResult_marketKeywordId_fkey" FOREIGN KEY ("marketKeywordId") REFERENCES "MarketKeyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShoppingPriceHistory" ADD CONSTRAINT "ShoppingPriceHistory_marketKeywordId_fkey" FOREIGN KEY ("marketKeywordId") REFERENCES "MarketKeyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompetitorAd" ADD CONSTRAINT "CompetitorAd_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketInsight" ADD CONSTRAINT "MarketInsight_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MarketInsight" ADD CONSTRAINT "MarketInsight_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "MarketKeyword"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MarketInsight" ADD CONSTRAINT "MarketInsight_adId_fkey" FOREIGN KEY ("adId") REFERENCES "CompetitorAd"("id") ON DELETE SET NULL ON UPDATE CASCADE;
