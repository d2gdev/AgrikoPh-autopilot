-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "targetUrl" TEXT,
    "targetName" TEXT,
    "source" TEXT NOT NULL,
    "sourceRunId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "priority" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "impact" TEXT,
    "effort" TEXT,
    "evidence" JSONB NOT NULL,
    "proposedAction" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "routedToType" TEXT,
    "routedToId" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_dedupeKey_key" ON "Opportunity"("dedupeKey");

-- CreateIndex
CREATE INDEX "Opportunity_status_score_idx" ON "Opportunity"("status", "score");

-- CreateIndex
CREATE INDEX "Opportunity_type_createdAt_idx" ON "Opportunity"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Opportunity_targetType_targetId_idx" ON "Opportunity"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Opportunity_targetUrl_idx" ON "Opportunity"("targetUrl");

-- CreateIndex
CREATE INDEX "Opportunity_sourceRunId_idx" ON "Opportunity"("sourceRunId");
