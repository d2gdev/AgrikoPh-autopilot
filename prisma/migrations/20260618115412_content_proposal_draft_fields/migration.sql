-- Add draft management fields to ContentProposal
ALTER TABLE "ContentProposal" ADD COLUMN "draftContent" JSONB;
ALTER TABLE "ContentProposal" ADD COLUMN "draftGeneratedAt" TIMESTAMP(3);
ALTER TABLE "ContentProposal" ADD COLUMN "draftStatus" TEXT;
ALTER TABLE "ContentProposal" ADD COLUMN "publishedAt" TIMESTAMP(3);

-- Add index on draftStatus for querying draft proposals
CREATE INDEX "ContentProposal_draftStatus_idx" ON "ContentProposal"("draftStatus");
