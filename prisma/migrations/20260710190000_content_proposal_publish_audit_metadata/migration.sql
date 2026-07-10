-- Persist the actor and trigger with a claimed publish operation so delayed
-- finalization writes the same truthful audit metadata as the original action.
ALTER TABLE "ContentProposal" ADD COLUMN "publishActor" TEXT;
ALTER TABLE "ContentProposal" ADD COLUMN "publishTrigger" TEXT;
