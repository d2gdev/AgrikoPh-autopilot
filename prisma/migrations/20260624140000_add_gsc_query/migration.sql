-- CreateTable: GSC search-analytics snapshot (Agriko's own ranking data)
CREATE TABLE "GscQuery" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobRunId" TEXT,
    "query" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "position" DOUBLE PRECISION,
    "ctr" DOUBLE PRECISION,
    "dateRangeStart" TIMESTAMP(3) NOT NULL,
    "dateRangeEnd" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GscQuery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GscQuery_jobRunId_idx" ON "GscQuery"("jobRunId");
CREATE INDEX "GscQuery_query_capturedAt_idx" ON "GscQuery"("query", "capturedAt");
CREATE INDEX "GscQuery_page_capturedAt_idx" ON "GscQuery"("page", "capturedAt");
CREATE INDEX "GscQuery_capturedAt_idx" ON "GscQuery"("capturedAt");

-- AddForeignKey
ALTER TABLE "GscQuery" ADD CONSTRAINT "GscQuery_jobRunId_fkey" FOREIGN KEY ("jobRunId") REFERENCES "JobRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
