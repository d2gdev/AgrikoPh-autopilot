CREATE TABLE "SeoFollowUpTask" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "taskType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "targetUrl" TEXT,
    "topicalCluster" TEXT,
    "pageRole" TEXT,
    "ownerSurface" TEXT NOT NULL DEFAULT 'seo',
    "destinationPath" TEXT,
    "priority" TEXT NOT NULL,
    "earliestReviewAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "requiresEvidence" BOOLEAN NOT NULL DEFAULT true,
    "evidenceRequirement" JSONB NOT NULL,
    "evidenceStatus" TEXT NOT NULL DEFAULT 'waiting',
    "evidenceSnapshot" JSONB,
    "lastEvaluatedAt" TIMESTAMP(3),
    "sourceType" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceData" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "completionNote" TEXT,
    "decisionData" JSONB,
    "dedupeKey" TEXT NOT NULL,

    CONSTRAINT "SeoFollowUpTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeoFollowUpTask_dedupeKey_key" ON "SeoFollowUpTask"("dedupeKey");
CREATE INDEX "SeoFollowUpTask_status_earliestReviewAt_idx" ON "SeoFollowUpTask"("status", "earliestReviewAt");
CREATE INDEX "SeoFollowUpTask_priority_earliestReviewAt_idx" ON "SeoFollowUpTask"("priority", "earliestReviewAt");
CREATE INDEX "SeoFollowUpTask_taskType_status_idx" ON "SeoFollowUpTask"("taskType", "status");
CREATE INDEX "SeoFollowUpTask_targetUrl_idx" ON "SeoFollowUpTask"("targetUrl");
