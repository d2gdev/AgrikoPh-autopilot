-- Add lifecycle ownership and finalization metadata for transactional transitions.
-- Nullable to keep the migration backward-compatible and avoid implicit rewrites.
ALTER TABLE "ContentProposal" ADD COLUMN "draftGenerationToken" TEXT;
ALTER TABLE "ContentProposal" ADD COLUMN "draftGenerationStartedAt" TIMESTAMP(3);
ALTER TABLE "ContentProposal" ADD COLUMN "publishOperationId" TEXT;
ALTER TABLE "ContentProposal" ADD COLUMN "publishStartedAt" TIMESTAMP(3);
ALTER TABLE "ContentProposal" ADD COLUMN "publishFinalizedAt" TIMESTAMP(3);
ALTER TABLE "ContentProposal" ADD COLUMN "publishWarning" TEXT;

-- `publishOperationId` is optional operational ownership state, so we enforce
-- uniqueness only when a token is present.
CREATE UNIQUE INDEX "ContentProposal_publishOperationId_key"
  ON "ContentProposal"("publishOperationId")
  WHERE "publishOperationId" IS NOT NULL;
