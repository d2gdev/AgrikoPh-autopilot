-- Add scheduled publish support to ContentProposal
ALTER TABLE "ContentProposal" ADD COLUMN "scheduledPublishAt" TIMESTAMP(3);
CREATE INDEX "ContentProposal_scheduledPublishAt_idx" ON "ContentProposal"("scheduledPublishAt");

-- Add draft version history table
CREATE TABLE "ContentProposalDraftHistory" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "savedBy" TEXT NOT NULL,
    "draftContent" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    CONSTRAINT "ContentProposalDraftHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContentProposalDraftHistory_proposalId_savedAt_idx" ON "ContentProposalDraftHistory"("proposalId", "savedAt");

ALTER TABLE "ContentProposalDraftHistory" ADD CONSTRAINT "ContentProposalDraftHistory_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "ContentProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
