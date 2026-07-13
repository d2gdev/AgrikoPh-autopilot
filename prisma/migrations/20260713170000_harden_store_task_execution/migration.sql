ALTER TABLE "StoreTask" ADD COLUMN "executionReceipt" JSONB;
ALTER TABLE "StoreTaskExecutionLock" RENAME COLUMN "claimedAt" TO "acquiredAt";
ALTER TABLE "StoreTaskExecutionLock" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "StoreTaskExecutionLock" ADD COLUMN "expiresAt" TIMESTAMP(3);
UPDATE "StoreTaskExecutionLock" SET "ownerId" = "taskId", "expiresAt" = "acquiredAt" + INTERVAL '10 minutes';
ALTER TABLE "StoreTaskExecutionLock" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "StoreTaskExecutionLock" ALTER COLUMN "expiresAt" SET NOT NULL;
CREATE INDEX "StoreTaskExecutionLock_expiresAt_idx" ON "StoreTaskExecutionLock"("expiresAt");
