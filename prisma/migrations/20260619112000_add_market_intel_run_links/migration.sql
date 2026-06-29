ALTER TABLE "ShoppingResult" ADD COLUMN "jobRunId" TEXT;
ALTER TABLE "ShoppingPriceHistory" ADD COLUMN "jobRunId" TEXT;
ALTER TABLE "CompetitorAd" ADD COLUMN "jobRunId" TEXT;
ALTER TABLE "KeywordResearchResult" ADD COLUMN "jobRunId" TEXT;

CREATE INDEX "ShoppingResult_jobRunId_idx" ON "ShoppingResult"("jobRunId");
CREATE INDEX "ShoppingPriceHistory_jobRunId_idx" ON "ShoppingPriceHistory"("jobRunId");
CREATE INDEX "CompetitorAd_jobRunId_idx" ON "CompetitorAd"("jobRunId");
CREATE INDEX "KeywordResearchResult_jobRunId_idx" ON "KeywordResearchResult"("jobRunId");

ALTER TABLE "ShoppingResult" ADD CONSTRAINT "ShoppingResult_jobRunId_fkey" FOREIGN KEY ("jobRunId") REFERENCES "JobRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShoppingPriceHistory" ADD CONSTRAINT "ShoppingPriceHistory_jobRunId_fkey" FOREIGN KEY ("jobRunId") REFERENCES "JobRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompetitorAd" ADD CONSTRAINT "CompetitorAd_jobRunId_fkey" FOREIGN KEY ("jobRunId") REFERENCES "JobRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KeywordResearchResult" ADD CONSTRAINT "KeywordResearchResult_jobRunId_fkey" FOREIGN KEY ("jobRunId") REFERENCES "JobRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
