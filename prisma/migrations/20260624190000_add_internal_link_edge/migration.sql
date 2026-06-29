-- CreateTable
CREATE TABLE "InternalLinkEdge" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobRunId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceHandle" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "targetType" TEXT NOT NULL,
    "targetHandle" TEXT,
    "targetUrl" TEXT NOT NULL,
    "anchorText" TEXT NOT NULL,
    "isCta" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalLinkEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InternalLinkEdge_jobRunId_idx" ON "InternalLinkEdge"("jobRunId");

-- CreateIndex
CREATE INDEX "InternalLinkEdge_sourceType_sourceHandle_idx" ON "InternalLinkEdge"("sourceType", "sourceHandle");

-- CreateIndex
CREATE INDEX "InternalLinkEdge_targetType_targetHandle_idx" ON "InternalLinkEdge"("targetType", "targetHandle");

-- CreateIndex
CREATE INDEX "InternalLinkEdge_targetUrl_idx" ON "InternalLinkEdge"("targetUrl");

-- CreateIndex
CREATE INDEX "InternalLinkEdge_capturedAt_idx" ON "InternalLinkEdge"("capturedAt");

-- AddForeignKey
ALTER TABLE "InternalLinkEdge" ADD CONSTRAINT "InternalLinkEdge_jobRunId_fkey" FOREIGN KEY ("jobRunId") REFERENCES "JobRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
