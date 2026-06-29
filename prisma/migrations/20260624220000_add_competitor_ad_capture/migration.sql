-- Preserve competitor ad history while keeping CompetitorAd as the latest state.
CREATE TABLE "CompetitorAdCapture" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "competitorAdId" TEXT,
    "competitorId" TEXT,
    "jobRunId" TEXT,
    "adArchiveId" TEXT NOT NULL,
    "adCopy" TEXT,
    "adCopyEn" TEXT,
    "headline" TEXT,
    "headlineEn" TEXT,
    "description" TEXT,
    "cta" TEXT,
    "landingPageUrl" TEXT,
    "activeStatus" TEXT,
    "creativeType" TEXT,
    "creativeAngle" TEXT,
    "imageUrl" TEXT,
    "videoUrl" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" JSONB,

    CONSTRAINT "CompetitorAdCapture_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompetitorAdCapture_adArchiveId_capturedAt_idx" ON "CompetitorAdCapture"("adArchiveId", "capturedAt");
CREATE INDEX "CompetitorAdCapture_competitorId_capturedAt_idx" ON "CompetitorAdCapture"("competitorId", "capturedAt");
CREATE INDEX "CompetitorAdCapture_competitorAdId_capturedAt_idx" ON "CompetitorAdCapture"("competitorAdId", "capturedAt");
CREATE INDEX "CompetitorAdCapture_jobRunId_idx" ON "CompetitorAdCapture"("jobRunId");

ALTER TABLE "CompetitorAdCapture"
  ADD CONSTRAINT "CompetitorAdCapture_competitorAdId_fkey"
  FOREIGN KEY ("competitorAdId") REFERENCES "CompetitorAd"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CompetitorAdCapture"
  ADD CONSTRAINT "CompetitorAdCapture_competitorId_fkey"
  FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CompetitorAdCapture"
  ADD CONSTRAINT "CompetitorAdCapture_jobRunId_fkey"
  FOREIGN KEY ("jobRunId") REFERENCES "JobRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
