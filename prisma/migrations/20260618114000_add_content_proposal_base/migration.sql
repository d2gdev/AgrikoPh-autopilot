-- CreateTable: ContentProposal (base columns, without draft fields added in 20260618115412)
CREATE TABLE "ContentProposal" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "articleHandle" TEXT,
    "proposalType" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "effort" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "proposedState" JSONB NOT NULL,
    "sourceData" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    CONSTRAINT "ContentProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContentProposal_status_idx" ON "ContentProposal"("status");
CREATE INDEX "ContentProposal_articleHandle_idx" ON "ContentProposal"("articleHandle");
CREATE INDEX "ContentProposal_createdAt_idx" ON "ContentProposal"("createdAt");
