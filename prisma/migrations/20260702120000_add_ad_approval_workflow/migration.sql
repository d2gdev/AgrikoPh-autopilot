-- Ad Approval workflow (docs/ad-approval-spec.md). Hand-authored to match the
-- Prisma models added to schema.prisma; apply with `prisma migrate deploy`
-- (npm run db:migrate) or `prisma migrate dev` against a dev database.

-- CreateTable
CREATE TABLE "AppUser" (
    "id" TEXT NOT NULL,
    "shopifyUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "email" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewerAssignment" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "assignedUserId" TEXT NOT NULL,
    "backupUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "ReviewerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdApproval" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT NOT NULL,
    "submitterId" TEXT NOT NULL,
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "stage" TEXT NOT NULL DEFAULT 'PRE_REVIEW',
    "assignedConversionReviewerId" TEXT,
    "assignedPenultimateApproverId" TEXT,
    "assignedFinalApproverId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "draftCopy" JSONB,
    "draftCreative" JSONB,
    "flags" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AdApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdRevision" (
    "id" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "copy" JSONB NOT NULL,
    "creative" JSONB NOT NULL,
    "statusAtSubmission" TEXT NOT NULL,

    CONSTRAINT "AdRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdReview" (
    "id" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "reviewerType" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewerName" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "score" INTEGER,
    "comments" TEXT,
    "aiReportId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jsonMetadata" JSONB,

    CONSTRAINT "AdReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdAIReport" (
    "id" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "overallResult" TEXT NOT NULL,
    "executiveSummary" TEXT NOT NULL,
    "validationChecks" JSONB NOT NULL,
    "warnings" TEXT,
    "errors" TEXT,
    "recommendations" TEXT,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawResponse" JSONB,

    CONSTRAINT "AdAIReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdAIJobQueue" (
    "id" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "timeoutSeconds" INTEGER NOT NULL DEFAULT 90,
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdAIJobQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "approvalId" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_shopifyUserId_key" ON "AppUser"("shopifyUserId");

-- CreateIndex
CREATE INDEX "AppUser_lastSeenAt_idx" ON "AppUser"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewerAssignment_role_key" ON "ReviewerAssignment"("role");

-- CreateIndex
CREATE UNIQUE INDEX "AdApproval_campaignId_key" ON "AdApproval"("campaignId");

-- CreateIndex
CREATE INDEX "AdApproval_submitterId_status_idx" ON "AdApproval"("submitterId", "status");

-- CreateIndex
CREATE INDEX "AdApproval_status_stage_idx" ON "AdApproval"("status", "stage");

-- CreateIndex
CREATE INDEX "AdApproval_createdAt_idx" ON "AdApproval"("createdAt");

-- CreateIndex
CREATE INDEX "AdRevision_approvalId_revisionNumber_idx" ON "AdRevision"("approvalId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AdRevision_approvalId_revisionNumber_key" ON "AdRevision"("approvalId", "revisionNumber");

-- CreateIndex
CREATE INDEX "AdReview_approvalId_revisionNumber_completedAt_idx" ON "AdReview"("approvalId", "revisionNumber", "completedAt");

-- CreateIndex
CREATE INDEX "AdAIReport_approvalId_generatedAt_idx" ON "AdAIReport"("approvalId", "generatedAt");

-- CreateIndex
CREATE INDEX "AdAIJobQueue_approvalId_status_idx" ON "AdAIJobQueue"("approvalId", "status");

-- CreateIndex
CREATE INDEX "AdAIJobQueue_status_nextRetryAt_idx" ON "AdAIJobQueue"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_createdAt_idx" ON "Notification"("recipientId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "AdRevision" ADD CONSTRAINT "AdRevision_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "AdApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdReview" ADD CONSTRAINT "AdReview_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "AdApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdReview" ADD CONSTRAINT "AdReview_aiReportId_fkey" FOREIGN KEY ("aiReportId") REFERENCES "AdAIReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdAIReport" ADD CONSTRAINT "AdAIReport_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "AdApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdAIJobQueue" ADD CONSTRAINT "AdAIJobQueue_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "AdApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;
