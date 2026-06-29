-- CreateTable
CREATE TABLE "StoreTask" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "taskType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "targetUrl" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "proposedState" JSONB NOT NULL,
    "sourceData" JSONB NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completionNote" TEXT,
    "opportunityId" TEXT,
    "dedupeKey" TEXT NOT NULL,

    CONSTRAINT "StoreTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreTask_dedupeKey_key" ON "StoreTask"("dedupeKey");

-- CreateIndex
CREATE INDEX "StoreTask_status_priority_createdAt_idx" ON "StoreTask"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "StoreTask_taskType_idx" ON "StoreTask"("taskType");

-- CreateIndex
CREATE INDEX "StoreTask_targetType_targetId_idx" ON "StoreTask"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "StoreTask_opportunityId_idx" ON "StoreTask"("opportunityId");
