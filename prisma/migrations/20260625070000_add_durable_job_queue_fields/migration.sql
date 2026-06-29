-- Add lightweight database-backed queue metadata to JobRun and owner metadata
-- to JobLock. Existing synchronous jobs continue to work; queued jobs use these
-- fields for claim/heartbeat/recovery.

ALTER TABLE "JobRun" ADD COLUMN "input" JSONB;
ALTER TABLE "JobRun" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "JobRun" ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "JobRun" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "JobRun" ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3);
ALTER TABLE "JobRun" ADD COLUMN "ownerToken" TEXT;
ALTER TABLE "JobRun" ADD COLUMN "parentRunId" TEXT;

ALTER TABLE "JobLock" ADD COLUMN "ownerToken" TEXT;

CREATE INDEX "JobRun_status_startedAt_idx" ON "JobRun"("status", "startedAt");
CREATE INDEX "JobRun_status_jobName_startedAt_idx" ON "JobRun"("status", "jobName", "startedAt");
CREATE INDEX "JobRun_ownerToken_idx" ON "JobRun"("ownerToken");
CREATE INDEX "JobRun_parentRunId_idx" ON "JobRun"("parentRunId");
