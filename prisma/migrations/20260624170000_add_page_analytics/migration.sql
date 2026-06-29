-- CreateTable
CREATE TABLE "PageAnalytics" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobRunId" TEXT,
    "page" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "totalUsers" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "bounceRate" DOUBLE PRECISION,
    "conversionRate" DOUBLE PRECISION,
    "dateRangeStart" TIMESTAMP(3) NOT NULL,
    "dateRangeEnd" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" JSONB,

    CONSTRAINT "PageAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PageAnalytics_jobRunId_idx" ON "PageAnalytics"("jobRunId");

-- CreateIndex
CREATE INDEX "PageAnalytics_page_capturedAt_idx" ON "PageAnalytics"("page", "capturedAt");

-- CreateIndex
CREATE INDEX "PageAnalytics_capturedAt_idx" ON "PageAnalytics"("capturedAt");

-- CreateIndex
CREATE INDEX "PageAnalytics_dateRangeStart_dateRangeEnd_idx" ON "PageAnalytics"("dateRangeStart", "dateRangeEnd");

-- AddForeignKey
ALTER TABLE "PageAnalytics" ADD CONSTRAINT "PageAnalytics_jobRunId_fkey" FOREIGN KEY ("jobRunId") REFERENCES "JobRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
