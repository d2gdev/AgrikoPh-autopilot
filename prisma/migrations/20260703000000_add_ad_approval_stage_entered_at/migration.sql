-- SLA correctness: track when an approval entered its current status so the
-- SLA worker measures stage age from a stable timestamp instead of updatedAt.
ALTER TABLE "AdApproval" ADD COLUMN "stageEnteredAt" TIMESTAMP(3);
