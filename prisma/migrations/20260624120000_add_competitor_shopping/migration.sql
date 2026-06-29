-- AlterTable: link shopping results to a competitor (per-competitor catalog pull)
ALTER TABLE "ShoppingResult" ADD COLUMN "competitorId" TEXT;

-- AlterTable: competitor price history can be keyword- OR competitor-keyed
ALTER TABLE "ShoppingPriceHistory" ADD COLUMN "competitorId" TEXT,
ALTER COLUMN "marketKeywordId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ShoppingResult_competitorId_capturedAt_idx" ON "ShoppingResult"("competitorId", "capturedAt");

-- CreateIndex
CREATE INDEX "ShoppingPriceHistory_competitorId_capturedAt_idx" ON "ShoppingPriceHistory"("competitorId", "capturedAt");

-- AddForeignKey
ALTER TABLE "ShoppingResult" ADD CONSTRAINT "ShoppingResult_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingPriceHistory" ADD CONSTRAINT "ShoppingPriceHistory_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
