-- Add English-translation columns for Market Intelligence captures (display in English).
ALTER TABLE "ShoppingResult" ADD COLUMN "titleEn" TEXT;
ALTER TABLE "CompetitorAd" ADD COLUMN "adCopyEn" TEXT;
ALTER TABLE "CompetitorAd" ADD COLUMN "headlineEn" TEXT;
